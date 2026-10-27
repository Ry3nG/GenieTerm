// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fsutil

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/Ry3nG/GenieTerm/pkg/util/utilfn"
)

const (
	TempFilePrefix     = ".genieterm-"
	TempBaseNameMaxLen = 64
	MaxSymlinkDepth    = 40
	DefaultFileMode    = os.FileMode(0644)
)

// ErrAtomicReplaceUnavailable marks failures where the file could not be replaced via
// temp-file-and-rename without losing something (directory not writable, foreign owner,
// hard links). Callers that hold the data in memory may fall back to an in-place write.
var ErrAtomicReplaceUnavailable = errors.New("atomic replace unavailable")

type ReplaceOpts struct {
	CreateMode os.FileMode
	// ExpectedSize is the minimum number of bytes the reader must produce; -1 disables the check.
	ExpectedSize int64
	// StrictOwner makes ownership/hard-link loss an ErrAtomicReplaceUnavailable error instead of best-effort.
	StrictOwner bool
}

type FileOwner struct {
	Uid   int
	Gid   int
	Nlink uint64
}

func MakeTempName(baseName string) (string, error) {
	randHex, err := utilfn.RandomHexString(12)
	if err != nil {
		return "", err
	}
	if len(baseName) > TempBaseNameMaxLen {
		baseName = baseName[:TempBaseNameMaxLen]
	}
	return TempFilePrefix + baseName + "-" + randHex + ".tmp", nil
}

// PreservedMode keeps permission and setuid/setgid/sticky bits of an existing file.
func PreservedMode(mode os.FileMode) os.FileMode {
	return mode & (os.ModePerm | os.ModeSetuid | os.ModeSetgid | os.ModeSticky)
}

func IncompleteTransferError(target string, got int64, want int64) error {
	return fmt.Errorf("incomplete transfer for %q: received %d of %d bytes", target, got, want)
}

// ResolveLocalWriteTarget follows symlinks so a replace lands on the link target instead of
// swapping the link itself for a regular file. Dangling links resolve to their (missing) target.
func ResolveLocalWriteTarget(p string) (string, error) {
	current := p
	for i := 0; i < MaxSymlinkDepth; i++ {
		info, err := os.Lstat(current)
		if errors.Is(err, fs.ErrNotExist) {
			return current, nil
		}
		if err != nil {
			return "", err
		}
		if info.Mode()&os.ModeSymlink == 0 {
			return current, nil
		}
		target, err := os.Readlink(current)
		if err != nil {
			return "", err
		}
		if !filepath.IsAbs(target) {
			target = filepath.Join(filepath.Dir(current), target)
		}
		current = filepath.Clean(target)
	}
	return "", fmt.Errorf("too many levels of symbolic links: %q", p)
}

// ReplaceLocalFile streams r into a temp file next to target (same filesystem), fsyncs it, copies the
// existing file's mode/owner and replaces target only after the write succeeds. Failures before
// replacement leave the original untouched and remove the temp file. A partial Windows replacement
// failure restores the original when possible, otherwise the error reports its retained backup path.
func ReplaceLocalFile(target string, r io.Reader, opts ReplaceOpts) (int64, error) {
	existing, err := os.Stat(target)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return 0, fmt.Errorf("cannot stat %q: %w", target, err)
	}
	if existing != nil && existing.IsDir() {
		return 0, fmt.Errorf("cannot overwrite directory %q with a file", target)
	}
	var owner FileOwner
	hasOwner := false
	if existing != nil {
		owner, hasOwner = GetFileOwner(existing)
		if opts.StrictOwner {
			links, err := localFileLinkCount(target, existing)
			if err != nil {
				return 0, fmt.Errorf("%w: cannot check hard links for %q: %v", ErrAtomicReplaceUnavailable, target, err)
			}
			if links > 1 {
				return 0, fmt.Errorf("%w: %q has multiple hard links", ErrAtomicReplaceUnavailable, target)
			}
		}
	}
	createMode := opts.CreateMode.Perm()
	if createMode == 0 {
		createMode = DefaultFileMode
	}
	tempName, err := MakeTempName(filepath.Base(target))
	if err != nil {
		return 0, err
	}
	tempPath := filepath.Join(filepath.Dir(target), tempName)
	file, err := createLocalReplacement(tempPath, target, createMode, existing != nil)
	if err != nil {
		if errors.Is(err, fs.ErrPermission) {
			return 0, fmt.Errorf("%w: cannot create temp file in %q: %v", ErrAtomicReplaceUnavailable, filepath.Dir(target), err)
		}
		return 0, fmt.Errorf("cannot create temp file in %q: %w", filepath.Dir(target), err)
	}
	closed := false
	renamed := false
	defer func() {
		if !closed {
			file.Close()
		}
		if !renamed {
			os.Remove(tempPath)
		}
	}()
	if existing != nil {
		if err := prepareLocalReplacement(target, tempPath); err != nil {
			return 0, fmt.Errorf("cannot preserve permissions for %q: %w", target, err)
		}
	}
	n, err := io.Copy(file, r)
	if err != nil {
		return n, err
	}
	if opts.ExpectedSize >= 0 && n < opts.ExpectedSize {
		return n, IncompleteTransferError(target, n, opts.ExpectedSize)
	}
	if existing != nil {
		// chown before chmod: chown clears setuid/setgid bits on Linux
		if hasOwner {
			if err := file.Chown(owner.Uid, owner.Gid); err != nil && opts.StrictOwner {
				return n, fmt.Errorf("%w: cannot preserve owner of %q: %v", ErrAtomicReplaceUnavailable, target, err)
			}
		}
		if err := file.Chmod(PreservedMode(existing.Mode())); err != nil {
			return n, fmt.Errorf("cannot set mode on %q: %w", tempPath, err)
		}
	}
	if err := file.Sync(); err != nil {
		return n, fmt.Errorf("cannot sync %q: %w", tempPath, err)
	}
	closed = true
	if err := file.Close(); err != nil {
		return n, fmt.Errorf("cannot close %q: %w", tempPath, err)
	}
	if err := commitLocalReplacement(tempPath, target, existing != nil); err != nil {
		return n, fmt.Errorf("cannot replace %q: %w", target, err)
	}
	renamed = true
	syncLocalDir(filepath.Dir(target))
	return n, nil
}

func WriteLocalFileInPlace(target string, data []byte) error {
	file, err := os.OpenFile(target, os.O_WRONLY|os.O_TRUNC, 0)
	if err != nil {
		return fmt.Errorf("cannot open %q for writing: %w", target, err)
	}
	n, writeErr := file.Write(data)
	syncErr := file.Sync()
	closeErr := file.Close()
	if writeErr != nil {
		return fmt.Errorf("cannot write %q: %w", target, writeErr)
	}
	if n != len(data) {
		return fmt.Errorf("cannot write %q: %w", target, io.ErrShortWrite)
	}
	if syncErr != nil {
		return fmt.Errorf("cannot sync %q: %w", target, syncErr)
	}
	return closeErr
}

// SaveLocalFile replaces the contents of p (following symlinks) atomically when possible. When the
// directory is not writable or ownership/hard links can't be preserved it falls back to truncating
// and rewriting the existing file in place, which is what editors do in the same situation.
func SaveLocalFile(p string, data []byte, createMode os.FileMode) error {
	target, err := ResolveLocalWriteTarget(p)
	if err != nil {
		return err
	}
	// a rename would silently replace a read-only file, so require the same write access an in-place save needs
	if probe, probeErr := os.OpenFile(target, os.O_WRONLY, 0); probeErr == nil {
		probe.Close()
	} else if !errors.Is(probeErr, fs.ErrNotExist) {
		return fmt.Errorf("cannot write %q: %w", target, probeErr)
	}
	_, err = ReplaceLocalFile(target, bytes.NewReader(data), ReplaceOpts{CreateMode: createMode, ExpectedSize: int64(len(data)), StrictOwner: true})
	if err == nil || !errors.Is(err, ErrAtomicReplaceUnavailable) {
		return err
	}
	if _, statErr := os.Stat(target); statErr != nil {
		return err
	}
	return WriteLocalFileInPlace(target, data)
}

func syncLocalDir(dir string) {
	d, err := os.Open(dir)
	if err != nil {
		return
	}
	// best effort: directory fsync is unsupported on some platforms (e.g. Windows)
	d.Sync()
	d.Close()
}
