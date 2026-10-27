// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"net/netip"
	"strconv"
	"unsafe"

	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"golang.org/x/sys/windows"
)

const (
	windowsTCPTableOwnerPIDListener = 3
	windowsTCPStateListen           = 2
	windowsTCPTableMaxBytes         = 16 * 1024 * 1024
)

var getExtendedTCPTable = windows.NewLazySystemDLL("iphlpapi.dll").NewProc("GetExtendedTcpTable")

func readWindowsTCPTable(ctx context.Context, family uint32) ([]byte, error) {
	buffer := make([]byte, 4096)
	for attempt := 0; attempt < 4; attempt++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		size := uint32(len(buffer))
		code, _, _ := getExtendedTCPTable.Call(uintptr(unsafe.Pointer(&buffer[0])), uintptr(unsafe.Pointer(&size)), 0, uintptr(family), windowsTCPTableOwnerPIDListener, 0)
		if code == 0 {
			if size > uint32(len(buffer)) {
				return nil, fmt.Errorf("Windows TCP table exceeds its buffer")
			}
			return buffer[:size], nil
		}
		if windows.Errno(code) != windows.ERROR_INSUFFICIENT_BUFFER {
			return nil, windows.Errno(code)
		}
		if size <= uint32(len(buffer)) || size > windowsTCPTableMaxBytes {
			return nil, fmt.Errorf("Windows TCP table requested invalid size %d", size)
		}
		buffer = make([]byte, size)
	}
	return nil, fmt.Errorf("Windows TCP table changed repeatedly during collection")
}

func parseWindowsTCPTable(buffer []byte, family uint32) ([]wshrpc.ListeningPort, bool, error) {
	rowSize := 24
	if family == windows.AF_INET6 {
		rowSize = 56
	} else if family != windows.AF_INET {
		return nil, false, fmt.Errorf("invalid TCP address family %d", family)
	}
	if len(buffer) < 4 {
		return nil, false, fmt.Errorf("truncated Windows TCP table header")
	}
	count := uint64(binary.LittleEndian.Uint32(buffer[:4]))
	if count > uint64((len(buffer)-4)/rowSize) {
		return nil, false, fmt.Errorf("truncated Windows TCP table rows")
	}
	partial := count > listeningMaxSockets
	count = min(count, listeningMaxSockets)
	ports := make([]wshrpc.ListeningPort, 0, count)
	for i := 0; i < int(count); i++ {
		row := buffer[4+i*rowSize : 4+(i+1)*rowSize]
		stateOffset, pidOffset, portOffset := 0, 20, 8
		addressBytes := row[4:8]
		if family == windows.AF_INET6 {
			stateOffset, pidOffset, portOffset = 48, 52, 20
			addressBytes = row[:16]
		}
		if binary.LittleEndian.Uint32(row[stateOffset:]) != windowsTCPStateListen {
			continue
		}
		port := int(binary.BigEndian.Uint16(row[portOffset:]))
		if port == 0 {
			continue
		}
		address, _ := netip.AddrFromSlice(addressBytes)
		if family == windows.AF_INET6 {
			if scope := binary.BigEndian.Uint32(row[16:20]); scope != 0 {
				address = address.WithZone(strconv.FormatUint(uint64(scope), 10))
			}
		}
		pid := int32(binary.LittleEndian.Uint32(row[pidOffset:]))
		partial = partial || pid <= 0
		ports = append(ports, wshrpc.ListeningPort{Address: address.String(), Port: port, Pid: pid})
	}
	return ports, partial, nil
}

func collectWindowsListeningPorts(ctx context.Context, readTable func(context.Context, uint32) ([]byte, error)) (*wshrpc.ListeningPortsResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, listeningScanBudget)
	defer cancel()
	result := &wshrpc.ListeningPortsResponse{Ports: make([]wshrpc.ListeningPort, 0)}
	var failures []error
	for _, family := range []uint32{windows.AF_INET, windows.AF_INET6} {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		buffer, err := readTable(ctx, family)
		if err != nil {
			failures = append(failures, fmt.Errorf("Windows TCP family %d: %w", family, err))
			result.Partial = true
			continue
		}
		ports, partial, err := parseWindowsTCPTable(buffer, family)
		if err != nil {
			return nil, err
		}
		remaining := listeningMaxSockets - len(result.Ports)
		result.Partial = result.Partial || partial || len(ports) > remaining
		result.Ports = append(result.Ports, ports[:min(len(ports), remaining)]...)
	}
	if len(failures) == 2 {
		return nil, errors.Join(failures...)
	}
	enrichListeningPorts(ctx, result.Ports)
	for i := range result.Ports {
		if ctx.Err() != nil {
			result.Partial = true
			break
		}
		port := &result.Ports[i]
		result.Partial = result.Partial || port.Command == "" || port.User == ""
	}
	return result, nil
}

func windowsListeningPorts(ctx context.Context) (*wshrpc.ListeningPortsResponse, error) {
	return collectWindowsListeningPorts(ctx, readWindowsTCPTable)
}
