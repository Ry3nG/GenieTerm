// Copyright 2026, GenieTerm. Apache-2.0.

package wshfs

import (
	"context"
	"crypto/sha256"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/remote"
	"github.com/Ry3nG/GenieTerm/pkg/remote/conncontroller"
	"github.com/Ry3nG/GenieTerm/pkg/remote/connparse"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

func TestSFTPCopyToWSLKeepsHelperFallback(t *testing.T) {
	dest, _, closeDest, err := openCopyDest(&connparse.Connection{Scheme: "wsh", Host: "wsl://Ubuntu", Path: "/home/user/file"})
	if err != nil || dest != nil {
		t.Fatalf("WSL destination must keep its helper fallback: %v, %v", dest, err)
	}
	closeDest()
}

func TestDownloadDirectoryUsesAuthenticatedConnection(t *testing.T) {
	host := makeSFTPTestConnection(t)
	src := t.TempDir()
	if err := os.Mkdir(filepath.Join(src, "文件"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"a.txt", "文件/b.txt"} {
		if err := os.WriteFile(filepath.Join(src, name), []byte("hello"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	dest := filepath.Join(t.TempDir(), "download")
	data := wshrpc.CommandFileDownloadDirectoryData{SrcUri: sftpTestRemoteURI(host, src), DestPath: dest}
	for attempt := 0; attempt < 2; attempt++ {
		var final wshrpc.FileTransferProgress
		for update := range DownloadDirectory(context.Background(), data) {
			if update.Error != nil {
				t.Fatal(update.Error)
			}
			if update.Response.BytesTransferred < final.BytesTransferred {
				t.Fatal("progress went backwards")
			}
			final = update.Response
		}
		if !final.Done || final.BytesTransferred != 10 || final.FilesCompleted != 2 {
			t.Fatalf("unexpected completion: %+v", final)
		}
		got, err := os.ReadFile(filepath.Join(dest, "文件/b.txt"))
		if err != nil || string(got) != "hello" {
			t.Fatalf("copied content %q: %v", got, err)
		}
	}
	assertNoGenieTempFiles(t, filepath.Dir(dest))
}

func TestDownloadNameAliases(t *testing.T) {
	for _, name := range []string{"NUL", "con.txt", "COM1.log", "lpt¹.txt", "log.", "log ", "file:stream", "a\\b"} {
		if _, err := downloadNameKey(name, "windows"); err == nil {
			t.Fatalf("accepted Windows name %q", name)
		}
	}
	for _, platform := range []string{"windows", "darwin"} {
		a, _ := downloadNameKey("A.txt", platform)
		b, _ := downloadNameKey("a.txt", platform)
		if a != b {
			t.Fatalf("missed case alias on %s", platform)
		}
	}
	a, _ := downloadNameKey("é.txt", "darwin")
	b, _ := downloadNameKey("e\u0301.txt", "darwin")
	if a != b {
		t.Fatal("missed macOS Unicode alias")
	}
	a, _ = downloadNameKey("A.txt", "linux")
	b, _ = downloadNameKey("a.txt", "linux")
	if a == b {
		t.Fatal("collapsed distinct Linux names")
	}
}

func TestDownloadRejectsSymlinkDestinationAndReportsSkippedLinks(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privileges on Windows")
	}
	host := makeSFTPTestConnection(t)
	src := t.TempDir()
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "keep"), []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(src, "linked")); err != nil {
		t.Fatal(err)
	}
	dest := filepath.Join(t.TempDir(), "download")
	var final wshrpc.FileTransferProgress
	for update := range DownloadDirectory(context.Background(), wshrpc.CommandFileDownloadDirectoryData{SrcUri: sftpTestRemoteURI(host, src), DestPath: dest}) {
		if update.Error != nil {
			t.Fatal(update.Error)
		}
		final = update.Response
	}
	if !final.Done || final.FilesSkipped != 1 {
		t.Fatalf("missing skipped-link count: %+v", final)
	}
	if err := os.WriteFile(filepath.Join(src, "keep"), []byte("changed"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "keep"), filepath.Join(dest, "keep")); err != nil {
		t.Fatal(err)
	}
	err := downloadDirectory(context.Background(), wshrpc.CommandFileDownloadDirectoryData{SrcUri: sftpTestRemoteURI(host, src), DestPath: dest}, &downloadProgress{})
	if err == nil || !strings.Contains(err.Error(), "symbolic link") {
		t.Fatalf("expected link rejection, got %v", err)
	}
	got, _ := os.ReadFile(filepath.Join(outside, "keep"))
	if string(got) != "original" {
		t.Fatalf("modified file outside destination: %q", got)
	}
}

func TestCanceledSFTPTransferKeepsSharedSSHConnection(t *testing.T) {
	host := makeSFTPTestConnection(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	conn, err := parseCopyConnection(ctx, sftpTestRemoteURI(host, t.TempDir()))
	if err != nil {
		t.Fatal(err)
	}
	source, sourcePath, closeSource, err := openCopySource(ctx, conn)
	if err != nil {
		t.Fatal(err)
	}
	defer closeSource()
	cancel()
	deadline := time.Now().Add(time.Second)
	for {
		_, err = source.ReadDir(sourcePath)
		if err != nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("cancellation did not close transfer SFTP channel")
		}
		time.Sleep(time.Millisecond)
	}
	client, err := openSFTP(conn)
	if err != nil {
		t.Fatalf("shared SSH connection was closed: %v", err)
	}
	defer client.Close()
	if _, err := client.Stat(sourcePath); err != nil {
		t.Fatal(err)
	}
}

func TestSFTPCopyToHelperHostStreamsLargeDirectory(t *testing.T) {
	srcHost := makeSFTPTestConnection(t)
	destHost := makeSFTPTestConnection(t)
	opts, _ := remote.ParseOpts(destHost)
	conncontroller.GetConn(opts).WshEnabled.Store(true)
	src := t.TempDir()
	file, err := os.Create(filepath.Join(src, "large.bin"))
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(RemoteFileTransferSizeLimit + 1); err != nil {
		t.Fatal(err)
	}
	file.Close()
	dest := filepath.Join(t.TempDir(), "copy")
	err = Copy(context.Background(), wshrpc.CommandFileCopyData{SrcUri: sftpTestRemoteURI(srcHost, src), DestUri: sftpTestRemoteURI(destHost, dest)})
	if err != nil {
		t.Fatal(err)
	}
	hash := func(p string) [32]byte {
		f, err := os.Open(p)
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close()
		h := sha256.New()
		n, err := io.Copy(h, f)
		if err != nil || n != RemoteFileTransferSizeLimit+1 {
			t.Fatalf("incomplete copy: %d, %v", n, err)
		}
		return [32]byte(h.Sum(nil))
	}
	if hash(filepath.Join(src, "large.bin")) != hash(filepath.Join(dest, "large.bin")) {
		t.Fatal("large file hash mismatch")
	}
	assertNoGenieTempFiles(t, filepath.Dir(dest))
}
