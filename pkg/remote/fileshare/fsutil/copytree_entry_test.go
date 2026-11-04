// Copyright 2026, GenieTerm. Apache-2.0.

package fsutil

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type cancelAtEOFReader struct {
	io.Reader
	cancel context.CancelFunc
}

func (r cancelAtEOFReader) Read(p []byte) (int, error) {
	n, err := r.Reader.Read(p)
	if err == io.EOF {
		r.cancel()
	}
	return n, err
}

func TestCanceledDownloadDoesNotCommitAfterEOF(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "file")
	writeTestFile(t, target, "original")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, err := ReplaceLocalFileContext(ctx, target, cancelAtEOFReader{Reader: strings.NewReader("replacement"), cancel: cancel}, ReplaceOpts{ExpectedSize: 11})
	if err != context.Canceled {
		t.Fatalf("expected cancellation, got %v", err)
	}
	if readTestFile(t, target) != "original" {
		t.Fatal("canceled attempt replaced the destination")
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 1 {
		t.Fatalf("temporary files remain: %v, %v", entries, err)
	}
}

type namedEntrySource struct {
	LocalCopySource
	names []string
}

func (s namedEntrySource) ReadDir(p string) ([]*CopyEntry, error) {
	entries, err := s.LocalCopySource.ReadDir(p)
	if err != nil {
		return nil, err
	}
	var result []*CopyEntry
	for _, name := range s.names {
		entry := *entries[0]
		entry.Name = name
		result = append(result, &entry)
	}
	return result, nil
}

func TestCopyTreeRejectsEscapingAndCollidingEntryNames(t *testing.T) {
	for _, names := range [][]string{{"../outside"}, {"same", "same"}} {
		t.Run(strings.Join(names, ","), func(t *testing.T) {
			root := t.TempDir()
			src := filepath.Join(root, "source")
			writeTestFile(t, filepath.Join(src, "data"), "contents")
			source := namedEntrySource{names: names}
			entry, err := source.Stat(src)
			if err != nil {
				t.Fatal(err)
			}
			dest := filepath.Join(root, "destination")
			err = CopyTree(context.Background(), source, entry, LocalCopyDest{}, dest, CopyOpts{})
			if err == nil {
				t.Fatal("accepted invalid directory entries")
			}
			if _, err := os.Stat(dest); !os.IsNotExist(err) {
				t.Fatalf("partial destination remains: %v", err)
			}
			if _, err := os.Stat(filepath.Join(root, "outside")); !os.IsNotExist(err) {
				t.Fatal("wrote outside destination")
			}
		})
	}
}
