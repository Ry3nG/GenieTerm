// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"sync"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/panichandler"
)

const (
	OutputCoalesceWindow   = 4 * time.Millisecond
	OutputCoalesceMaxBytes = 64 * 1024
)

// A program writing line by line makes every pty read return a few bytes, and each read used to become its
// own append event (offset, epoch, base64 and routing envelope included). The coalescer forwards the first
// chunk after an idle period immediately, so keystroke echo is not delayed, then batches whatever arrives
// during the following window into a single flush.
type outputCoalescer struct {
	lock     sync.Mutex
	pending  []byte
	inWindow bool
	closed   bool
	window   time.Duration
	maxBytes int
	flushFn  func(data []byte)
}

func MakeOutputCoalescer(window time.Duration, maxBytes int, flushFn func(data []byte)) *outputCoalescer {
	return &outputCoalescer{
		window:   window,
		maxBytes: maxBytes,
		flushFn:  flushFn,
	}
}

// Write never retains data after it returns, so callers may reuse their read buffer.
func (c *outputCoalescer) Write(data []byte) {
	if len(data) == 0 {
		return
	}
	c.lock.Lock()
	defer c.lock.Unlock()
	if c.closed {
		c.flushFn(data)
		return
	}
	if !c.inWindow {
		c.flushFn(data)
		c.startWindow_withlock()
		return
	}
	c.pending = append(c.pending, data...)
	if len(c.pending) >= c.maxBytes {
		c.flush_withlock()
	}
}

// Close flushes anything still pending; later writes are forwarded directly.
func (c *outputCoalescer) Close() {
	c.lock.Lock()
	defer c.lock.Unlock()
	c.flush_withlock()
	c.closed = true
}

func (c *outputCoalescer) startWindow_withlock() {
	c.inWindow = true
	time.AfterFunc(c.window, c.onWindowEnd)
}

func (c *outputCoalescer) onWindowEnd() {
	defer func() {
		panichandler.PanicHandler("blockcontroller:outputcoalescer", recover())
	}()
	c.lock.Lock()
	defer c.lock.Unlock()
	if c.closed || len(c.pending) == 0 {
		c.inWindow = false
		return
	}
	c.flush_withlock()
	c.startWindow_withlock()
}

func (c *outputCoalescer) flush_withlock() {
	if len(c.pending) == 0 {
		return
	}
	data := c.pending
	c.pending = nil
	c.flushFn(data)
}
