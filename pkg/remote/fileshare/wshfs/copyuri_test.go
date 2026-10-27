// Copyright 2026, GenieTerm. Apache-2.0.

package wshfs

import (
	"context"
	"path"
	"runtime"
	"strings"
	"testing"

	"github.com/Ry3nG/GenieTerm/pkg/remote/connparse"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

func TestCopyFileURIPreservesOriginPathAcrossHelpers(t *testing.T) {
	for _, uri := range []string{
		"file:///C:/Users/me/%E4%B8%AD%E6%96%87%20O%27Brien%25.txt",
		"file:///tmp/a%20folder/file%23name%3F.txt",
		"file:///a",
		"file:///~literal",
		"file:///~/x",
		"file:///./foo",
		"file:///../foo",
		"file:///",
	} {
		t.Run(uri, func(t *testing.T) {
			origin, err := connparse.ParseURI(uri)
			if err != nil {
				t.Fatal(err)
			}
			conn, err := parseCopyConnection(context.Background(), uri)
			if err != nil {
				t.Fatal(err)
			}
			if conn.Scheme != connparse.ConnectionTypeWsh || conn.Host != wshrpc.LocalConnName {
				t.Fatalf("file endpoint must name the desktop route: %#v", conn)
			}
			reparsed, err := connparse.ParseURI(conn.GetFullURI())
			if err != nil || path.Clean(reparsed.Path) != path.Clean(origin.Path) ||
				strings.HasPrefix(reparsed.Path, "/") != strings.HasPrefix(origin.Path, "/") {
				t.Fatalf("RPC path changed: origin=%q URI=%q parsed=%#v err=%v", origin.Path, conn.GetFullURI(), reparsed, err)
			}
		})
	}
	if runtime.GOOS != "windows" {
		conn, err := parseCopyConnection(context.Background(), "file:///C:/literal-unix-directory")
		if err != nil || path.Clean(conn.Path) != "/C:/literal-unix-directory" || conn.GetFullURI() != "wsh://local//./C:/literal-unix-directory" {
			// GetFullURI must distinguish an absolute Unix /C:/ path from Windows C:/.
			t.Fatalf("literal Unix drive-like path lost: %#v, %v", conn, err)
		}
	}
}

func TestCopyRemotePathsRemainLiteral(t *testing.T) {
	for _, uri := range []string{"wsh://remote//C:/literal%20name", "genie://remote//tmp/O'Brien %25", "file://server/share/file%20name"} {
		before, err := connparse.ParseURI(uri)
		if err != nil {
			t.Fatal(err)
		}
		after, err := parseCopyConnection(context.Background(), uri)
		if err != nil || *before != *after {
			t.Fatalf("remote endpoint changed: before=%#v after=%#v err=%v", before, after, err)
		}
	}
}
