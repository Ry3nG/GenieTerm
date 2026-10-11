// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Ry3nG/GenieTerm/pkg/filestore"
)

// a file that grows by appendPerRead bytes every time it is read, like a terminal with active output
type growingFile struct {
	data          []byte
	appendPerRead int
}

func (f *growingFile) readAt(offset int64, size int64) (int64, []byte, error) {
	f.data = append(f.data, bytes.Repeat([]byte("y"), f.appendPerRead)...)
	end := min(offset+size, int64(len(f.data)))
	if offset >= end {
		return offset, nil, nil
	}
	return offset, f.data[offset:end], nil
}

func TestWriteWaveFileRangeBoundedBySnapshot(t *testing.T) {
	snapshotSize := int64(filestore.DefaultPartDataSize + 1000)
	file := &growingFile{data: bytes.Repeat([]byte("x"), int(snapshotSize)), appendPerRead: 5000}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", snapshotSize))
		if _, err := writeWaveFileRange(w, file.readAt, 0, snapshotSize); err != nil {
			t.Errorf("writeWaveFileRange: %v", err)
		}
	}))
	defer server.Close()

	resp, err := http.Get(server.URL)
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}
	if int64(len(body)) != snapshotSize {
		t.Fatalf("body length = %d, want %d", len(body), snapshotSize)
	}
	if !bytes.Equal(body, bytes.Repeat([]byte("x"), int(snapshotSize))) {
		t.Fatalf("body contains bytes appended after the snapshot")
	}
}

func TestWriteWaveFileRangeOffsetStart(t *testing.T) {
	file := &growingFile{data: []byte("0123456789"), appendPerRead: 3}
	var out bytes.Buffer
	nw, err := writeWaveFileRange(&out, file.readAt, 4, 10)
	if err != nil || nw != 6 || out.String() != "456789" {
		t.Fatalf("got (%d, %v, %q), want (6, nil, \"456789\")", nw, err, out.String())
	}
}

func TestWriteWaveFileRangeTruncatedDuringRead(t *testing.T) {
	readAt := func(offset int64, size int64) (int64, []byte, error) {
		return 0, nil, nil
	}
	var out bytes.Buffer
	if _, err := writeWaveFileRange(&out, readAt, 100, 200); err == nil {
		t.Fatalf("expected an error when the file no longer has the requested range")
	}
}

func TestStreamFileBaseName(t *testing.T) {
	cases := map[string]string{
		"wsh://gpu-box/home/me/runs/demo.mp4": "demo.mp4",
		"~/Movies/clip.mov":                   "clip.mov",
		`wsh://local/C:\Users\me\report.pdf`:  "report.pdf",
		"plain.txt":                           "plain.txt",
		"wsh://gpu-box/home/me/":              "",
	}
	for in, want := range cases {
		if got := streamFileBaseName(in); got != want {
			t.Fatalf("streamFileBaseName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestStreamFileDispositionNamesTheFile(t *testing.T) {
	header := http.Header{}
	setStreamFileDisposition(header, "demo.mp4")
	if got := header.Get("Content-Disposition"); got != "inline; filename=demo.mp4" {
		t.Fatalf("ascii name: %q", got)
	}
	header = http.Header{}
	setStreamFileDisposition(header, "训练 结果.mp4")
	if got := header.Get("Content-Disposition"); !strings.HasPrefix(got, "inline; filename*=utf-8''") {
		t.Fatalf("non-ascii name should use RFC 2231 encoding: %q", got)
	}
	header = http.Header{}
	setStreamFileDisposition(header, `say "hi".pdf`)
	if got := header.Get("Content-Disposition"); got != `inline; filename="say \"hi\".pdf"` {
		t.Fatalf("quoted name: %q", got)
	}
	header = http.Header{}
	setStreamFileDisposition(header, "")
	if got := header.Get("Content-Disposition"); got != "" {
		t.Fatalf("empty name should not set a header: %q", got)
	}
}

func TestLocalStreamFileSendsFilename(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "clip.mp4")
	if err := os.WriteFile(path, []byte("not really a video"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, no404 := range []bool{false, true} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/wave/stream-local-file?path="+path, nil)
		handleLocalStreamFile(rec, req, path, no404)
		if rec.Code != http.StatusOK {
			t.Fatalf("no404=%v: status %d", no404, rec.Code)
		}
		if got := rec.Header().Get("Content-Disposition"); got != "inline; filename=clip.mp4" {
			t.Fatalf("no404=%v: Content-Disposition %q", no404, got)
		}
	}
}
