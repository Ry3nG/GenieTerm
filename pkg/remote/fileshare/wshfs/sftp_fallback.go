// Copyright 2026, GenieTerm. Apache-2.0.

package wshfs

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
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
		return sftpReplaceFile(client, remotePath, raw, data.Info)
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

func sftpReplaceFile(client *sftp.Client, remotePath string, raw []byte, requestedInfo *wshrpc.FileInfo) error {
	existing, statErr := client.Stat(remotePath)
	if statErr != nil && !os.IsNotExist(statErr) {
		return statErr
	}
	if existing != nil && existing.IsDir() {
		return fmt.Errorf("cannot overwrite directory %q", remotePath)
	}
	mode := os.FileMode(0644)
	if existing != nil {
		mode = existing.Mode().Perm()
	} else if requestedInfo != nil && requestedInfo.Mode != 0 {
		mode = requestedInfo.Mode.Perm()
	}
	randomBytes := make([]byte, 8)
	if _, err := rand.Read(randomBytes); err != nil {
		return err
	}
	temporaryPath := path.Join(path.Dir(remotePath), ".genieterm-"+path.Base(remotePath)+"-"+hex.EncodeToString(randomBytes))
	file, err := client.OpenFile(temporaryPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY)
	if err != nil {
		return err
	}
	defer client.Remove(temporaryPath)
	n, writeErr := file.Write(raw)
	closeErr := file.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	if n != len(raw) {
		return io.ErrShortWrite
	}
	if err := client.Chmod(temporaryPath, mode); err != nil {
		return err
	}
	if existing != nil {
		return client.PosixRename(temporaryPath, remotePath)
	}
	return client.Rename(temporaryPath, remotePath)
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
	info, err := client.Stat(remotePath)
	if err != nil {
		return err
	}
	if info.IsDir() {
		if recursive {
			return client.RemoveAll(remotePath)
		}
		return client.RemoveDirectory(remotePath)
	}
	return client.Remove(remotePath)
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

func sftpCopy(ctx context.Context, srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) (bool, error) {
	if opts == nil {
		opts = &wshrpc.FileCopyOpts{}
	}
	if opts.Recursive {
		return false, fmt.Errorf("directory copying is not supported")
	}
	var source *wshrpc.FileData
	var err error
	if srcConn.GetType() == "file" {
		info, statErr := os.Stat(srcConn.Path)
		if statErr != nil {
			return false, statErr
		}
		if info.IsDir() || info.Size() > RemoteFileTransferSizeLimit {
			return false, fmt.Errorf("local upload source must be a file smaller than %d bytes", RemoteFileTransferSizeLimit)
		}
		raw, readErr := os.ReadFile(srcConn.Path)
		if readErr != nil {
			return false, readErr
		}
		source = &wshrpc.FileData{Info: sftpFileInfo(srcConn.Path, info), Data64: base64.StdEncoding.EncodeToString(raw)}
	} else if shouldUseSFTP(srcConn) {
		source, err = sftpRead(ctx, srcConn, nil)
	} else {
		source, err = Read(ctx, wshrpc.FileData{Info: &wshrpc.FileInfo{Path: srcConn.GetFullURI()}})
	}
	if err != nil {
		return false, err
	}
	if source.Info == nil || source.Info.IsDir {
		return false, fmt.Errorf("directory copying is not supported")
	}
	destination := destConn.GetFullURI()
	if strings.HasSuffix(destination, "/") {
		destination += path.Base(srcConn.Path)
	} else {
		var destInfo *wshrpc.FileInfo
		if destConn.GetType() == "file" {
			localInfo, statErr := os.Stat(destConn.Path)
			if statErr == nil {
				destInfo = sftpFileInfo(destConn.Path, localInfo)
			} else if os.IsNotExist(statErr) {
				destInfo = &wshrpc.FileInfo{NotFound: true}
			} else {
				err = statErr
			}
		} else if shouldUseSFTP(destConn) {
			destInfo, err = sftpStat(destConn)
		} else {
			destInfo, err = Stat(ctx, destination)
		}
		if err != nil {
			return false, err
		}
		if destInfo != nil && destInfo.IsDir {
			destination = strings.TrimSuffix(destination, "/") + "/" + path.Base(srcConn.Path)
		} else if destInfo != nil && !destInfo.NotFound && !opts.Overwrite {
			return false, fmt.Errorf(OverwriteRequiredError, destination)
		}
	}
	resolvedDest, err := parseConnection(ctx, destination)
	if err != nil {
		return false, err
	}
	var finalInfo *wshrpc.FileInfo
	if resolvedDest.GetType() == "file" {
		localInfo, statErr := os.Stat(resolvedDest.Path)
		if statErr == nil {
			finalInfo = sftpFileInfo(resolvedDest.Path, localInfo)
		} else if os.IsNotExist(statErr) {
			finalInfo = &wshrpc.FileInfo{NotFound: true}
		} else {
			err = statErr
		}
	} else if shouldUseSFTP(resolvedDest) {
		finalInfo, err = sftpStat(resolvedDest)
	} else {
		finalInfo, err = Stat(ctx, destination)
	}
	if err != nil {
		return false, err
	}
	if finalInfo != nil && !finalInfo.NotFound && !opts.Overwrite {
		return false, fmt.Errorf(OverwriteRequiredError, destination)
	}
	if resolvedDest.GetType() == "file" {
		raw, decodeErr := base64.StdEncoding.DecodeString(source.Data64)
		if decodeErr != nil {
			return false, decodeErr
		}
		mode := source.Info.Mode.Perm()
		if finalInfo != nil && !finalInfo.NotFound {
			mode = finalInfo.Mode.Perm()
		}
		if err := writeLocalCopyFile(resolvedDest.Path, raw, mode); err != nil {
			return false, err
		}
		return false, nil
	}
	if err := PutFile(ctx, wshrpc.FileData{Info: &wshrpc.FileInfo{Path: destination, Mode: source.Info.Mode}, Data64: source.Data64}); err != nil {
		return false, err
	}
	return false, nil
}

func writeLocalCopyFile(destination string, data []byte, mode os.FileMode) error {
	file, err := os.CreateTemp(filepath.Dir(destination), ".genieterm-"+filepath.Base(destination)+"-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err := file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err := file.Chmod(mode); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), destination)
}
