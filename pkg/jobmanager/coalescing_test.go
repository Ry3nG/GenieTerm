// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobmanager

import (
	"bytes"
	"testing"
	"testing/synctest"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

func TestSenderCoalescing(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		sm := MakeStreamManager()
		defer sm.Close()
		sender := &testWriter{}
		if _, err := sm.ClientConnected("1", sender, CwndSize, 0); err != nil {
			t.Fatal(err)
		}
		sm.handleReadData([]byte("a"))
		synctest.Wait()
		if got := sender.GetPackets(); len(got) != 1 || decodeData(got[0].Data64) != "a" {
			t.Fatalf("first packet: %+v", got)
		}
		sm.handleReadData([]byte("b"))
		sm.handleReadData([]byte("c"))
		synctest.Wait()
		if len(sender.GetPackets()) != 1 {
			t.Fatal("burst sent before deadline")
		}
		time.Sleep(SendCoalesceWindow)
		synctest.Wait()
		if got := sender.GetPackets(); len(got) != 2 || decodeData(got[1].Data64) != "bc" {
			t.Fatalf("batch: %+v", got)
		}
		sm.handleReadData(bytes.Repeat([]byte("d"), MaxPacketSize))
		synctest.Wait()
		if got := sender.GetPackets(); len(got) != 3 || len(decodeData(got[2].Data64)) != MaxPacketSize {
			t.Fatal("full packet waited")
		}
		time.Sleep(2 * SendCoalesceWindow)
		sm.handleReadData([]byte("e"))
		synctest.Wait()
		if len(sender.GetPackets()) != 4 {
			t.Fatal("idle echo waited")
		}
		sm.handleReadData([]byte("f"))
		sm.handleEOF()
		synctest.Wait()
		got := sender.GetPackets()
		if len(got) != 5 || decodeData(got[4].Data64) != "f" {
			t.Fatalf("EOF tail was delayed: %+v", got)
		}
		sm.RecvAck(wshrpc.CommandStreamAckData{Id: "1", Seq: MaxPacketSize + 5, RWnd: CwndSize})
		synctest.Wait()
		got = sender.GetPackets()
		if len(got) != 6 || !got[5].Eof || got[5].Seq != MaxPacketSize+5 {
			t.Fatalf("EOF ordering: %+v", got)
		}
	})
}

func TestSenderSmallWindowAndReconnect(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		sm := MakeStreamManager()
		defer sm.Close()
		sender := &testWriter{}
		if _, err := sm.ClientConnected("old", sender, 2, 0); err != nil {
			t.Fatal(err)
		}
		sm.handleReadData([]byte("a"))
		synctest.Wait()
		sm.handleReadData([]byte("b"))
		synctest.Wait()
		if len(sender.GetPackets()) != 2 {
			t.Fatal("last byte of window was delayed")
		}
		sm.ClientDisconnected()
		sender.Clear()
		if _, err := sm.ClientConnected("new", sender, CwndSize, 0); err != nil {
			t.Fatal(err)
		}
		synctest.Wait()
		got := sender.GetPackets()
		if len(got) != 1 || got[0].Id != "new" || got[0].Seq != 0 || decodeData(got[0].Data64) != "ab" {
			t.Fatalf("replay: %+v", got)
		}
		sm.RecvAck(wshrpc.CommandStreamAckData{Id: "old", Seq: 2, RWnd: CwndSize})
		if sm.buf.Size() != 2 {
			t.Fatal("stale stream ACK consumed replay")
		}
	})
}

func TestSenderCloseUnblocksFullBuffer(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		sm := MakeStreamManagerWithSizes(4, 4)
		exited := make(chan struct{})
		go func() { sm.handleReadData([]byte("12345")); close(exited) }()
		synctest.Wait()
		sm.Close()
		<-exited
	})
}
