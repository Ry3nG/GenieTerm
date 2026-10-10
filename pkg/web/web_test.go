// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
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
