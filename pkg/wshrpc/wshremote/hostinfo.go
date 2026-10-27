// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/panichandler"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
)

const (
	hostCommandTimeout = 3 * time.Second
	hostOutputLimit    = 4 * 1024 * 1024
)

type boundedOutput struct {
	data  []byte
	limit int
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	n := min(len(p), b.limit-len(b.data))
	b.data = append(b.data, p[:n]...)
	if n != len(p) {
		return n, fmt.Errorf("host command output exceeds %d bytes", b.limit)
	}
	return n, nil
}

func runHostCommand(ctx context.Context, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, hostCommandTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.WaitDelay = 100 * time.Millisecond
	out := &boundedOutput{limit: hostOutputLimit}
	cmd.Stdout = out
	cmd.Stderr = io.Discard
	err := cmd.Run()
	if ctx.Err() != nil {
		err = ctx.Err()
	}
	return string(out.data), err
}

func readHostFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, hostOutputLimit+1))
	if len(b) > hostOutputLimit {
		return string(b[:hostOutputLimit]), fmt.Errorf("host file exceeds %d bytes", hostOutputLimit)
	}
	return string(b), err
}

func completeHostOutputLines(text string) string {
	// A truncated numeric field could otherwise look like a valid, different port or inode.
	return text[:strings.LastIndexByte(text, '\n')+1]
}

func parseOSRelease(text string) string {
	for _, line := range strings.Split(text, "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok || key != "PRETTY_NAME" {
			continue
		}
		value = strings.TrimSpace(value)
		if len(value) > 0 && (value[0] == '\'' || value[0] == '"') {
			quote := value[0]
			if len(value) < 2 || value[len(value)-1] != quote {
				return ""
			}
			value = value[1 : len(value)-1]
			if quote == '"' {
				var b strings.Builder
				for i := 0; i < len(value); i++ {
					if value[i] == '\\' && i+1 < len(value) && strings.ContainsRune("\"\\$`", rune(value[i+1])) {
						i++
					}
					b.WriteByte(value[i])
				}
				value = b.String()
			}
		}
		return value
	}
	return ""
}

func parseCPUModel(text string) string {
	values := make(map[string]string)
	for _, line := range strings.Split(text, "\n") {
		key, value, ok := strings.Cut(line, ":")
		key, value = strings.TrimSpace(key), strings.TrimSpace(value)
		if ok && values[key] == "" && (key == "model name" || key == "Model" || key == "Hardware") {
			values[key] = value
		}
	}
	for _, key := range []string{"model name", "Model", "Hardware"} {
		if values[key] != "" {
			return values[key]
		}
	}
	return ""
}

type hostInfoCache struct {
	once  sync.Once
	ready chan struct{}
	info  wshrpc.HostInfo
}

var staticHostInfo = &hostInfoCache{ready: make(chan struct{})}

func (s *hostInfoCache) get(ctx context.Context, collect func(context.Context) wshrpc.HostInfo) (*wshrpc.HostInfo, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.once.Do(func() {
		go func() {
			defer close(s.ready)
			defer func() { panichandler.PanicHandler("hostInfoCache", recover()) }()
			// A cancelled caller must not poison the process-wide static snapshot.
			collectCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			s.info = collect(collectCtx)
		}()
	})
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-s.ready:
		info := s.info
		return &info, nil
	}
}

func collectHostInfo(ctx context.Context) wshrpc.HostInfo {
	info := wshrpc.HostInfo{Arch: runtime.GOARCH, NumCpu: runtime.NumCPU(), Os: runtime.GOOS}
	if h, err := host.InfoWithContext(ctx); err == nil {
		info.Hostname, info.Kernel, info.BootTime = h.Hostname, h.KernelVersion, int64(h.BootTime)
		if runtime.GOOS == "darwin" {
			info.Os = strings.TrimSpace("macOS " + h.PlatformVersion)
		}
	}
	if info.Hostname == "" {
		info.Hostname, _ = os.Hostname()
	}
	if info.BootTime == 0 {
		boot, _ := host.BootTimeWithContext(ctx)
		info.BootTime = int64(boot)
	}
	if info.Kernel == "" {
		// host.Info can fail on unrelated fields, such as an inaccessible host ID.
		info.Kernel, _ = host.KernelVersionWithContext(ctx)
	}
	if n, err := cpu.CountsWithContext(ctx, true); err == nil && n > 0 {
		info.NumCpu = n
	}
	if m, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		info.MemTotal = m.Total
	}
	switch runtime.GOOS {
	case "linux":
		info.Os = "Linux"
		for _, path := range []string{"/etc/os-release", "/usr/lib/os-release"} {
			text, err := readHostFile(path)
			if err == nil {
				if name := parseOSRelease(text); name != "" {
					info.Os = name
					break
				}
			}
		}
		text, _ := readHostFile("/proc/cpuinfo")
		info.CpuModel = parseCPUModel(text)
	case "darwin":
		if info.Os == "darwin" || info.Os == "macOS" {
			version, _ := runHostCommand(ctx, "/usr/bin/sw_vers", "-productVersion")
			info.Os = strings.TrimSpace("macOS " + strings.TrimSpace(version))
		}
		info.Kernel = strings.TrimSpace("Darwin " + info.Kernel)
		if cpus, err := cpu.InfoWithContext(ctx); err == nil && len(cpus) > 0 {
			info.CpuModel = cpus[0].ModelName
		}
	case "windows":
		info.Os = "Windows"
		if product, _, version, err := host.PlatformInformationWithContext(ctx); err == nil {
			info.Os = strings.TrimSpace(product + " " + version)
		}
		if cpus, err := cpu.InfoWithContext(ctx); err == nil && len(cpus) > 0 {
			info.CpuModel = strings.TrimSpace(cpus[0].ModelName)
		}
	}
	if path := nvidiaBinary.find(time.Now()); path != "" {
		if text, err := runHostCommand(ctx, path, "--query-gpu=driver_version", "--format=csv,noheader"); err == nil {
			info.GpuDriver = parseDriverVersion(text)
		}
		if text, err := runHostCommand(ctx, path); err == nil {
			info.CudaVersion = parseCUDAVersion(text)
		}
	}
	return info
}

func (impl *ServerImpl) RemoteHostInfoCommand(ctx context.Context) (*wshrpc.HostInfo, error) {
	return staticHostInfo.get(ctx, collectHostInfo)
}
