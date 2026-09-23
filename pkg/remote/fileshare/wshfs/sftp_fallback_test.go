// Copyright 2026, GenieTerm. Apache-2.0.

package wshfs

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"io"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/remote"
	"github.com/Ry3nG/GenieTerm/pkg/remote/conncontroller"
	"github.com/Ry3nG/GenieTerm/pkg/streamclient"
	"github.com/Ry3nG/GenieTerm/pkg/wconfig"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/Ry3nG/GenieTerm/pkg/wshutil"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

type loopbackStreamRPC struct{ broker *streamclient.Broker }

func (rpc *loopbackStreamRPC) StreamDataCommand(data wshrpc.CommandStreamData, _ *wshrpc.RpcOpts) error {
	rpc.broker.RecvData(data)
	return nil
}

func (rpc *loopbackStreamRPC) StreamDataAckCommand(data wshrpc.CommandStreamAckData, _ *wshrpc.RpcOpts) error {
	rpc.broker.RecvAck(data)
	return nil
}

func makeSFTPTestConnection(t *testing.T) string {
	t.Helper()
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(privateKey)
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	config := &ssh.ServerConfig{NoClientAuth: true}
	config.AddHostKey(signer)
	go func() {
		for {
			raw, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				_, channels, requests, err := ssh.NewServerConn(raw, config)
				if err != nil {
					raw.Close()
					return
				}
				go ssh.DiscardRequests(requests)
				for channel := range channels {
					if channel.ChannelType() != "session" {
						channel.Reject(ssh.UnknownChannelType, "session required")
						continue
					}
					ch, reqs, err := channel.Accept()
					if err != nil {
						continue
					}
					go func() {
						defer ch.Close()
						for req := range reqs {
							var subsystem struct{ Name string }
							if req.Type != "subsystem" || ssh.Unmarshal(req.Payload, &subsystem) != nil || subsystem.Name != "sftp" {
								req.Reply(false, nil)
								continue
							}
							req.Reply(true, nil)
							server, err := sftp.NewServer(ch)
							if err == nil {
								server.Serve()
								server.Close()
							}
							return
						}
					}()
				}
			}()
		}
	}()
	host := "test@" + listener.Addr().String()
	client, err := ssh.Dial("tcp", listener.Addr().String(), &ssh.ClientConfig{
		User: "test", HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { client.Close() })
	opts, err := remote.ParseOpts(host)
	if err != nil {
		t.Fatal(err)
	}
	conn := conncontroller.GetConn(opts)
	conn.WithLock(func() {
		conn.Client = client
		conn.Status = "connected"
	})
	conn.WshEnabled.Store(false)
	return host
}

func sftpTestRemoteURI(host, filePath string) string {
	return "wsh://" + host + "/" + filepath.ToSlash(filePath)
}

func sftpTestFileURI(filePath string) string {
	uriPath := filepath.ToSlash(filePath)
	if runtime.GOOS == "windows" {
		uriPath = "/" + uriPath
	}
	return (&url.URL{Scheme: "file", Path: uriPath}).String()
}

func TestSFTPFallbackFiles(t *testing.T) {
	host := makeSFTPTestConnection(t)
	dir := t.TempDir()
	filePath := filepath.Join(dir, "sample.txt")
	if err := os.WriteFile(filePath, []byte("first"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "noext"), []byte("plain text"), 0600); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	uri := sftpTestRemoteURI(host, filePath)
	parsed, err := parseConnection(ctx, uri)
	if err != nil {
		t.Fatal(err)
	}
	sftpClient, err := openSFTP(parsed)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := resolveSFTPPath(sftpClient, "~/../outside"); err == nil {
		t.Fatal("home-relative SFTP path escaped the home directory")
	}
	sftpClient.Close()
	info, err := Stat(ctx, uri)
	if err != nil || info.Name != "sample.txt" || info.Size != 5 {
		t.Fatalf("SFTP stat: %#v, %v", info, err)
	}
	noextInfo, err := Stat(ctx, sftpTestRemoteURI(host, filepath.Join(dir, "noext")))
	if err != nil || noextInfo.MimeType != "text/plain; charset=utf-8" {
		t.Fatalf("SFTP extensionless text preview: %#v, %v", noextInfo, err)
	}
	entries, err := ListEntries(ctx, sftpTestRemoteURI(host, dir), nil)
	if err != nil || len(entries) != 2 {
		t.Fatalf("SFTP list: %#v, %v", entries, err)
	}
	read, err := Read(ctx, wshrpc.FileData{Info: &wshrpc.FileInfo{Path: uri}})
	if err != nil || read.Data64 != base64.StdEncoding.EncodeToString([]byte("first")) {
		t.Fatalf("SFTP read: %#v, %v", read, err)
	}
	if err := PutFile(ctx, wshrpc.FileData{Info: &wshrpc.FileInfo{Path: uri}, Data64: base64.StdEncoding.EncodeToString([]byte("new"))}); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(filePath)
	if err != nil || string(content) != "new" {
		t.Fatalf("SFTP write: %q, %v", content, err)
	}
	if err := Append(ctx, wshrpc.FileData{Info: &wshrpc.FileInfo{Path: uri}, Data64: base64.StdEncoding.EncodeToString([]byte("er"))}); err != nil {
		t.Fatal(err)
	}
	copyURI := sftpTestRemoteURI(host, filepath.Join(dir, "copy.txt"))
	if err := Copy(ctx, wshrpc.CommandFileCopyData{SrcUri: uri, DestUri: copyURI}); err != nil {
		t.Fatal(err)
	}
	copyContent, err := os.ReadFile(filepath.Join(dir, "copy.txt"))
	if err != nil || string(copyContent) != "newer" {
		t.Fatalf("SFTP copy: %q, %v", copyContent, err)
	}
	movedURI := sftpTestRemoteURI(host, filepath.Join(dir, "moved.txt"))
	if err := Move(ctx, wshrpc.CommandFileCopyData{SrcUri: copyURI, DestUri: movedURI}); err != nil {
		t.Fatal(err)
	}
	localUploadPath := filepath.Join(dir, "local-upload.txt")
	if err := os.WriteFile(localUploadPath, []byte("local upload"), 0600); err != nil {
		t.Fatal(err)
	}
	remoteUploadURI := sftpTestRemoteURI(host, filepath.Join(dir, "remote-upload.txt"))
	if err := Copy(ctx, wshrpc.CommandFileCopyData{SrcUri: sftpTestFileURI(localUploadPath), DestUri: remoteUploadURI}); err != nil {
		t.Fatalf("SFTP upload: %v", err)
	}
	uploadContent, err := os.ReadFile(filepath.Join(dir, "remote-upload.txt"))
	if err != nil || string(uploadContent) != "local upload" {
		t.Fatalf("SFTP upload content: %q, %v", uploadContent, err)
	}
	localDownloadPath := filepath.Join(dir, "local-download.txt")
	if err := Copy(ctx, wshrpc.CommandFileCopyData{SrcUri: remoteUploadURI, DestUri: sftpTestFileURI(localDownloadPath)}); err != nil {
		t.Fatalf("SFTP download: %v", err)
	}
	downloadContent, err := os.ReadFile(localDownloadPath)
	if err != nil || string(downloadContent) != "local upload" {
		t.Fatalf("SFTP download content: %q, %v", downloadContent, err)
	}
	if err := Copy(ctx, wshrpc.CommandFileCopyData{SrcUri: uri, DestUri: remoteUploadURI}); err == nil {
		t.Fatal("SFTP copy overwrote an existing file without confirmation")
	}
	if err := Copy(ctx, wshrpc.CommandFileCopyData{
		SrcUri:  uri,
		DestUri: remoteUploadURI,
		Opts:    &wshrpc.FileCopyOpts{Overwrite: true},
	}); err != nil {
		t.Fatalf("SFTP confirmed overwrite: %v", err)
	}
	if err := Delete(ctx, wshrpc.CommandDeleteFileData{Path: movedURI}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "moved.txt")); !os.IsNotExist(err) {
		t.Fatalf("SFTP delete: %v", err)
	}
}

func TestSFTPFallbackStreamsLargeFile(t *testing.T) {
	host := makeSFTPTestConnection(t)
	filePath := filepath.Join(t.TempDir(), "large.bin")
	want := bytes.Repeat([]byte("genieterm-sftp-stream"), 80_000)
	if err := os.WriteFile(filePath, want, 0600); err != nil {
		t.Fatal(err)
	}
	rpc := &loopbackStreamRPC{}
	rpc.broker = streamclient.NewBroker(rpc)
	previousClient := RpcClient
	RpcClient = &wshutil.WshRpc{StreamBroker: rpc.broker}
	t.Cleanup(func() { RpcClient = previousClient })
	reader, streamMeta := rpc.broker.CreateStreamReader("test-reader", "test-writer", 256*1024)
	defer reader.Close()
	uri := sftpTestRemoteURI(host, filePath)
	info, err := FileStream(context.Background(), wshrpc.CommandFileStreamData{
		Info: &wshrpc.FileInfo{Path: uri}, StreamMeta: *streamMeta,
	})
	if err != nil || info.Size != int64(len(want)) {
		t.Fatalf("SFTP stream metadata: %#v, %v", info, err)
	}
	got, err := io.ReadAll(reader)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("SFTP stream returned %d of %d bytes: %v", len(got), len(want), err)
	}
	if _, err := Stat(context.Background(), uri); err != nil {
		t.Fatalf("SSH connection was unusable after SFTP stream: %v", err)
	}
}

func TestLiveSFTPFallback(t *testing.T) {
	host := os.Getenv("GENIETERM_TEST_SFTP_HOST")
	if host == "" {
		t.Skip("set GENIETERM_TEST_SFTP_HOST for a read-only SSH integration check")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	opts, err := remote.ParseOpts(host)
	if err != nil {
		t.Fatal(err)
	}
	batchMode := true
	client, _, err := remote.ConnectToClient(ctx, opts, nil, 0, &wconfig.ConnKeywords{SshBatchMode: &batchMode})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	conn := conncontroller.GetConn(opts)
	conn.WithLock(func() {
		conn.Client = client
		conn.Status = "connected"
	})
	conn.WshEnabled.Store(false)
	uri := "wsh://" + host + "/~"
	info, err := Stat(ctx, uri)
	if err != nil || !info.IsDir {
		t.Fatalf("remote SFTP home stat: %#v, %v", info, err)
	}
	if _, err := ListEntries(ctx, uri, nil); err != nil {
		t.Fatalf("remote SFTP home list: %v", err)
	}
}
