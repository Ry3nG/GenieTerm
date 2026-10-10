// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package fsutil

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
)

const (
	OverwriteRequiredError = "file already exists at %q, set overwrite flag to delete the existing file"
	MergeRequiredError     = "directory already exists at %q, set overwrite flag to delete the existing contents or set merge flag to merge the contents"
)

type CopyEntry struct {
	Path  string
	Name  string
	Size  int64
	Mode  os.FileMode
	IsDir bool
}

// CopySource is the read side of a copy. Stat follows symlinks; ReadDir entries do not.
type CopySource interface {
	Stat(p string) (*CopyEntry, error)
	ReadDir(p string) ([]*CopyEntry, error)
	Open(p string) (io.ReadCloser, error)
}

// CopyDest is the write side of a copy. Stat follows symlinks and returns (nil, nil) for a missing
// path. WriteFile must replace atomically. RemoveAll must not follow a top-level symlink.
type CopyDest interface {
	Stat(p string) (*CopyEntry, error)
	Join(dir string, name string) string
	Dir(p string) string
	Base(p string) string
	Mkdir(p string, mode os.FileMode) error
	WriteFile(p string, r io.Reader, mode os.FileMode, expectedSize int64) error
	Rename(oldPath string, newPath string) error
	RemoveAll(p string) error
}

type CopyOpts struct {
	Overwrite bool
	Merge     bool
}

func ResolveCopyDestPath(dest CopyDest, destPath string, srcBaseName string, destHasSlash bool) (string, error) {
	if destHasSlash {
		return dest.Join(destPath, srcBaseName), nil
	}
	info, err := dest.Stat(destPath)
	if err != nil {
		return "", fmt.Errorf("cannot stat destination %q: %w", destPath, err)
	}
	if info != nil && info.IsDir {
		return dest.Join(destPath, srcBaseName), nil
	}
	return destPath, nil
}

// IsPathWithin reports whether child is parent or lies under it (both must be cleaned, same separator).
func IsPathWithin(parent string, child string, separator string) bool {
	if child == parent {
		return true
	}
	return strings.HasPrefix(child, strings.TrimSuffix(parent, separator)+separator)
}

// CopyTree copies srcEntry to destPath. Files replace atomically (overwrite required if the
// destination exists). Directories are copied into a staging directory and swapped in only on
// success; with Merge the source tree is copied into the existing directory, replacing files.
// Symlinks inside a directory tree are copied as their target file contents; symlinked
// directories and special files are skipped.
func CopyTree(ctx context.Context, src CopySource, srcEntry *CopyEntry, dest CopyDest, destPath string, opts CopyOpts) error {
	if opts.Overwrite && opts.Merge {
		return fmt.Errorf("cannot specify both overwrite and merge")
	}
	existing, err := dest.Stat(destPath)
	if err != nil {
		return fmt.Errorf("cannot stat destination %q: %w", destPath, err)
	}
	if !srcEntry.IsDir {
		if !srcEntry.Mode.IsRegular() {
			return fmt.Errorf("cannot copy %q: not a regular file", srcEntry.Path)
		}
		if existing != nil {
			if existing.IsDir {
				return fmt.Errorf("cannot overwrite directory %q with a file", destPath)
			}
			if !opts.Overwrite {
				return fmt.Errorf(OverwriteRequiredError, destPath)
			}
		}
		return copyOneFile(ctx, src, srcEntry, dest, destPath)
	}
	if existing == nil {
		return copyDirStaged(ctx, src, srcEntry, dest, destPath, false)
	}
	if existing.IsDir && opts.Merge {
		return copyDirContents(ctx, src, srcEntry, dest, destPath)
	}
	if !opts.Overwrite {
		if existing.IsDir {
			return fmt.Errorf(MergeRequiredError, destPath)
		}
		return fmt.Errorf(OverwriteRequiredError, destPath)
	}
	return copyDirStaged(ctx, src, srcEntry, dest, destPath, true)
}

func copyOneFile(ctx context.Context, src CopySource, srcEntry *CopyEntry, dest CopyDest, destPath string) error {
	if err := ctx.Err(); err != nil {
		return context.Cause(ctx)
	}
	reader, err := src.Open(srcEntry.Path)
	if err != nil {
		return fmt.Errorf("cannot open %q: %w", srcEntry.Path, err)
	}
	defer reader.Close()
	if err := dest.WriteFile(destPath, reader, srcEntry.Mode.Perm(), srcEntry.Size); err != nil {
		return fmt.Errorf("cannot copy %q to %q: %w", srcEntry.Path, destPath, err)
	}
	return nil
}

func makeSiblingTempPath(dest CopyDest, destPath string) (string, error) {
	tempName, err := MakeTempName(dest.Base(destPath))
	if err != nil {
		return "", err
	}
	return dest.Join(dest.Dir(destPath), tempName), nil
}

func copyDirStaged(ctx context.Context, src CopySource, srcEntry *CopyEntry, dest CopyDest, destPath string, replaceExisting bool) error {
	stagingPath, err := makeSiblingTempPath(dest, destPath)
	if err != nil {
		return err
	}
	if err := dest.Mkdir(stagingPath, srcEntry.Mode.Perm()|0700); err != nil {
		return fmt.Errorf("cannot create directory next to %q: %w", destPath, err)
	}
	if err := copyDirContents(ctx, src, srcEntry, dest, stagingPath); err != nil {
		removeStaging(dest, stagingPath)
		return err
	}
	if !replaceExisting {
		if err := dest.Rename(stagingPath, destPath); err != nil {
			removeStaging(dest, stagingPath)
			return fmt.Errorf("cannot move copied directory into place at %q: %w", destPath, err)
		}
		return nil
	}
	backupPath, err := makeSiblingTempPath(dest, destPath)
	if err != nil {
		removeStaging(dest, stagingPath)
		return err
	}
	if err := dest.Rename(destPath, backupPath); err != nil {
		removeStaging(dest, stagingPath)
		return fmt.Errorf("cannot move existing %q aside: %w", destPath, err)
	}
	if err := dest.Rename(stagingPath, destPath); err != nil {
		if restoreErr := dest.Rename(backupPath, destPath); restoreErr != nil {
			log.Printf("copy: cannot restore %q from %q: %v\n", destPath, backupPath, restoreErr)
		}
		removeStaging(dest, stagingPath)
		return fmt.Errorf("cannot move copied directory into place at %q: %w", destPath, err)
	}
	if err := dest.RemoveAll(backupPath); err != nil {
		log.Printf("copy: replaced %q but cannot remove previous contents at %q: %v\n", destPath, backupPath, err)
	}
	return nil
}

func removeStaging(dest CopyDest, stagingPath string) {
	if err := dest.RemoveAll(stagingPath); err != nil {
		log.Printf("copy: cannot remove staging directory %q: %v\n", stagingPath, err)
	}
}

func copyDirContents(ctx context.Context, src CopySource, srcDir *CopyEntry, dest CopyDest, destDir string) error {
	if err := ctx.Err(); err != nil {
		return context.Cause(ctx)
	}
	entries, err := src.ReadDir(srcDir.Path)
	if err != nil {
		return fmt.Errorf("cannot read directory %q: %w", srcDir.Path, err)
	}
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return context.Cause(ctx)
		}
		if entry.Name == "" || entry.Name == "." || entry.Name == ".." {
			continue
		}
		if entry.Mode&os.ModeSymlink != 0 {
			resolved, err := src.Stat(entry.Path)
			if err != nil {
				log.Printf("copy: skipping symlink %q: %v\n", entry.Path, err)
				continue
			}
			if resolved.IsDir {
				log.Printf("copy: skipping symlinked directory %q\n", entry.Path)
				continue
			}
			entry = &CopyEntry{Path: entry.Path, Name: entry.Name, Size: resolved.Size, Mode: resolved.Mode, IsDir: false}
		}
		childDest := dest.Join(destDir, entry.Name)
		existing, err := dest.Stat(childDest)
		if err != nil {
			return fmt.Errorf("cannot stat destination %q: %w", childDest, err)
		}
		if entry.IsDir {
			if existing == nil {
				if err := dest.Mkdir(childDest, entry.Mode.Perm()|0700); err != nil {
					return fmt.Errorf("cannot create directory %q: %w", childDest, err)
				}
			} else if !existing.IsDir {
				return fmt.Errorf("cannot merge directory %q into existing file %q", entry.Path, childDest)
			}
			if err := copyDirContents(ctx, src, entry, dest, childDest); err != nil {
				return err
			}
			continue
		}
		if !entry.Mode.IsRegular() {
			log.Printf("copy: skipping special file %q\n", entry.Path)
			continue
		}
		if existing != nil && existing.IsDir {
			return fmt.Errorf("cannot overwrite directory %q with a file", childDest)
		}
		if err := copyOneFile(ctx, src, entry, dest, childDest); err != nil {
			return err
		}
	}
	return nil
}

type LocalCopySource struct{}

func localCopyEntry(p string, info os.FileInfo) *CopyEntry {
	return &CopyEntry{Path: p, Name: info.Name(), Size: info.Size(), Mode: info.Mode(), IsDir: info.IsDir()}
}

func (LocalCopySource) Stat(p string) (*CopyEntry, error) {
	info, err := os.Stat(p)
	if err != nil {
		return nil, err
	}
	return localCopyEntry(p, info), nil
}

func (LocalCopySource) ReadDir(p string) ([]*CopyEntry, error) {
	dirEntries, err := os.ReadDir(p)
	if err != nil {
		return nil, err
	}
	rtn := make([]*CopyEntry, 0, len(dirEntries))
	for _, dirEntry := range dirEntries {
		info, err := dirEntry.Info()
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				continue
			}
			return nil, err
		}
		rtn = append(rtn, localCopyEntry(filepath.Join(p, dirEntry.Name()), info))
	}
	return rtn, nil
}

func (LocalCopySource) Open(p string) (io.ReadCloser, error) {
	return os.Open(p)
}

type LocalCopyDest struct{}

func (LocalCopyDest) Stat(p string) (*CopyEntry, error) {
	info, err := os.Stat(p)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return localCopyEntry(p, info), nil
}

func (LocalCopyDest) Join(dir string, name string) string {
	return filepath.Join(dir, name)
}

func (LocalCopyDest) Dir(p string) string {
	return filepath.Dir(p)
}

func (LocalCopyDest) Base(p string) string {
	return filepath.Base(p)
}

func (LocalCopyDest) Mkdir(p string, mode os.FileMode) error {
	return os.Mkdir(p, mode)
}

func (LocalCopyDest) WriteFile(p string, r io.Reader, mode os.FileMode, expectedSize int64) error {
	target, err := ResolveLocalWriteTarget(p)
	if err != nil {
		return err
	}
	_, err = ReplaceLocalFile(target, r, ReplaceOpts{CreateMode: mode, ExpectedSize: expectedSize})
	return err
}

func (LocalCopyDest) Rename(oldPath string, newPath string) error {
	return os.Rename(oldPath, newPath)
}

func (LocalCopyDest) RemoveAll(p string) error {
	return os.RemoveAll(p)
}
