// Copyright 2026, GenieTerm. Apache-2.0.

package wshfs

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"

	"github.com/Ry3nG/GenieTerm/pkg/remote"
	"github.com/Ry3nG/GenieTerm/pkg/remote/conncontroller"
	"github.com/Ry3nG/GenieTerm/pkg/remote/connparse"
	"github.com/Ry3nG/GenieTerm/pkg/util/fileutil"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/Ry3nG/GenieTerm/pkg/wshutil"
	"github.com/pkg/sftp"
)

func shouldUseSFTP(conn *connparse.Connection) bool {
	opts, err := remote.ParseOpts(conn.Host)
	if err != nil {
		return false
	}
	sshConn := conncontroller.MaybeGetConn(opts)
	if sshConn == nil {
		return false
	}
	status := sshConn.DeriveConnStatus()
	return status.Connected && !status.WshEnabled
}

func openSFTP(conn *connparse.Connection) (*sftp.Client, error) {
	opts, err := remote.ParseOpts(conn.Host)
	if err != nil {
		return nil, err
	}
	sshConn := conncontroller.MaybeGetConn(opts)
	if sshConn == nil || sshConn.GetClient() == nil {
		return nil, fmt.Errorf("SSH connection %q is unavailable", conn.Host)
	}
	client, err := sftp.NewClient(sshConn.GetClient())
	if err != nil {
		return nil, fmt.Errorf("SFTP is unavailable on %q: %w", conn.Host, err)
	}
	return client, nil
}

func resolveSFTPPath(client *sftp.Client, remotePath string) (string, error) {
	if remotePath != "~" && !strings.HasPrefix(remotePath, "~/") {
		return remotePath, nil
	}
	home, err := client.Getwd()
	if err != nil {
		return "", fmt.Errorf("cannot find the remote home directory: %w", err)
	}
	if remotePath == "~" {
		return home, nil
	}
	cleanedHome := path.Clean(home)
	resolved := path.Join(cleanedHome, strings.TrimPrefix(remotePath, "~/"))
	if resolved != cleanedHome && !strings.HasPrefix(resolved, strings.TrimSuffix(cleanedHome, "/")+"/") {
		return "", fmt.Errorf("path escapes the remote home directory: %q", remotePath)
	}
	return resolved, nil
}

func sftpFileInfo(remotePath string, info os.FileInfo) *wshrpc.FileInfo {
	dir := path.Dir(remotePath)
	if info.IsDir() {
		dir = remotePath
	}
	size := info.Size()
	if info.IsDir() {
		size = -1
	}
	return &wshrpc.FileInfo{
		Path:          remotePath,
		Dir:           dir,
		Name:          info.Name(),
		Size:          size,
		Mode:          info.Mode(),
		ModeStr:       info.Mode().String(),
		ModTime:       info.ModTime().UnixMilli(),
		IsDir:         info.IsDir(),
		MimeType:      fileutil.DetectMimeType(remotePath, info, false),
		SupportsMkdir: true,
	}
}

func sftpMimeType(client *sftp.Client, remotePath string, info os.FileInfo) string {
	mimeType := fileutil.DetectMimeType(remotePath, info, false)
	if mimeType != "" || info.IsDir() {
		return mimeType
	}
	file, err := client.Open(remotePath)
	if err != nil {
		return ""
	}
	defer file.Close()
	buffer := make([]byte, 512)
	n, _ := file.Read(buffer)
	if n == 0 {
		return ""
	}
	mimeType = http.DetectContentType(buffer[:n])
	if mimeType == "application/octet-stream" {
		return ""
	}
	return mimeType
}

func sftpStat(conn *connparse.Connection) (*wshrpc.FileInfo, error) {
	client, err := openSFTP(conn)
	if err != nil {
		return nil, err
	}
	defer client.Close()
	remotePath, err := resolveSFTPPath(client, conn.Path)
	if err != nil {
		return nil, err
	}
	info, err := client.Stat(remotePath)
	if errors.Is(err, fs.ErrNotExist) || os.IsNotExist(err) {
		return &wshrpc.FileInfo{Path: conn.Path, Dir: path.Dir(conn.Path), Name: path.Base(conn.Path), NotFound: true}, nil
	}
	if err != nil {
		return nil, err
	}
	fileInfo := sftpFileInfo(conn.Path, info)
	fileInfo.MimeType = sftpMimeType(client, remotePath, info)
	return fileInfo, nil
}

func sftpListEntriesStream(ctx context.Context, conn *connparse.Connection, opts *wshrpc.FileListOpts) <-chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData] {
	ch := make(chan wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData], 1)
	go func() {
		defer close(ch)
		send := func(result wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData]) bool {
			select {
			case ch <- result:
				return true
			case <-ctx.Done():
				return false
			}
		}
		client, err := openSFTP(conn)
		if err != nil {
			send(wshutil.RespErr[wshrpc.CommandRemoteListEntriesRtnData](err))
			return
		}
		defer client.Close()
		remotePath, err := resolveSFTPPath(client, conn.Path)
		if err != nil {
			send(wshutil.RespErr[wshrpc.CommandRemoteListEntriesRtnData](err))
			return
		}
		entries, err := client.ReadDirContext(ctx, remotePath)
		if err != nil {
			send(wshutil.RespErr[wshrpc.CommandRemoteListEntriesRtnData](err))
			return
		}
		start := 0
		end := len(entries)
		if opts != nil {
			start = min(max(opts.Offset, 0), end)
			if opts.Limit > 0 {
				end = min(end, start+opts.Limit)
			}
		}
		batch := make([]*wshrpc.FileInfo, 0, wshrpc.DirChunkSize)
		for _, entry := range entries[start:end] {
			if ctx.Err() != nil {
				return
			}
			batch = append(batch, sftpFileInfo(path.Join(conn.Path, entry.Name()), entry))
			if len(batch) >= wshrpc.DirChunkSize {
				if !send(wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData]{Response: wshrpc.CommandRemoteListEntriesRtnData{FileInfo: batch}}) {
					return
				}
				batch = make([]*wshrpc.FileInfo, 0, wshrpc.DirChunkSize)
			}
		}
		if len(batch) > 0 {
			send(wshrpc.RespOrErrorUnion[wshrpc.CommandRemoteListEntriesRtnData]{Response: wshrpc.CommandRemoteListEntriesRtnData{FileInfo: batch}})
		}
	}()
	return ch
}

func sftpRead(ctx context.Context, conn *connparse.Connection, at *wshrpc.FileDataAt) (*wshrpc.FileData, error) {
	client, err := openSFTP(conn)
	if err != nil {
		return nil, err
	}
	defer client.Close()
	remotePath, err := resolveSFTPPath(client, conn.Path)
	if err != nil {
		return nil, err
	}
	info, err := client.Stat(remotePath)
	if err != nil {
		return nil, err
	}
	fileInfo := sftpFileInfo(conn.Path, info)
	fileInfo.MimeType = sftpMimeType(client, remotePath, info)
	if info.IsDir() {
		return &wshrpc.FileData{Info: fileInfo}, nil
	}
	file, err := client.Open(remotePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var source io.Reader = file
	if at != nil {
		if at.Offset < 0 || at.Size < 0 {
			return nil, fmt.Errorf("invalid file byte range")
		}
		if _, err := file.Seek(at.Offset, io.SeekStart); err != nil {
			return nil, err
		}
		if at.Size > 0 {
			source = io.LimitReader(file, int64(at.Size))
		}
	}
	data, err := io.ReadAll(io.LimitReader(source, RemoteFileTransferSizeLimit+1))
	if err != nil {
		return nil, err
	}
	if len(data) > RemoteFileTransferSizeLimit {
		return nil, fmt.Errorf("remote file exceeds the %d byte read limit", RemoteFileTransferSizeLimit)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return &wshrpc.FileData{Info: fileInfo, Data64: base64.StdEncoding.EncodeToString(data)}, nil
}

func sftpWrite(conn *connparse.Connection, data wshrpc.FileData) error {
	client, err := openSFTP(conn)
	if err != nil {
		return err
	}
	defer client.Close()
	remotePath, err := resolveSFTPPath(client, conn.Path)
	if err != nil {
		return err
	}
	raw, err := base64.StdEncoding.DecodeString(data.Data64)
	if err != nil {
		return err
	}
	if len(raw) > RemoteFileTransferSizeLimit {
		return fmt.Errorf("file data exceeds the %d byte write limit", RemoteFileTransferSizeLimit)
	}
	appendMode := data.Info != nil && data.Info.Opts != nil && data.Info.Opts.Append
	if data.At == nil && !appendMode {
		createMode := os.FileMode(0)
		if data.Info != nil {
			createMode = data.Info.Mode.Perm()
		}
		return sftpSaveFile(client, remotePath, raw, createMode)
	}
	flags := os.O_CREATE | os.O_WRONLY
	if appendMode {
		flags |= os.O_APPEND
	}
	file, err := client.OpenFile(remotePath, flags)
	if err != nil {
		return err
	}
	defer file.Close()
	if flags&os.O_APPEND != 0 {
		if _, err := file.Seek(0, io.SeekEnd); err != nil {
			return err
		}
	}
	if data.At != nil && data.At.Offset > 0 {
		_, err = file.WriteAt(raw, data.At.Offset)
	} else {
		_, err = file.Write(raw)
	}
	return err
}

func sftpMkdir(conn *connparse.Connection) error {
	client, err := openSFTP(conn)
	if err != nil {
		return err
	}
	defer client.Close()
	remotePath, err := resolveSFTPPath(client, conn.Path)
	if err != nil {
		return err
	}
	return client.Mkdir(remotePath)
}

func sftpDelete(conn *connparse.Connection, recursive bool) error {
	client, err := openSFTP(conn)
	if err != nil {
		return err
	}
	defer client.Close()
	remotePath, err := resolveSFTPPath(client, conn.Path)
	if err != nil {
		return err
	}
	remotePath = path.Clean(remotePath)
	// Lstat, not Stat: deleting a symlink must remove the link, never the directory it points to.
	info, err := client.Lstat(remotePath)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return client.Remove(remotePath)
	}
	if recursive {
		return sftpRemoveAll(client, remotePath)
	}
	if err := client.RemoveDirectory(remotePath); err != nil {
		if stillInfo, statErr := client.Lstat(remotePath); statErr == nil && stillInfo.IsDir() {
			return fmt.Errorf(RecursiveRequiredError)
		}
		return err
	}
	return nil
}

func sftpMove(srcConn, destConn *connparse.Connection, overwrite bool) error {
	client, err := openSFTP(srcConn)
	if err != nil {
		return err
	}
	defer client.Close()
	source, err := resolveSFTPPath(client, srcConn.Path)
	if err != nil {
		return err
	}
	destination, err := resolveSFTPPath(client, destConn.Path)
	if err != nil {
		return err
	}
	if info, statErr := client.Stat(destination); statErr == nil && info.IsDir() {
		destination = path.Join(destination, path.Base(source))
	} else if statErr != nil && !os.IsNotExist(statErr) {
		return statErr
	}
	if existing, statErr := client.Stat(destination); statErr == nil {
		if source == destination {
			return nil
		}
		if !overwrite {
			return fmt.Errorf(OverwriteRequiredError, destination)
		}
		if existing.IsDir() {
			return fmt.Errorf("cannot replace directory %q with a file", destination)
		}
		return client.PosixRename(source, destination)
	} else if !os.IsNotExist(statErr) {
		return statErr
	}
	return client.Rename(source, destination)
}

func sftpFileStream(conn *connparse.Connection, data wshrpc.CommandFileStreamData) (*wshrpc.FileInfo, error) {
	client, err := openSFTP(conn)
	if err != nil {
		return nil, err
	}
	remotePath, err := resolveSFTPPath(client, conn.Path)
	if err != nil {
		client.Close()
		return nil, err
	}
	info, err := client.Stat(remotePath)
	if err != nil {
		client.Close()
		return nil, err
	}
	if info.IsDir() {
		client.Close()
		return nil, fmt.Errorf("cannot stream directory %q", conn.Path)
	}
	if RpcClient == nil || RpcClient.StreamBroker == nil {
		client.Close()
		return nil, fmt.Errorf("stream broker not available")
	}
	byteRange, err := fileutil.ParseByteRange(data.ByteRange)
	if err != nil {
		client.Close()
		return nil, err
	}
	writer, err := RpcClient.StreamBroker.CreateStreamWriter(&data.StreamMeta)
	if err != nil {
		client.Close()
		return nil, err
	}
	go func() {
		defer client.Close()
		defer writer.Close()
		file, err := client.Open(remotePath)
		if err != nil {
			writer.CloseWithError(err)
			return
		}
		defer file.Close()
		if !byteRange.All && byteRange.Start > 0 {
			if _, err := file.Seek(byteRange.Start, io.SeekStart); err != nil {
				writer.CloseWithError(err)
				return
			}
		}
		var source io.Reader = file
		if !byteRange.All && !byteRange.OpenEnd {
			source = io.LimitReader(file, byteRange.End-byteRange.Start+1)
		}
		if _, err := io.Copy(writer, source); err != nil {
			writer.CloseWithError(err)
		}
	}()
	fileInfo := sftpFileInfo(conn.Path, info)
	fileInfo.MimeType = sftpMimeType(client, remotePath, info)
	return fileInfo, nil
}
