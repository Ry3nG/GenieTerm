// Copyright 2026, GenieTerm. Apache-2.0.

package wshfs

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"

	"github.com/Ry3nG/GenieTerm/pkg/remote/connparse"
	"github.com/Ry3nG/GenieTerm/pkg/remote/fileshare/fspath"
	"github.com/Ry3nG/GenieTerm/pkg/remote/fileshare/fsutil"
	"github.com/Ry3nG/GenieTerm/pkg/wavebase"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc/wshclient"
	"github.com/Ry3nG/GenieTerm/pkg/wshutil"
	"github.com/pkg/sftp"
)

const (
	SFTPFsyncExtension    = "fsync@openssh.com"
	CopyStreamReadWindow  = 256 * 1024
	FolderCopyUnsupported = "folder copy from an SFTP-only connection to a wsh connection isn't supported yet"
	LargeFileUnsupported  = "files over 32 MB can't be copied from an SFTP-only connection to a wsh connection yet"
)

func isSFTPNotExist(err error) bool {
	return errors.Is(err, fs.ErrNotExist) || os.IsNotExist(err)
}

// sftpResolveWriteTarget follows symlinks so a save lands on the link target instead of replacing the link.
func sftpResolveWriteTarget(client *sftp.Client, remotePath string) (string, error) {
	current := remotePath
	for i := 0; i < fsutil.MaxSymlinkDepth; i++ {
		info, err := client.Lstat(current)
		if isSFTPNotExist(err) {
			return current, nil
		}
		if err != nil {
			return "", err
		}
		if info.Mode()&os.ModeSymlink == 0 {
			return current, nil
		}
		target, err := client.ReadLink(current)
		if err != nil {
			return "", err
		}
		if !path.IsAbs(target) {
			target = path.Join(path.Dir(current), target)
		}
		current = path.Clean(target)
	}
	return "", fmt.Errorf("too many levels of symbolic links: %q", remotePath)
}

// sftpReplaceFile is the SFTP counterpart of fsutil.ReplaceLocalFile: stream into a temp file in the
// same directory, copy the existing mode/owner, and rename over target only after a complete write.
func sftpReplaceFile(client *sftp.Client, target string, r io.Reader, opts fsutil.ReplaceOpts) (int64, error) {
	existing, err := client.Stat(target)
	if err != nil && !isSFTPNotExist(err) {
		return 0, fmt.Errorf("cannot stat %q: %w", target, err)
	}
	if err != nil {
		existing = nil
	}
	if existing != nil && existing.IsDir() {
		return 0, fmt.Errorf("cannot overwrite directory %q with a file", target)
	}
	mode := opts.CreateMode.Perm()
	if mode == 0 {
		mode = fsutil.DefaultFileMode
	}
	if existing != nil {
		mode = fsutil.PreservedMode(existing.Mode())
	}
	tempName, err := fsutil.MakeTempName(path.Base(target))
	if err != nil {
		return 0, err
	}
	tempPath := path.Join(path.Dir(target), tempName)
	file, err := client.OpenFile(tempPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY)
	if err != nil {
		if errors.Is(err, fs.ErrPermission) {
			return 0, fmt.Errorf("%w: cannot create temp file in %q: %v", fsutil.ErrAtomicReplaceUnavailable, path.Dir(target), err)
		}
		return 0, fmt.Errorf("cannot create temp file in %q: %w", path.Dir(target), err)
	}
	closed := false
	renamed := false
	defer func() {
		if !closed {
			file.Close()
		}
		if !renamed {
			client.Remove(tempPath)
		}
	}()
	n, err := io.Copy(file, r)
	if err != nil {
		return n, err
	}
	if opts.ExpectedSize >= 0 && n < opts.ExpectedSize {
		return n, fsutil.IncompleteTransferError(target, n, opts.ExpectedSize)
	}
	if existing != nil {
		if stat, ok := existing.Sys().(*sftp.FileStat); ok && stat != nil {
			if err := client.Chown(tempPath, int(stat.UID), int(stat.GID)); err != nil && opts.StrictOwner {
				return n, fmt.Errorf("%w: cannot preserve owner of %q: %v", fsutil.ErrAtomicReplaceUnavailable, target, err)
			}
		}
	}
	if err := client.Chmod(tempPath, mode); err != nil {
		return n, fmt.Errorf("cannot set mode on %q: %w", tempPath, err)
	}
	if _, ok := client.HasExtension(SFTPFsyncExtension); ok {
		if err := file.Sync(); err != nil {
			return n, fmt.Errorf("cannot sync %q: %w", tempPath, err)
		}
	}
	closed = true
	if err := file.Close(); err != nil {
		return n, fmt.Errorf("cannot close %q: %w", tempPath, err)
	}
	if existing != nil {
		err = client.PosixRename(tempPath, target)
	} else {
		err = client.Rename(tempPath, target)
	}
	if err != nil {
		return n, fmt.Errorf("cannot replace %q: %w", target, err)
	}
	renamed = true
	return n, nil
}

func sftpWriteInPlace(client *sftp.Client, target string, raw []byte) error {
	file, err := client.OpenFile(target, os.O_WRONLY|os.O_TRUNC)
	if err != nil {
		return fmt.Errorf("cannot open %q for writing: %w", target, err)
	}
	n, writeErr := file.Write(raw)
	closeErr := file.Close()
	if writeErr != nil {
		return fmt.Errorf("cannot write %q: %w", target, writeErr)
	}
	if n != len(raw) {
		return fmt.Errorf("cannot write %q: %w", target, io.ErrShortWrite)
	}
	return closeErr
}

// sftpSaveFile replaces remotePath (following symlinks) atomically, falling back to an in-place
// truncating write of an existing file when the directory isn't writable or the owner can't be kept.
func sftpSaveFile(client *sftp.Client, remotePath string, raw []byte, createMode os.FileMode) error {
	target, err := sftpResolveWriteTarget(client, remotePath)
	if err != nil {
		return err
	}
	// a rename would silently replace a read-only file, so require the same write access an in-place save needs
	if probe, probeErr := client.OpenFile(target, os.O_WRONLY); probeErr == nil {
		probe.Close()
	} else if !isSFTPNotExist(probeErr) {
		return fmt.Errorf("cannot write %q: %w", target, probeErr)
	}
	_, err = sftpReplaceFile(client, target, bytes.NewReader(raw), fsutil.ReplaceOpts{CreateMode: createMode, ExpectedSize: int64(len(raw)), StrictOwner: true})
	if err == nil || !errors.Is(err, fsutil.ErrAtomicReplaceUnavailable) {
		return err
	}
	if _, statErr := client.Stat(target); statErr != nil {
		return err
	}
	return sftpWriteInPlace(client, target, raw)
}

// sftpRemoveAll deletes a tree without following symlinks (pkg/sftp's RemoveAll Stats the top-level
// path, so a symlinked directory would have its target's contents wiped).
func sftpRemoveAll(client *sftp.Client, remotePath string) error {
	info, err := client.Lstat(remotePath)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return client.Remove(remotePath)
	}
	entries, err := client.ReadDir(remotePath)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.Name() == "." || entry.Name() == ".." {
			continue
		}
		childPath := path.Join(remotePath, entry.Name())
		if entry.IsDir() {
			if err := sftpRemoveAll(client, childPath); err != nil {
				return err
			}
			continue
		}
		if err := client.Remove(childPath); err != nil {
			return err
		}
	}
	return client.RemoveDirectory(remotePath)
}

func sftpCopyEntry(remotePath string, info os.FileInfo) *fsutil.CopyEntry {
	return &fsutil.CopyEntry{Path: remotePath, Name: info.Name(), Size: info.Size(), Mode: info.Mode(), IsDir: info.IsDir()}
}

type sftpCopySource struct {
	client *sftp.Client
}

func (s *sftpCopySource) Stat(p string) (*fsutil.CopyEntry, error) {
	info, err := s.client.Stat(p)
	if err != nil {
		return nil, err
	}
	return sftpCopyEntry(p, info), nil
}

func (s *sftpCopySource) ReadDir(p string) ([]*fsutil.CopyEntry, error) {
	entries, err := s.client.ReadDir(p)
	if err != nil {
		return nil, err
	}
	rtn := make([]*fsutil.CopyEntry, 0, len(entries))
	for _, entry := range entries {
		rtn = append(rtn, sftpCopyEntry(path.Join(p, entry.Name()), entry))
	}
	return rtn, nil
}

func (s *sftpCopySource) Open(p string) (io.ReadCloser, error) {
	return s.client.Open(p)
}

type sftpCopyDest struct {
	client *sftp.Client
}

func (d *sftpCopyDest) Stat(p string) (*fsutil.CopyEntry, error) {
	info, err := d.client.Stat(p)
	if isSFTPNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return sftpCopyEntry(p, info), nil
}

func (d *sftpCopyDest) Join(dir string, name string) string {
	return path.Join(dir, name)
}

func (d *sftpCopyDest) Dir(p string) string {
	return path.Dir(p)
}

func (d *sftpCopyDest) Base(p string) string {
	return path.Base(p)
}

func (d *sftpCopyDest) Mkdir(p string, mode os.FileMode) error {
	if err := d.client.Mkdir(p); err != nil {
		return err
	}
	return d.client.Chmod(p, mode)
}

func (d *sftpCopyDest) WriteFile(p string, r io.Reader, mode os.FileMode, expectedSize int64) error {
	target, err := sftpResolveWriteTarget(d.client, p)
	if err != nil {
		return err
	}
	_, err = sftpReplaceFile(d.client, target, r, fsutil.ReplaceOpts{CreateMode: mode, ExpectedSize: expectedSize})
	return err
}

func (d *sftpCopyDest) Rename(oldPath string, newPath string) error {
	return d.client.Rename(oldPath, newPath)
}

func (d *sftpCopyDest) RemoveAll(p string) error {
	return sftpRemoveAll(d.client, p)
}

// rpcCopySource reads from a wsh-enabled host (or the local main server) through RemoteFileInfo,
// RemoteListEntries and RemoteFileStream, so file contents are streamed rather than buffered.
type rpcCopySource struct {
	ctx   context.Context
	route string
}

func MakeRpcCopySource(ctx context.Context, route string) fsutil.CopySource {
	return &rpcCopySource{ctx: ctx, route: route}
}

func rpcCopyEntry(info *wshrpc.FileInfo) *fsutil.CopyEntry {
	return &fsutil.CopyEntry{Path: info.Path, Name: info.Name, Size: info.Size, Mode: info.Mode, IsDir: info.IsDir}
}

func (s *rpcCopySource) Stat(p string) (*fsutil.CopyEntry, error) {
	info, err := wshclient.RemoteFileInfoCommand(RpcClient, p, &wshrpc.RpcOpts{Route: s.route, Timeout: DefaultTimeout.Milliseconds()})
	if err != nil {
		return nil, err
	}
	if info == nil || info.NotFound {
		return nil, fmt.Errorf("%q: %w", p, fs.ErrNotExist)
	}
	entry := rpcCopyEntry(info)
	entry.Path = p
	return entry, nil
}

func (s *rpcCopySource) ReadDir(p string) ([]*fsutil.CopyEntry, error) {
	var rtn []*fsutil.CopyEntry
	ch := wshclient.RemoteListEntriesCommand(RpcClient, wshrpc.CommandRemoteListEntriesData{Path: p}, &wshrpc.RpcOpts{Route: s.route})
	for respUnion := range ch {
		if respUnion.Error != nil {
			return nil, respUnion.Error
		}
		for _, info := range respUnion.Response.FileInfo {
			rtn = append(rtn, rpcCopyEntry(info))
		}
	}
	return rtn, nil
}

type rpcStreamReadCloser struct {
	reader    io.ReadCloser
	done      chan struct{}
	closeOnce sync.Once
}

func (r *rpcStreamReadCloser) Read(p []byte) (int, error) {
	return r.reader.Read(p)
}

func (r *rpcStreamReadCloser) Close() error {
	r.closeOnce.Do(func() {
		close(r.done)
		r.reader.Close()
	})
	return nil
}

func (s *rpcCopySource) Open(p string) (io.ReadCloser, error) {
	if RpcClient == nil || RpcClient.StreamBroker == nil {
		return nil, fmt.Errorf("stream broker not available")
	}
	if RpcClientRouteId == "" {
		return nil, fmt.Errorf("stream broker route id not available for file copy")
	}
	reader, streamMeta := RpcClient.StreamBroker.CreateStreamReader(RpcClientRouteId, s.route, CopyStreamReadWindow)
	rc := &rpcStreamReadCloser{reader: reader, done: make(chan struct{})}
	go func() {
		select {
		case <-s.ctx.Done():
			reader.Close()
		case <-rc.done:
		}
	}()
	streamData := wshrpc.CommandRemoteFileStreamData{Path: p, StreamMeta: *streamMeta}
	info, err := wshclient.RemoteFileStreamCommand(RpcClient, streamData, &wshrpc.RpcOpts{Route: s.route})
	if err != nil {
		rc.Close()
		return nil, fmt.Errorf("error starting file stream for %q: %w", p, err)
	}
	if info != nil && info.NotFound {
		rc.Close()
		return nil, fmt.Errorf("%q: %w", p, fs.ErrNotExist)
	}
	return rc, nil
}

func isLocalCopyConn(conn *connparse.Connection) bool {
	if conn.GetType() == "file" {
		return true
	}
	return conn.Host == wshrpc.LocalConnName
}

func localCopyPath(conn *connparse.Connection) string {
	if conn.GetType() == "file" {
		return filepath.Clean(conn.Path)
	}
	return filepath.Clean(wavebase.ExpandHomeDirSafe(conn.Path))
}

func noopClose() {}

// sftpCopy only runs in the main server (SFTP connections live there), so "local" endpoints are
// this machine's filesystem and are accessed directly.
func openCopySource(ctx context.Context, conn *connparse.Connection) (fsutil.CopySource, string, func(), error) {
	if isLocalCopyConn(conn) {
		return fsutil.LocalCopySource{}, localCopyPath(conn), noopClose, nil
	}
	if shouldUseSFTP(conn) {
		client, err := openSFTP(conn)
		if err != nil {
			return nil, "", nil, err
		}
		remotePath, err := resolveSFTPPath(client, conn.Path)
		if err != nil {
			client.Close()
			return nil, "", nil, err
		}
		return &sftpCopySource{client: client}, path.Clean(remotePath), func() { client.Close() }, nil
	}
	return MakeRpcCopySource(ctx, wshutil.MakeConnectionRouteId(conn.Host)), conn.Path, noopClose, nil
}

// openCopyDest returns a nil dest for wsh-enabled remote hosts, which can't be streamed to from here.
func openCopyDest(conn *connparse.Connection) (fsutil.CopyDest, string, func(), error) {
	if isLocalCopyConn(conn) {
		return fsutil.LocalCopyDest{}, localCopyPath(conn), noopClose, nil
	}
	if shouldUseSFTP(conn) {
		client, err := openSFTP(conn)
		if err != nil {
			return nil, "", nil, err
		}
		remotePath, err := resolveSFTPPath(client, conn.Path)
		if err != nil {
			client.Close()
			return nil, "", nil, err
		}
		return &sftpCopyDest{client: client}, path.Clean(remotePath), func() { client.Close() }, nil
	}
	return nil, "", noopClose, nil
}

func sftpCopy(ctx context.Context, srcConn, destConn *connparse.Connection, opts *wshrpc.FileCopyOpts) (bool, error) {
	if opts == nil {
		opts = &wshrpc.FileCopyOpts{}
	}
	if opts.Overwrite && opts.Merge {
		return false, fmt.Errorf("cannot specify both overwrite and merge")
	}
	src, srcPath, closeSrc, err := openCopySource(ctx, srcConn)
	if err != nil {
		return false, err
	}
	defer closeSrc()
	srcEntry, err := src.Stat(srcPath)
	if err != nil {
		return false, fmt.Errorf("cannot stat source %q: %w", srcConn.GetFullURI(), err)
	}
	destHasSlash := strings.HasSuffix(destConn.Path, "/")
	srcBaseName := path.Base(fspath.ToSlash(srcConn.Path))
	dest, destPath, closeDest, err := openCopyDest(destConn)
	if err != nil {
		return false, err
	}
	defer closeDest()
	if dest == nil {
		return srcEntry.IsDir, sftpCopyToWsh(ctx, src, srcEntry, srcBaseName, destConn, destHasSlash, opts)
	}
	finalPath, err := fsutil.ResolveCopyDestPath(dest, destPath, srcBaseName, destHasSlash)
	if err != nil {
		return false, err
	}
	if srcEntry.IsDir && isSameCopyNamespace(srcConn, destConn) {
		within := fsutil.IsPathWithin(srcPath, finalPath, "/")
		if isLocalCopyConn(destConn) {
			within, err = fsutil.IsLocalPathWithin(srcPath, finalPath)
			if err != nil {
				return true, fmt.Errorf("cannot check copy destination %q: %w", finalPath, err)
			}
		}
		if within {
			return true, fmt.Errorf("cannot copy directory %q into itself", srcPath)
		}
	}
	err = fsutil.CopyTree(ctx, src, srcEntry, dest, finalPath, fsutil.CopyOpts{Overwrite: opts.Overwrite, Merge: opts.Merge})
	return srcEntry.IsDir, err
}

func isSameCopyNamespace(srcConn, destConn *connparse.Connection) bool {
	if isLocalCopyConn(srcConn) || isLocalCopyConn(destConn) {
		return isLocalCopyConn(srcConn) && isLocalCopyConn(destConn)
	}
	return srcConn.Host == destConn.Host
}

// sftpCopyToWsh handles SFTP -> wsh-enabled host. The destination's copy command pulls from a wsh
// route, which an SFTP-only host doesn't have, so this path still buffers one bounded file.
func sftpCopyToWsh(ctx context.Context, src fsutil.CopySource, srcEntry *fsutil.CopyEntry, srcBaseName string, destConn *connparse.Connection, destHasSlash bool, opts *wshrpc.FileCopyOpts) error {
	if srcEntry.IsDir {
		return errors.New(FolderCopyUnsupported)
	}
	if srcEntry.Size > RemoteFileTransferSizeLimit {
		return errors.New(LargeFileUnsupported)
	}
	destination := destConn.GetFullURI()
	if destHasSlash {
		destination += srcBaseName
	} else {
		destInfo, err := Stat(ctx, destination)
		if err != nil {
			return err
		}
		if destInfo != nil && destInfo.IsDir {
			destination = strings.TrimSuffix(destination, "/") + "/" + srcBaseName
		}
	}
	finalInfo, err := Stat(ctx, destination)
	if err != nil {
		return err
	}
	if finalInfo != nil && !finalInfo.NotFound {
		if finalInfo.IsDir {
			return fmt.Errorf("cannot overwrite directory %q with a file", destination)
		}
		if !opts.Overwrite {
			return fmt.Errorf(OverwriteRequiredError, destination)
		}
	}
	reader, err := src.Open(srcEntry.Path)
	if err != nil {
		return err
	}
	defer reader.Close()
	raw, err := io.ReadAll(io.LimitReader(reader, RemoteFileTransferSizeLimit+1))
	if err != nil {
		return err
	}
	if len(raw) > RemoteFileTransferSizeLimit {
		return errors.New(LargeFileUnsupported)
	}
	if int64(len(raw)) < srcEntry.Size {
		return fsutil.IncompleteTransferError(destination, int64(len(raw)), srcEntry.Size)
	}
	return PutFile(ctx, wshrpc.FileData{Info: &wshrpc.FileInfo{Path: destination, Mode: srcEntry.Mode.Perm()}, Data64: base64.StdEncoding.EncodeToString(raw)})
}
