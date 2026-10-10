// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobmanager

import (
	"bytes"
	"math/rand"
	"testing"
)

func TestCirBufAgainstSlice(t *testing.T) {
	rng := rand.New(rand.NewSource(123))
	cb := MakeCirBuf(17, true)
	var want []byte
	var total int64
	window, syncMode := 17, true
	for i := 0; i < 10000; i++ {
		switch rng.Intn(3) {
		case 0:
			data := make([]byte, rng.Intn(60))
			rng.Read(data)
			n, wait := cb.WriteAvailable(data)
			expected := len(data)
			if syncMode {
				expected = min(expected, max(0, window-len(want)))
			}
			if n != expected {
				t.Fatalf("write %d: got %d want %d", i, n, expected)
			}
			total += int64(n)
			want = append(want, data[:n]...)
			if !syncMode && len(want) > window {
				want = want[len(want)-window:]
			}
			if wait != nil {
				if n != 0 || !syncMode {
					t.Fatal("unexpected blocked write")
				}
				cb.SetEffectiveWindow(false, window)
				syncMode = false
				if len(want) > window {
					want = want[len(want)-window:]
				}
				select {
				case <-wait:
				default:
					t.Fatal("writer not awakened")
				}
			}
		case 1:
			n := rng.Intn(len(want) + 1)
			if err := cb.Consume(n); err != nil {
				t.Fatal(err)
			}
			want = want[n:]
		case 2:
			syncMode = rng.Intn(2) == 0
			window = rng.Intn(17) + 1
			cb.SetEffectiveWindow(syncMode, window)
			if !syncMode && len(want) > window {
				want = want[len(want)-window:]
			}
		}
		if cb.Size() != len(want) || cb.TotalSize() != total || cb.HeadPos() != total-int64(len(want)) {
			t.Fatalf("positions at step %d", i)
		}
		for offset := 0; offset <= len(want); offset++ {
			got := make([]byte, 30)
			n := cb.PeekDataAt(offset, got)
			if !bytes.Equal(got[:n], want[offset:]) {
				t.Fatalf("peek step=%d offset=%d got=%q want=%q", i, offset, got[:n], want[offset:])
			}
		}
	}
}
