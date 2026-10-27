// Copyright 2026, GenieTerm. Apache-2.0.

package wshfs_test

import (
	"bytes"
	"context"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/Ry3nG/GenieTerm/pkg/remote/fileshare/wshfs"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc/wshremote"
	"github.com/Ry3nG/GenieTerm/pkg/wshutil"
)

func TestFileURICopyBothDirectionsThroughRPC(t *testing.T) {
	router := wshutil.NewWshRouter()
	router.SetAsRootRouter()
	previousClient, previousRoute := wshfs.RpcClient, wshfs.RpcClientRouteId
	t.Cleanup(func() { wshfs.RpcClient, wshfs.RpcClientRouteId = previousClient, previousRoute })
	for _, host := range []string{"local", "copy-fixture"} {
		rpc := wshutil.MakeWshRpc(wshrpc.RpcContext{Conn: host}, &wshremote.ServerImpl{}, "copy-test-"+host)
		route := wshutil.MakeConnectionRouteId(host)
		link, err := router.RegisterTrustedLeaf(rpc, route)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { router.UnregisterLink(link); close(rpc.InputCh) })
		if host == "local" {
			wshfs.RpcClient, wshfs.RpcClientRouteId = rpc, route
		}
	}
	dir := t.TempDir()
	source := filepath.Join(dir, "上传 O'Brien 中文 %25.txt")
	destination := filepath.Join(dir, "remote-copy.txt")
	download := filepath.Join(dir, "下载 O'Brien 中文.txt")
	contents := bytes.Repeat([]byte("actual RPC payload 中文\n"), 20000)
	if err := os.WriteFile(source, contents, 0600); err != nil {
		t.Fatal(err)
	}
	fileURI := func(p string) string {
		p = filepath.ToSlash(p)
		if runtime.GOOS == "windows" {
			p = "/" + p
		}
		return (&url.URL{Scheme: "file", Path: p}).String()
	}
	remoteURI := "wsh://copy-fixture/" + filepath.ToSlash(destination)
	for _, data := range []wshrpc.CommandFileCopyData{
		{SrcUri: fileURI(source), DestUri: remoteURI, Opts: &wshrpc.FileCopyOpts{Timeout: 5000}},
		{SrcUri: remoteURI, DestUri: fileURI(download), Opts: &wshrpc.FileCopyOpts{Timeout: 5000}},
	} {
		if err := wshfs.Copy(context.Background(), data); err != nil {
			t.Fatal(err)
		}
	}
	for _, copied := range []string{destination, download} {
		got, err := os.ReadFile(copied)
		if err != nil || !bytes.Equal(got, contents) {
			t.Fatalf("copy %q differed: %v", copied, err)
		}
	}
	moveTarget := filepath.Join(dir, "moved 中文.txt")
	if err := wshfs.Move(context.Background(), wshrpc.CommandFileCopyData{SrcUri: fileURI(download), DestUri: fileURI(moveTarget)}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(download); !os.IsNotExist(err) {
		t.Fatalf("move retained source: %v", err)
	}
	got, err := os.ReadFile(moveTarget)
	if err != nil || !bytes.Equal(got, contents) {
		t.Fatalf("moved bytes differed: %v", err)
	}
}
