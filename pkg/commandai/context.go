// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package commandai

import (
	"context"
	"io"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/genconn"
	"github.com/Ry3nG/GenieTerm/pkg/remote"
	"github.com/Ry3nG/GenieTerm/pkg/remote/conncontroller"
	"github.com/Ry3nG/GenieTerm/pkg/remote/fileshare/wshfs"
	"github.com/Ry3nG/GenieTerm/pkg/waveobj"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc/wshclient"
	"github.com/Ry3nG/GenieTerm/pkg/wshutil"
	"github.com/Ry3nG/GenieTerm/pkg/wstore"
)

var readBlock = func(ctx context.Context, id string) (*waveobj.Block, error) {
	return wstore.DBGet[*waveobj.Block](ctx, id)
}

var readRTInfo = wstore.GetRTInfo
var distroCache = struct {
	sync.Mutex
	entries map[string]distroEntry
}{entries: make(map[string]distroEntry)}

type distroEntry struct {
	value string
	at    time.Time
}

var fetchDistro = detectDistro

func fillBlockContext(ctx context.Context, req wshrpc.CommandAiRequest) wshrpc.CommandAiRequest {
	c := &req.Context
	if req.BlockId != "" {
		if block, err := readBlock(ctx, req.BlockId); err == nil && block != nil {
			if c.Connection == "" {
				c.Connection, _ = block.Meta["connection"].(string)
			}
			if c.Cwd == "" {
				c.Cwd, _ = block.Meta["cmd:cwd"].(string)
			}
		}
		if rt := readRTInfo(waveobj.ORef{OType: waveobj.OType_Block, OID: req.BlockId}); rt != nil {
			if c.Shell == "" {
				c.Shell = rt.ShellType
			}
			if c.ShellVersion == "" {
				c.ShellVersion = rt.ShellVersion
			}
			if c.Os == "" {
				c.Os = rt.ShellUname
			}
		}
	}
	return req
}

func wantsDistro(c wshrpc.CommandAiContext) bool {
	if c.Distro != "" {
		return false
	}
	if isLocalConnection(c.Connection) {
		return runtime.GOOS == "darwin" || runtime.GOOS == "linux"
	}
	return strings.HasPrefix(c.Os, "Linux")
}

func fillDistro(ctx context.Context, req wshrpc.CommandAiRequest) wshrpc.CommandAiRequest {
	c := &req.Context
	if c.Os == "" && isSSHConnection(c.Connection) {
		fillFromSSH(ctx, c)
		return req
	}
	if wantsDistro(*c) {
		if entry, ok := cachedDistro(c.Connection); ok {
			c.Distro = entry
		} else {
			timeout, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
			defer cancel()
			c.Distro = fetchDistro(timeout, c.Connection)
			if ctx.Err() == nil {
				cacheDistro(c.Connection, c.Distro)
			}
		}
	}
	return req
}

func isLocalConnection(conn string) bool { return conn == "" || conn == "local" }

func isSSHConnection(conn string) bool {
	return !isLocalConnection(conn) && !strings.HasPrefix(conn, "wsl://") && !strings.HasPrefix(conn, "local:")
}

type sshFacts struct {
	uname, shell, distro string
}

var sshFactsCache = struct {
	sync.Mutex
	entries map[string]sshFactsEntry
}{entries: make(map[string]sshFactsEntry)}

type sshFactsEntry struct {
	facts sshFacts
	at    time.Time
}

var probeSSH = probeSSHFacts

func cachedSSHFacts(conn string) (sshFacts, bool) {
	sshFactsCache.Lock()
	defer sshFactsCache.Unlock()
	e, ok := sshFactsCache.entries[conn]
	return e.facts, ok && time.Since(e.at) < 10*time.Minute
}

func cacheSSHFacts(conn string, facts sshFacts) {
	sshFactsCache.Lock()
	defer sshFactsCache.Unlock()
	sshFactsCache.entries[conn] = sshFactsEntry{facts, time.Now()}
}

// A host without the helper (or before shell integration reports in) has no runtime
// info, so the OS, login shell and distribution are read with one short, read-only
// command over the existing SSH connection.
func fillFromSSH(ctx context.Context, c *wshrpc.CommandAiContext) {
	facts, ok := cachedSSHFacts(c.Connection)
	if !ok {
		timeout, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		facts = probeSSH(timeout, c.Connection)
		if ctx.Err() == nil && facts.uname != "" {
			cacheSSHFacts(c.Connection, facts)
		}
	}
	c.Os = facts.uname
	if c.Shell == "" {
		c.Shell = facts.shell
	}
	if c.Distro == "" {
		c.Distro = facts.distro
	}
}

func parseSSHFacts(out string) sshFacts {
	lines := strings.Split(strings.ReplaceAll(out, "\r", ""), "\n")
	get := func(i int) string {
		if i < len(lines) {
			return limit(cleanText(strings.TrimSpace(lines[i]), false), 200)
		}
		return ""
	}
	return sshFacts{uname: get(0), shell: get(1), distro: strings.Trim(get(2), "\"'")}
}

func probeSSHFacts(ctx context.Context, conn string) sshFacts {
	opts, err := remote.ParseOpts(conn)
	if err != nil {
		return sshFacts{}
	}
	sshConn := conncontroller.MaybeGetConn(opts)
	if sshConn == nil {
		return sshFacts{}
	}
	client := sshConn.GetClient()
	if client == nil {
		return sshFacts{}
	}
	spec := genconn.CommandSpec{Cmd: `uname -srm; basename "${SHELL:-sh}"; sed -n 's/^PRETTY_NAME=//p' /etc/os-release 2>/dev/null; true`}
	out, _, err := genconn.RunSimpleCommand(ctx, genconn.MakeSSHShellClient(client), spec)
	if err != nil && strings.TrimSpace(out) == "" {
		return sshFacts{}
	}
	return parseSSHFacts(out)
}

func cachedDistro(conn string) (string, bool) {
	distroCache.Lock()
	defer distroCache.Unlock()
	e, ok := distroCache.entries[conn]
	return e.value, ok && time.Since(e.at) < 10*time.Minute
}

func cacheDistro(conn, value string) {
	distroCache.Lock()
	defer distroCache.Unlock()
	distroCache.entries[conn] = distroEntry{value, time.Now()}
}

func prettyName(osRelease string) string {
	for _, line := range strings.Split(osRelease, "\n") {
		if v, ok := strings.CutPrefix(line, "PRETTY_NAME="); ok {
			return strings.Trim(strings.TrimSpace(v), "\"'")
		}
	}
	return ""
}

func detectDistro(ctx context.Context, conn string) string {
	if isLocalConnection(conn) && runtime.GOOS == "linux" {
		data, err := os.ReadFile("/etc/os-release")
		if err != nil {
			return ""
		}
		return prettyName(string(data))
	}
	if isLocalConnection(conn) {
		name, _, err := runProcess(ctx, "/usr/bin/sw_vers", []string{"-productName"}, "", "", nil)
		if err != nil {
			return ""
		}
		version, _, err := runProcess(ctx, "/usr/bin/sw_vers", []string{"-productVersion"}, "", "", nil)
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(name)) + " " + strings.TrimSpace(string(version))
	}
	rpc := wshfs.RpcClient
	if rpc == nil || rpc.StreamBroker == nil || wshfs.RpcClientRouteId == "" {
		return ""
	}
	route := wshutil.MakeConnectionRouteId(conn)
	reader, meta := rpc.StreamBroker.CreateStreamReader(wshfs.RpcClientRouteId, route, 16384)
	defer reader.Close()
	stop := context.AfterFunc(ctx, func() { reader.Close() })
	defer stop()
	_, err := wshclient.RemoteFileStreamCommand(rpc, wshrpc.CommandRemoteFileStreamData{Path: "/etc/os-release", ByteRange: "0-16383", StreamMeta: *meta}, &wshrpc.RpcOpts{Route: route, Timeout: 1500})
	if err != nil {
		return ""
	}
	data, err := io.ReadAll(io.LimitReader(reader, 16384))
	if err != nil {
		return ""
	}
	return prettyName(string(data))
}
