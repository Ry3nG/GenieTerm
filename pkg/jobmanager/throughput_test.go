// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobmanager_test

import (
	"bytes"
	"fmt"
	"io"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/jobcontroller"
	"github.com/Ry3nG/GenieTerm/pkg/jobmanager"
	"github.com/Ry3nG/GenieTerm/pkg/streamclient"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

type linkDelivery[T any] struct {
	at     time.Time
	packet T
}

type delayedLink struct {
	delay    time.Duration
	data     chan linkDelivery[wshrpc.CommandStreamData]
	acks     chan linkDelivery[wshrpc.CommandStreamAckData]
	stop     chan struct{}
	wg       sync.WaitGroup
	packets  atomic.Int64
	ackCount atomic.Int64
}

func deliverLink[T any](l *delayedLink, queue <-chan linkDelivery[T], recv func(T)) {
	defer l.wg.Done()
	timer := time.NewTimer(time.Hour)
	defer timer.Stop()
	for {
		select {
		case <-l.stop:
			return
		case item := <-queue:
			if wait := time.Until(item.at); wait > 0 {
				timer.Reset(wait)
				select {
				case <-l.stop:
					return
				case <-timer.C:
				}
			}
			recv(item.packet)
		}
	}
}

func (l *delayedLink) SendData(p wshrpc.CommandStreamData) {
	l.packets.Add(1)
	select {
	case l.data <- linkDelivery[wshrpc.CommandStreamData]{time.Now().Add(l.delay), p}:
	case <-l.stop:
	}
}
func (l *delayedLink) SendAck(p wshrpc.CommandStreamAckData) {
	l.ackCount.Add(1)
	select {
	case l.acks <- linkDelivery[wshrpc.CommandStreamAckData]{time.Now().Add(l.delay), p}:
	case <-l.stop:
	}
}

func makeHarness(t *testing.T, delay time.Duration) (*io.PipeWriter, *streamclient.Reader, *delayedLink) {
	t.Helper()
	return makeHarnessWithWindow(t, delay, jobcontroller.DefaultStreamRwnd)
}

func makeHarnessWithWindow(t *testing.T, delay time.Duration, rwnd int64) (*io.PipeWriter, *streamclient.Reader, *delayedLink) {
	t.Helper()
	l := &delayedLink{delay: delay, data: make(chan linkDelivery[wshrpc.CommandStreamData], 32768), acks: make(chan linkDelivery[wshrpc.CommandStreamAckData], 32768), stop: make(chan struct{})}
	sm := jobmanager.MakeStreamManager()
	receiver := streamclient.NewReader("perf", rwnd, l)
	l.wg.Add(2)
	go deliverLink(l, l.data, receiver.RecvData)
	go deliverLink(l, l.acks, sm.RecvAck)
	if _, err := sm.ClientConnected("perf", l, int(rwnd), 0); err != nil {
		t.Fatal(err)
	}
	pty, input := io.Pipe()
	if err := sm.AttachReader(pty); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		sm.ClientDisconnected()
		sm.Close()
		input.Close()
		pty.Close()
		receiver.Close()
		close(l.stop)
		l.wg.Wait()
	})
	return input, receiver, l
}

// Fixed payloads and FIFO delivery deadlines make the workload repeatable; wall-clock
// results include Go scheduling and CPU cost, but no simulated bandwidth/serialization limit.
func TestDurableThroughput(t *testing.T) {
	if testing.Short() {
		t.Skip("200k writes and 10 MiB transfers over delayed links")
	}
	for _, delay := range []time.Duration{0, 10 * time.Millisecond, 50 * time.Millisecond} {
		for _, workload := range []string{"lines", "bulk"} {
			t.Run(fmt.Sprintf("%s/%s", workload, delay), func(t *testing.T) {
				runTransfer(t, delay, workload)
			})
		}
	}
}

func runTransfer(t *testing.T, delay time.Duration, workload string) time.Duration {
	t.Helper()
	input, receiver, link := makeHarness(t, delay)
	payload := bytes.Repeat([]byte("abcdef\n"), 200000)
	if workload == "bulk" {
		payload = bytes.Repeat([]byte("x"), 10*1024*1024)
	}
	done := make(chan error, 1)
	start := time.Now()
	go func() {
		var err error
		if workload == "lines" {
			for pos := 0; pos < len(payload); pos += 7 {
				if _, err = input.Write(payload[pos : pos+7]); err != nil {
					break
				}
			}
		} else {
			_, err = input.Write(payload)
		}
		input.Close()
		done <- err
	}()
	got := make([]byte, len(payload))
	if _, err := io.ReadFull(receiver, got); err != nil {
		t.Fatal(err)
	}
	elapsed := time.Since(start)
	if !bytes.Equal(got, payload) {
		t.Fatal("payload mismatch")
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	tail := make([]byte, 1)
	if n, err := receiver.Read(tail); n != 0 || err != io.EOF {
		t.Fatalf("terminal: %d, %v", n, err)
	}
	if elapsed > 0 {
		t.Logf("bytes=%d elapsed=%s MiB/s=%.2f packets=%d acks=%d", len(payload), elapsed, float64(len(payload))/(1<<20)/elapsed.Seconds(), link.packets.Load(), link.ackCount.Load())
	} else {
		t.Logf("bytes=%d elapsed=%s packets=%d acks=%d", len(payload), elapsed, link.packets.Load(), link.ackCount.Load())
	}
	return elapsed
}

func TestDurableEchoLatency(t *testing.T) {
	for _, delay := range []time.Duration{0, 10 * time.Millisecond, 50 * time.Millisecond} {
		t.Run(delay.String(), func(t *testing.T) {
			input, receiver, _ := makeHarness(t, delay)
			for i := 0; i < 3; i++ {
				time.Sleep(10 * time.Millisecond)
				start := time.Now()
				if _, err := input.Write([]byte{'x'}); err != nil {
					t.Fatal(err)
				}
				b := make([]byte, 1)
				if _, err := io.ReadFull(receiver, b); err != nil {
					t.Fatal(err)
				}
				if b[0] != 'x' {
					t.Fatal("echo mismatch")
				}
				t.Logf("echo=%s one-way-delay=%s", time.Since(start), delay)
			}
		})
	}
}

func TestDurableDeterministicLink(t *testing.T) {
	for _, delay := range []time.Duration{0, 10 * time.Millisecond, 50 * time.Millisecond} {
		t.Run(delay.String(), func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				input, receiver, _ := makeHarness(t, delay)
				for i := 0; i < 3; i++ {
					time.Sleep(10 * time.Millisecond)
					start := time.Now()
					if _, err := input.Write([]byte("x")); err != nil {
						t.Fatal(err)
					}
					b := make([]byte, 1)
					if _, err := io.ReadFull(receiver, b); err != nil {
						t.Fatal(err)
					}
					if b[0] != 'x' || time.Since(start) != delay {
						t.Fatalf("echo=%s want=%s data=%q", time.Since(start), delay, b)
					}
				}
			})
		})
	}
}

func TestDurableLegacyReceiveWindow(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		input, receiver, _ := makeHarnessWithWindow(t, 10*time.Millisecond, 64*1024)
		payload := bytes.Repeat([]byte("abcdefg"), 100000)
		go func() { input.Write(payload); input.Close() }()
		// A stopped consumer must eventually reopen a zero receive window.
		time.Sleep(time.Second)
		got, err := io.ReadAll(receiver)
		if err != nil || !bytes.Equal(got, payload) {
			t.Fatalf("legacy window transfer: bytes=%d err=%v", len(got), err)
		}
	})
}

func TestDurableVirtualThroughput(t *testing.T) {
	if testing.Short() {
		t.Skip("200k writes and 10 MiB virtual transfers")
	}
	for _, delay := range []time.Duration{0, 10 * time.Millisecond, 50 * time.Millisecond} {
		for _, workload := range []string{"lines", "bulk"} {
			t.Run(fmt.Sprintf("%s/%s", workload, delay), func(t *testing.T) {
				synctest.Test(t, func(t *testing.T) {
					elapsed := runTransfer(t, delay, workload)
					want := delay
					if workload == "bulk" {
						windows := (10*1024*1024-1)/min(jobmanager.CwndSize, jobcontroller.DefaultStreamRwnd) + 1
						want = time.Duration(2*windows-1) * delay
					}
					if elapsed != want {
						t.Fatalf("virtual delivery=%s want=%s", elapsed, want)
					}
				})
			})
		}
	}
}
