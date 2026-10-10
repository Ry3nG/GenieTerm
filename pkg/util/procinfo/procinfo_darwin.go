// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package procinfo

import (
	"context"
	"fmt"
	"sync"
	"syscall"
	"unsafe"

	"github.com/ebitengine/purego"
	"golang.org/x/sys/unix"
)

const (
	systemLibPath   = "/usr/lib/libSystem.B.dylib"
	procPidInfoSym  = "proc_pidinfo"
	procPidPathSym  = "proc_pidpath"
	machTimebaseSym = "mach_timebase_info"
	procPidTaskInfo = 4
	kernSuccess     = 0

	// PROC_PIDPATHINFO_MAXSIZE from libproc.h
	procPidPathMaxSize = 4096
	// The kernel keeps at most MAXCOMLEN (16) bytes of the command name in p_comm.
	darwinCommMaxLen = 16
)

// From <mach/mach_time.h>
type machTimebaseInfo struct {
	Numer uint32
	Denom uint32
}

// From libproc.h / proc_info.h
// This is the struct returned by PROC_PIDTASKINFO.
// Keep field order exact.
type procTaskInfo struct {
	VirtualSize  uint64
	ResidentSize uint64
	TotalUser    uint64
	TotalSystem  uint64
	ThreadsUser  uint64
	ThreadsSys   uint64
	Policy       int32
	Faults       int32
	Pageins      int32
	CowFaults    int32
	MessagesSent int32
	MessagesRecv int32
	SyscallsMach int32
	SyscallsUnix int32
	Csw          int32
	Threadnum    int32
	Numrunning   int32
	Priority     int32
}

var (
	darwinProcOnce     sync.Once
	darwinProcInitErr  error
	darwinLibHandle    uintptr
	darwinProcPidInfo  procPidInfoFunc
	darwinProcPidPath  procPidPathFunc
	darwinMachTimebase machTimebaseInfoFunc
	darwinTimeScale    float64 // mach absolute time units -> nanoseconds
)

type procPidInfoFunc func(pid, flavor int32, arg uint64, buffer uintptr, bufferSize int32) int32
type procPidPathFunc func(pid int32, buffer uintptr, bufferSize uint32) int32
type machTimebaseInfoFunc func(info uintptr) int32

func MakeGlobalSnapshot() (any, error) {
	return nil, nil
}

// GetProcInfo reads process information for the given pid.
// Core fields come from kern.proc.pid sysctl; CPU times, VmRSS, and NumThreads
// are fetched via proc_pidinfo(PROC_PIDTASKINFO).
func GetProcInfo(ctx context.Context, _ any, pid int32) (*ProcInfo, error) {
	k, err := unix.SysctlKinfoProc("kern.proc.pid", int(pid))
	if err != nil {
		if err == syscall.ESRCH {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("procinfo: SysctlKinfoProc pid %d: %w", pid, err)
	}

	info := &ProcInfo{
		Pid:     int32(k.Proc.P_pid),
		Ppid:    k.Eproc.Ppid,
		Command: unix.ByteSliceToString(k.Proc.P_comm[:]),
		Uid:     k.Eproc.Ucred.Uid,
	}
	info.Command = expandDarwinCommand(pid, info.Command)

	info.CpuUser = -1
	info.CpuSys = -1
	info.VmRSS = -1
	info.NumThreads = -1
	if ti, terr := getDarwinProcTaskInfo(pid); terr == nil {
		if darwinTimeScale > 0 {
			info.CpuUser = float64(ti.TotalUser) * darwinTimeScale / 1e9
			info.CpuSys = float64(ti.TotalSystem) * darwinTimeScale / 1e9
		}
		info.VmRSS = int64(ti.ResidentSize)
		info.NumThreads = ti.Threadnum
	}

	return info, nil
}

func initDarwinProcFuncs() error {
	darwinProcOnce.Do(func() {
		handle, err := purego.Dlopen(systemLibPath, purego.RTLD_LAZY|purego.RTLD_GLOBAL)
		if err != nil {
			darwinProcInitErr = fmt.Errorf("dlopen %s: %w", systemLibPath, err)
			return
		}
		darwinLibHandle = handle

		purego.RegisterLibFunc(&darwinProcPidInfo, darwinLibHandle, procPidInfoSym)
		purego.RegisterLibFunc(&darwinProcPidPath, darwinLibHandle, procPidPathSym)
		purego.RegisterLibFunc(&darwinMachTimebase, darwinLibHandle, machTimebaseSym)

		var tb machTimebaseInfo
		if rc := darwinMachTimebase(uintptr(unsafe.Pointer(&tb))); rc != kernSuccess {
			darwinProcInitErr = fmt.Errorf("mach_timebase_info failed: %d", rc)
			return
		}
		if tb.Denom == 0 {
			darwinProcInitErr = fmt.Errorf("mach_timebase_info returned denom=0")
			return
		}

		darwinTimeScale = float64(tb.Numer) / float64(tb.Denom)
	})
	return darwinProcInitErr
}

func getDarwinProcTaskInfo(pid int32) (*procTaskInfo, error) {
	if err := initDarwinProcFuncs(); err != nil {
		return nil, err
	}

	var ti procTaskInfo
	ret := darwinProcPidInfo(
		pid,
		procPidTaskInfo,
		0,
		uintptr(unsafe.Pointer(&ti)),
		int32(unsafe.Sizeof(ti)),
	)
	if ret <= 0 {
		return nil, fmt.Errorf("proc_pidinfo(pid=%d) returned %d", pid, ret)
	}
	if ret != int32(unsafe.Sizeof(ti)) {
		return nil, fmt.Errorf("proc_pidinfo(pid=%d) short read: got=%d want=%d", pid, ret, unsafe.Sizeof(ti))
	}
	return &ti, nil
}

// expandDarwinCommand replaces a p_comm name cut at MAXCOMLEN ("Google Chrome He") with the
// executable's file name, the way Activity Monitor shows it.
func expandDarwinCommand(pid int32, comm string) string {
	if len(comm) < darwinCommMaxLen {
		return comm
	}
	path, err := getDarwinProcPath(pid)
	if err != nil {
		return comm
	}
	return expandTruncatedCommand(comm, path, darwinCommMaxLen)
}

func getDarwinProcPath(pid int32) (string, error) {
	if err := initDarwinProcFuncs(); err != nil {
		return "", err
	}
	buf := make([]byte, procPidPathMaxSize)
	ret := darwinProcPidPath(pid, uintptr(unsafe.Pointer(&buf[0])), uint32(len(buf)))
	if ret <= 0 {
		return "", fmt.Errorf("proc_pidpath(pid=%d) returned %d", pid, ret)
	}
	return string(buf[:ret]), nil
}
