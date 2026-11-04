// Copyright 2026, GenieTerm. Apache-2.0.

package wshfs

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/panichandler"
	"github.com/Ry3nG/GenieTerm/pkg/remote/fileshare/fsutil"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"golang.org/x/text/unicode/norm"
)

const DownloadProgressInterval = 250 * time.Millisecond

type downloadProgress struct {
	lock sync.Mutex
	data wshrpc.FileTransferProgress
}

func (p *downloadProgress) add(bytes, files int64) {
	p.lock.Lock()
	defer p.lock.Unlock()
	p.data.BytesTransferred += bytes
	p.data.FilesCompleted += files
}

func (p *downloadProgress) snapshot() wshrpc.FileTransferProgress {
	p.lock.Lock()
	defer p.lock.Unlock()
	return p.data
}

func (p *downloadProgress) skip(_ string) {
	p.lock.Lock()
	defer p.lock.Unlock()
	p.data.FilesSkipped++
}

type downloadReader struct {
	ctx      context.Context
	reader   io.Reader
	progress *downloadProgress
}

func (r *downloadReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := r.reader.Read(p)
	r.progress.add(int64(n), 0)
	return n, err
}

type downloadDest struct {
	fsutil.LocalCopyDest
	ctx      context.Context
	progress *downloadProgress
}

type downloadSource struct{ fsutil.CopySource }

func downloadNameKey(name, platform string) (string, error) {
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\x00") {
		return "", fmt.Errorf("cannot use local file name %q", name)
	}
	if platform == "windows" {
		base := strings.ToUpper(strings.SplitN(name, ".", 2)[0])
		reserved := base == "CON" || base == "PRN" || base == "AUX" || base == "NUL"
		if strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT") {
			suffix := base[3:]
			reserved = len([]rune(suffix)) == 1 && strings.ContainsAny(suffix, "123456789¹²³")
		}
		if reserved || strings.ContainsAny(name, "\\:*?\"<>|") || strings.HasSuffix(name, ".") || strings.HasSuffix(name, " ") || strings.IndexFunc(name, func(r rune) bool { return r < 32 }) >= 0 {
			return "", fmt.Errorf("cannot use local Windows file name %q", name)
		}
		return strings.ToLower(name), nil
	}
	if platform == "darwin" {
		return strings.ToLower(norm.NFD.String(name)), nil
	}
	return name, nil
}

func (s downloadSource) ReadDir(p string) ([]*fsutil.CopyEntry, error) {
	entries, err := s.CopySource.ReadDir(p)
	if err != nil {
		return nil, err
	}
	seen := make(map[string]bool)
	for _, entry := range entries {
		key, err := downloadNameKey(entry.Name, runtime.GOOS)
		if err != nil {
			return nil, err
		}
		if seen[key] {
			return nil, fmt.Errorf("source names collide at destination: %q", entry.Name)
		}
		seen[key] = true
	}
	return entries, nil
}

func (d *downloadDest) Stat(p string) (*fsutil.CopyEntry, error) {
	info, err := os.Lstat(p)
	if err == nil && info.Mode()&os.ModeSymlink != 0 {
		return nil, fmt.Errorf("download destination contains a symbolic link: %q", p)
	}
	return d.LocalCopyDest.Stat(p)
}

func (d *downloadDest) WriteFile(p string, r io.Reader, mode os.FileMode, expectedSize int64) error {
	_, err := fsutil.ReplaceLocalFileContext(d.ctx, p, &downloadReader{ctx: d.ctx, reader: r, progress: d.progress}, fsutil.ReplaceOpts{CreateMode: mode, ExpectedSize: expectedSize})
	if err == nil {
		d.progress.add(0, 1)
	}
	return err
}

func downloadDirectory(ctx context.Context, data wshrpc.CommandFileDownloadDirectoryData, progress *downloadProgress) error {
	if !filepath.IsAbs(data.DestPath) {
		return fmt.Errorf("download destination must be an absolute path")
	}
	conn, err := parseCopyConnection(ctx, data.SrcUri)
	if err != nil {
		return err
	}
	source, sourcePath, closeSource, err := openCopySource(ctx, conn)
	if err != nil {
		return err
	}
	defer closeSource()
	entry, err := source.Stat(sourcePath)
	if err != nil {
		return err
	}
	if !entry.IsDir {
		return fmt.Errorf("download source must be a folder")
	}
	if isLocalCopyConn(conn) {
		within, err := fsutil.IsLocalPathWithin(sourcePath, data.DestPath)
		if err != nil {
			return err
		}
		if within {
			return fmt.Errorf("cannot download a folder into itself")
		}
	}
	dest := &downloadDest{ctx: ctx, progress: progress}
	return fsutil.CopyTree(ctx, downloadSource{source}, entry, dest, data.DestPath, fsutil.CopyOpts{Merge: true, OnSkip: progress.skip})
}

func DownloadDirectory(ctx context.Context, data wshrpc.CommandFileDownloadDirectoryData) chan wshrpc.RespOrErrorUnion[wshrpc.FileTransferProgress] {
	out := make(chan wshrpc.RespOrErrorUnion[wshrpc.FileTransferProgress])
	go func() {
		defer close(out)
		defer func() { panichandler.PanicHandler("DownloadDirectory", recover()) }()
		ctx, cancel := context.WithCancel(ctx)
		progress := &downloadProgress{}
		done := make(chan error, 1)
		defer func() {
			cancel()
			for range done {
			}
		}()
		go func() {
			defer close(done)
			defer func() { panichandler.PanicHandler("downloadDirectory", recover()) }()
			done <- downloadDirectory(ctx, data, progress)
		}()
		ticker := time.NewTicker(DownloadProgressInterval)
		defer ticker.Stop()
		for {
			var response wshrpc.RespOrErrorUnion[wshrpc.FileTransferProgress]
			select {
			case <-ctx.Done():
				return
			case err, ok := <-done:
				if !ok {
					err = fmt.Errorf("folder transfer stopped unexpectedly")
				}
				response = wshrpc.RespOrErrorUnion[wshrpc.FileTransferProgress]{Response: progress.snapshot(), Error: err}
				response.Response.Done = err == nil
			case <-ticker.C:
				// Heartbeats let the streaming RPC consumer cancel even while a remote read is stalled.
				response.Response = progress.snapshot()
			}
			select {
			case <-ctx.Done():
				return
			case out <- response:
			}
			if response.Error != nil || response.Response.Done {
				return
			}
		}
	}()
	return out
}
