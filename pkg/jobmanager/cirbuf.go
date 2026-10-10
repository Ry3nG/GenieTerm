// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobmanager

import (
	"fmt"
	"sync"
)

type CirBuf struct {
	lock       sync.Mutex
	waiterChan chan chan struct{}
	buf        []byte
	readPos    int
	writePos   int
	count      int
	totalSize  int64
	syncMode   bool
	windowSize int
}

func MakeCirBuf(maxSize int, initSyncMode bool) *CirBuf {
	cb := &CirBuf{
		buf:        make([]byte, maxSize),
		syncMode:   initSyncMode,
		waiterChan: make(chan chan struct{}, 1),
		windowSize: maxSize,
	}
	return cb
}

// SetEffectiveWindow changes the sync mode and effective window size for flow control.
// The windowSize is capped at the buffer size.
// When window shrinks: sync mode blocks new writes, async mode truncates old data to enforce limit.
// When window increases: blocked writers are woken up if space becomes available.
func (cb *CirBuf) SetEffectiveWindow(syncMode bool, windowSize int) {
	cb.lock.Lock()
	defer cb.lock.Unlock()

	maxSize := len(cb.buf)
	if windowSize > maxSize {
		windowSize = maxSize
	}

	oldSyncMode := cb.syncMode
	oldWindowSize := cb.windowSize
	cb.windowSize = windowSize
	cb.syncMode = syncMode

	// In async mode, enforce window size by truncating buffer if needed
	if !syncMode && cb.count > windowSize {
		excess := cb.count - windowSize
		cb.readPos = (cb.readPos + excess) % maxSize
		cb.count = windowSize
	}

	// Only sync mode blocks writers, so only wake if we were in sync mode.
	// Wake when window grows (more space available) or switching to async (no longer blocking).
	if oldSyncMode && (windowSize > oldWindowSize || !syncMode) {
		cb.tryWakeWriter()
	}
}

// WriteAvailable attempts to write as much data as possible without blocking.
// Returns the number of bytes written and a channel to wait on if buffer is full (nil if not blocking).
// In sync mode when buffer is full, returns 0 written and a channel that will be closed when space is available.
// The caller should wait on the channel and retry the write.
// NOTE: Only one concurrent blocked write is allowed. Multiple blocked writes will panic.
func (cb *CirBuf) WriteAvailable(data []byte) (int, <-chan struct{}) {
	cb.lock.Lock()
	defer cb.lock.Unlock()
	if len(data) == 0 {
		return 0, nil
	}

	size := len(cb.buf)
	written := len(data)
	if cb.syncMode {
		written = min(written, max(0, cb.windowSize-cb.count))
		if written == 0 && len(data) > 0 {
			spaceAvailable := make(chan struct{})
			if !tryWriteCh(cb.waiterChan, spaceAvailable) {
				panic("CirBuf: multiple concurrent blocked writes not allowed")
			}
			return 0, spaceAvailable
		}
	}
	kept := min(written, cb.windowSize)
	start := (cb.writePos + written - kept) % size
	tail := data[written-kept : written]
	n := copy(cb.buf[start:], tail)
	copy(cb.buf, tail[n:])
	cb.writePos = (cb.writePos + written) % size
	cb.count = min(cb.count+written, cb.windowSize)
	cb.readPos = (cb.writePos - cb.count + size) % size
	cb.totalSize += int64(written)
	return written, nil
}

func (cb *CirBuf) PeekData(data []byte) int {
	return cb.PeekDataAt(0, data)
}

func (cb *CirBuf) PeekDataAt(offset int, data []byte) int {
	cb.lock.Lock()
	defer cb.lock.Unlock()

	if cb.count == 0 || offset >= cb.count {
		return 0
	}

	pos := (cb.readPos + offset) % len(cb.buf)
	read := min(len(data), cb.count-offset)
	n := copy(data[:read], cb.buf[pos:])
	copy(data[n:read], cb.buf)
	return read
}

func (cb *CirBuf) Consume(numBytes int) error {
	cb.lock.Lock()
	defer cb.lock.Unlock()

	if numBytes > cb.count {
		return fmt.Errorf("cannot consume %d bytes, only %d available", numBytes, cb.count)
	}

	size := len(cb.buf)
	cb.readPos = (cb.readPos + numBytes) % size
	cb.count -= numBytes

	cb.tryWakeWriter()

	return nil
}

func (cb *CirBuf) HeadPos() int64 {
	cb.lock.Lock()
	defer cb.lock.Unlock()
	return cb.totalSize - int64(cb.count)
}

func (cb *CirBuf) Size() int {
	cb.lock.Lock()
	defer cb.lock.Unlock()
	return cb.count
}

func (cb *CirBuf) TotalSize() int64 {
	cb.lock.Lock()
	defer cb.lock.Unlock()
	return cb.totalSize
}

func tryWriteCh[T any](ch chan<- T, val T) bool {
	select {
	case ch <- val:
		return true
	default:
		return false
	}
}

func tryReadCh[T any](ch <-chan T) (*T, bool) {
	select {
	case rtn := <-ch:
		return &rtn, true
	default:
		return nil, false
	}
}

func (cb *CirBuf) tryWakeWriter() {
	if waiterCh, ok := tryReadCh(cb.waiterChan); ok {
		close(*waiterCh)
	}
}
