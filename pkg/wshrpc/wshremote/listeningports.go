// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/util/procinfo"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

const (
	listeningScanBudget = 2 * time.Second
	listeningMaxSockets = 65536
	listeningMaxFDs     = 262144
	listeningDirBatch   = 128
)

func parseProcAddress(text string) (string, int, bool) {
	address, portText, ok := strings.Cut(text, ":")
	if !ok || (len(address) != 8 && len(address) != 32) {
		return "", 0, false
	}
	port, err := strconv.ParseUint(portText, 16, 16)
	if err != nil || port == 0 {
		return "", 0, false
	}
	bytes, err := hex.DecodeString(address)
	if err != nil {
		return "", 0, false
	}
	// tcp6 prints each native 32-bit word, not the whole 128-bit address, in reverse order.
	for i := 0; i < len(bytes); i += 4 {
		bytes[i], bytes[i+1], bytes[i+2], bytes[i+3] = bytes[i+3], bytes[i+2], bytes[i+1], bytes[i]
	}
	addr, ok := netip.AddrFromSlice(bytes)
	return addr.String(), int(port), ok
}

func parseProcListeningPorts(text string) ([]wshrpc.ListeningPort, []string) {
	var ports []wshrpc.ListeningPort
	var inodes []string
	for _, line := range strings.Split(text, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 10 || fields[3] != "0A" {
			continue
		}
		address, port, ok := parseProcAddress(fields[1])
		if !ok {
			continue
		}
		if _, err := strconv.ParseUint(fields[9], 10, 64); err != nil {
			continue
		}
		ports = append(ports, wshrpc.ListeningPort{Address: address, Port: port})
		inodes = append(inodes, fields[9])
		if len(ports) == listeningMaxSockets {
			break
		}
	}
	return ports, inodes
}

func parseSocketInode(link string) string {
	if !strings.HasPrefix(link, "socket:[") || !strings.HasSuffix(link, "]") {
		return ""
	}
	inode := strings.TrimSuffix(strings.TrimPrefix(link, "socket:["), "]")
	if _, err := strconv.ParseUint(inode, 10, 64); err != nil {
		return ""
	}
	return inode
}

func numericPID(text string) int32 {
	if text == "" || strings.IndexFunc(text, func(r rune) bool { return r < '0' || r > '9' }) >= 0 {
		return 0
	}
	pid, err := strconv.ParseInt(text, 10, 32)
	if err != nil || pid <= 0 {
		return 0
	}
	return int32(pid)
}

func walkDirectory(ctx context.Context, path string, visit func(string) bool) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	dir, err := os.Open(path)
	if err != nil {
		return err
	}
	defer dir.Close()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		names, err := dir.Readdirnames(listeningDirBatch)
		for _, name := range names {
			if err := ctx.Err(); err != nil {
				return err
			}
			if !visit(name) {
				return nil
			}
		}
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

func mapSocketOwners(ctx context.Context, root string, inodes []string) map[string]int32 {
	pending := make(map[string]bool, len(inodes))
	for _, inode := range inodes {
		pending[inode] = true
	}
	owners := make(map[string]int32)
	if len(pending) == 0 {
		return owners
	}
	work := 0
	_ = walkDirectory(ctx, root, func(name string) bool {
		pid := numericPID(name)
		if pid == 0 {
			return true
		}
		_ = walkDirectory(ctx, filepath.Join(root, name, "fd"), func(fd string) bool {
			work++
			if work > listeningMaxFDs {
				return false
			}
			link, err := os.Readlink(filepath.Join(root, name, "fd", fd))
			if err == nil {
				inode := parseSocketInode(link)
				if pending[inode] {
					owners[inode] = pid
					delete(pending, inode)
				}
			}
			return len(pending) > 0
		})
		return len(pending) > 0 && work <= listeningMaxFDs
	})
	return owners
}

func fillSocketOwners(ports []wshrpc.ListeningPort, inodes []string, owners map[string]int32) bool {
	partial := false
	for i, inode := range inodes {
		ports[i].Pid = owners[inode]
		if ports[i].Pid == 0 {
			partial = true
		}
	}
	return partial
}

func enrichListeningPorts(ctx context.Context, ports []wshrpc.ListeningPort) {
	snapshot, err := procinfo.MakeGlobalSnapshot()
	if err != nil {
		return
	}
	users := &procCacheState{}
	type identity struct{ command, user string }
	identities := make(map[int32]identity)
	for i := range ports {
		p := &ports[i]
		if ctx.Err() != nil {
			return
		}
		if p.Pid == 0 {
			continue
		}
		ident, ok := identities[p.Pid]
		if !ok {
			if info, err := procinfo.GetProcInfo(ctx, snapshot, p.Pid); err == nil {
				username := info.User
				if username == "" {
					username = users.lookupUID(info.Uid)
				}
				ident = identity{info.Command, username}
			}
			identities[p.Pid] = ident
		}
		if ident.command != "" {
			p.Command = ident.command
		}
		if ident.user != "" {
			p.User = ident.user
		}
	}
}

func linuxListeningPorts(ctx context.Context, root string) (*wshrpc.ListeningPortsResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, listeningScanBudget)
	defer cancel()
	result := &wshrpc.ListeningPortsResponse{Platform: "linux"}
	var inodes []string
	for _, name := range []string{"tcp", "tcp6"} {
		if ctx.Err() != nil {
			result.Partial = true
			break
		}
		text, err := readHostFile(filepath.Join(root, "net", name))
		if err != nil {
			if name == "tcp6" && errors.Is(err, os.ErrNotExist) {
				continue
			}
			result.Partial = true
			text = completeHostOutputLines(text)
		}
		ports, ids := parseProcListeningPorts(text)
		if len(ports) >= listeningMaxSockets {
			result.Partial = true
		}
		result.Ports = append(result.Ports, ports...)
		inodes = append(inodes, ids...)
	}
	owners := mapSocketOwners(ctx, root, inodes)
	result.Partial = fillSocketOwners(result.Ports, inodes, owners) || result.Partial
	enrichListeningPorts(ctx, result.Ports)
	result.Partial = result.Partial || ctx.Err() != nil
	return result, nil
}

func parseLsofAddress(text, family string) (string, int, bool) {
	i := strings.LastIndexByte(text, ':')
	if i < 0 {
		return "", 0, false
	}
	port, err := strconv.ParseUint(text[i+1:], 10, 16)
	if err != nil || port == 0 {
		return "", 0, false
	}
	address := strings.Trim(text[:i], "[]")
	if address == "*" {
		switch family {
		case "IPv4":
			address = "0.0.0.0"
		case "IPv6":
			address = "::"
		default:
			return "", 0, false
		}
	}
	addr, err := netip.ParseAddr(address)
	if err != nil {
		return "", 0, false
	}
	return addr.String(), int(port), true
}

func parseLsofListeningPorts(text string) []wshrpc.ListeningPort {
	var result []wshrpc.ListeningPort
	var pid int32
	var command, user, family, name string
	flush := func() {
		if pid == 0 || len(result) >= listeningMaxSockets {
			return
		}
		if address, port, ok := parseLsofAddress(name, family); ok {
			result = append(result, wshrpc.ListeningPort{Pid: pid, Command: command, User: user, Address: address, Port: port})
		}
	}
	for _, line := range strings.Split(text, "\n") {
		if len(line) == 0 {
			continue
		}
		value := line[1:]
		switch line[0] {
		case 'p':
			flush()
			pid = numericPID(value)
			command, user, family, name = "", "", "", ""
		case 'c':
			command = value
		case 'L':
			user = value
		case 'f':
			flush()
			family, name = "", ""
		case 't':
			family = value
		case 'n':
			name = value
		}
	}
	flush()
	return result
}

func normalizeListeningPorts(ports []wshrpc.ListeningPort) []wshrpc.ListeningPort {
	sort.Slice(ports, func(i, j int) bool {
		if ports[i].Port != ports[j].Port {
			return ports[i].Port < ports[j].Port
		}
		if ports[i].Address != ports[j].Address {
			return ports[i].Address < ports[j].Address
		}
		return ports[i].Pid < ports[j].Pid
	})
	result := make([]wshrpc.ListeningPort, 0, len(ports))
	for _, p := range ports {
		if len(result) > 0 {
			prev := result[len(result)-1]
			if prev.Port == p.Port && prev.Address == p.Address && prev.Pid == p.Pid {
				continue
			}
		}
		result = append(result, p)
	}
	return result
}

func (impl *ServerImpl) RemoteListeningPortsCommand(ctx context.Context) (*wshrpc.ListeningPortsResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	var result *wshrpc.ListeningPortsResponse
	switch runtime.GOOS {
	case "windows":
		var err error
		result, err = windowsListeningPorts(ctx)
		if err != nil {
			return nil, err
		}
	case "linux":
		var err error
		result, err = linuxListeningPorts(ctx, "/proc")
		if err != nil {
			return nil, err
		}
	case "darwin":
		text, err := runHostCommand(ctx, "lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-FpcLftn")
		var exitErr *exec.ExitError
		noMatches := errors.As(err, &exitErr) && exitErr.ExitCode() == 1 && text == ""
		if err != nil && !noMatches && text == "" {
			return nil, fmt.Errorf("listening ports: lsof: %w", err)
		}
		if err != nil {
			text = completeHostOutputLines(text)
		}
		result = &wshrpc.ListeningPortsResponse{Ports: parseLsofListeningPorts(text), Partial: os.Geteuid() != 0 || (err != nil && !noMatches)}
		enrichCtx, cancel := context.WithTimeout(ctx, listeningScanBudget)
		enrichListeningPorts(enrichCtx, result.Ports)
		result.Partial = result.Partial || enrichCtx.Err() != nil || len(result.Ports) >= listeningMaxSockets
		cancel()
	default:
		return nil, fmt.Errorf("listening ports are not supported on %s", runtime.GOOS)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	result.Platform = runtime.GOOS
	result.Ports = normalizeListeningPorts(result.Ports)
	return result, nil
}
