// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"math"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/panichandler"
	"github.com/Ry3nG/GenieTerm/pkg/util/procinfo"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

const (
	gpuSampleInterval = 2 * time.Second
	gpuFreshness      = 15 * time.Second
	gpuFailureBackoff = 30 * time.Second
	gpuBinaryRetry    = 5 * time.Minute
	gpuMaxDevices     = 256
	gpuMaxProcesses   = 32
	gpuMiB            = 1024 * 1024
	gpuQuery          = "--query-gpu=index,uuid,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit,utilization.memory,fan.speed,clocks.sm,clocks.max.sm,clocks.mem,pstate"
	gpuProcessQuery   = "--query-compute-apps=gpu_uuid,pid,used_memory"
)

var cudaVersionPattern = regexp.MustCompile(`CUDA Version:\s*([0-9]+\.[0-9]+)`)
var driverVersionPattern = regexp.MustCompile(`^[0-9]+(?:\.[0-9]+)+$`)

type nvidiaBinaryCache struct {
	lock    sync.Mutex
	path    string
	checked time.Time
	lookup  func(string) (string, error)
}

var nvidiaBinary = &nvidiaBinaryCache{lookup: exec.LookPath}

func (s *nvidiaBinaryCache) find(now time.Time) string {
	s.lock.Lock()
	defer s.lock.Unlock()
	if s.path != "" || (!s.checked.IsZero() && now.Sub(s.checked) < gpuBinaryRetry) {
		return s.path
	}
	s.checked = now
	for _, candidate := range []string{"nvidia-smi", "/usr/bin/nvidia-smi", "/usr/local/bin/nvidia-smi", "/usr/lib/wsl/lib/nvidia-smi"} {
		if path, err := s.lookup(candidate); err == nil {
			s.path = path
			break
		}
	}
	return s.path
}

func parseDriverVersion(text string) string {
	for _, line := range strings.Split(text, "\n") {
		if line = strings.TrimSpace(line); driverVersionPattern.MatchString(line) {
			return line
		}
	}
	return ""
}

func parseCUDAVersion(text string) string {
	match := cudaVersionPattern.FindStringSubmatch(text)
	if len(match) == 2 {
		return match[1]
	}
	return ""
}

func gpuNumber(text string, scale float64) float64 {
	n, err := strconv.ParseFloat(strings.TrimSpace(text), 64)
	if err != nil || n < 0 || math.IsNaN(n) || math.IsInf(n*scale, 0) {
		return -1
	}
	return n * scale
}

func gpuPstate(text string) string {
	text = strings.TrimSpace(text)
	if len(text) < 2 || text[0] != 'P' {
		return ""
	}
	if _, err := strconv.Atoi(text[1:]); err != nil {
		return ""
	}
	return text
}

type gpuRecord struct {
	uuid string
	data wshrpc.GpuData
}

func parseGPUs(text string) ([]gpuRecord, error) {
	reader := csv.NewReader(strings.NewReader(text))
	reader.TrimLeadingSpace = true
	reader.FieldsPerRecord = 15
	var result []gpuRecord
	seen := make(map[string]bool)
	for {
		row, err := reader.Read()
		if err == io.EOF {
			return result, nil
		}
		if err != nil {
			return nil, fmt.Errorf("invalid NVIDIA GPU CSV: %w", err)
		}
		index, err := strconv.ParseInt(strings.TrimSpace(row[0]), 10, 32)
		uuid := strings.TrimSpace(row[1])
		if err != nil || index < 0 || uuid == "" || seen[uuid] {
			return nil, fmt.Errorf("invalid NVIDIA GPU identity")
		}
		if len(result) >= gpuMaxDevices {
			return nil, fmt.Errorf("too many NVIDIA GPUs")
		}
		seen[uuid] = true
		result = append(result, gpuRecord{uuid: uuid, data: wshrpc.GpuData{
			Index: int(index), Name: strings.TrimSpace(row[2]), Util: gpuNumber(row[3], 1),
			MemUsed: gpuNumber(row[4], gpuMiB), MemTotal: gpuNumber(row[5], gpuMiB),
			Temp: gpuNumber(row[6], 1), Power: gpuNumber(row[7], 1), PowerLimit: gpuNumber(row[8], 1),
			MemUtil: gpuNumber(row[9], 1), Fan: gpuNumber(row[10], 1), ClockSm: gpuNumber(row[11], 1),
			ClockSmMax: gpuNumber(row[12], 1), ClockMem: gpuNumber(row[13], 1), Pstate: gpuPstate(row[14]),
		}})
	}
}

func gpuProcessLess(a, b wshrpc.GpuProcessInfo) bool {
	if a.MemUsed != b.MemUsed {
		return a.MemUsed > b.MemUsed
	}
	return a.Pid < b.Pid
}

func parseGPUProcesses(text string, devices []gpuRecord) (map[string][]wshrpc.GpuProcessInfo, error) {
	result := make(map[string][]wshrpc.GpuProcessInfo, len(devices))
	for _, d := range devices {
		result[d.uuid] = nil
	}
	reader := csv.NewReader(strings.NewReader(text))
	reader.TrimLeadingSpace = true
	reader.FieldsPerRecord = 3
	for {
		row, err := reader.Read()
		if err == io.EOF {
			return result, nil
		}
		if err != nil {
			return nil, fmt.Errorf("invalid NVIDIA process CSV: %w", err)
		}
		uuid := strings.TrimSpace(row[0])
		list, exists := result[uuid]
		if !exists {
			continue
		}
		pid, err := strconv.ParseInt(strings.TrimSpace(row[1]), 10, 32)
		if err != nil || pid <= 0 {
			continue
		}
		item := wshrpc.GpuProcessInfo{Pid: int32(pid), MemUsed: gpuNumber(row[2], gpuMiB)}
		duplicate := false
		for i, p := range list {
			if p.Pid == item.Pid {
				if item.MemUsed > p.MemUsed {
					list[i] = item
				}
				duplicate = true
				break
			}
		}
		if !duplicate {
			list = append(list, item)
		}
		sort.Slice(list, func(i, j int) bool { return gpuProcessLess(list[i], list[j]) })
		if len(list) > gpuMaxProcesses {
			list = list[:gpuMaxProcesses]
		}
		result[uuid] = list
	}
}

func collectGPUData(ctx context.Context) ([]wshrpc.GpuData, error) {
	path := nvidiaBinary.find(time.Now())
	if path == "" {
		return nil, nil
	}
	text, err := runHostCommand(ctx, path, gpuQuery, "--format=csv,noheader,nounits")
	if err != nil {
		return nil, err
	}
	devices, err := parseGPUs(text)
	if err != nil || len(devices) == 0 {
		return nil, err
	}
	text, err = runHostCommand(ctx, path, gpuProcessQuery, "--format=csv,noheader,nounits")
	if err != nil {
		return nil, err
	}
	processes, err := parseGPUProcesses(text, devices)
	if err != nil {
		return nil, err
	}
	snapshot, _ := procinfo.MakeGlobalSnapshot()
	users := &procCacheState{}
	var result []wshrpc.GpuData
	for _, device := range devices {
		device.data.Processes = processes[device.uuid]
		for i := range device.data.Processes {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			p := &device.data.Processes[i]
			if info, err := procinfo.GetProcInfo(ctx, snapshot, p.Pid); err == nil {
				p.Command, p.User = info.Command, users.lookupUID(info.Uid)
			}
		}
		result = append(result, device.data)
	}
	return result, nil
}

type gpuSampler struct {
	lock        sync.Mutex
	active      bool
	cancel      context.CancelFunc
	cached      []wshrpc.GpuData
	sampled     time.Time
	nextAttempt time.Time
	failures    int
	collect     func(context.Context) ([]wshrpc.GpuData, error)
}

var gpuCache = &gpuSampler{collect: collectGPUData}

func (s *gpuSampler) startLocked() {
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	go s.run(ctx)
}

func (s *gpuSampler) setActive(active bool) {
	s.lock.Lock()
	defer s.lock.Unlock()
	s.active = active
	if !active {
		if s.cancel != nil {
			s.cancel()
		}
		s.cached = nil
		return
	}
	if s.cancel == nil {
		s.startLocked()
	}
}

func (s *gpuSampler) finish() {
	s.lock.Lock()
	defer s.lock.Unlock()
	s.cancel()
	s.cancel = nil
	// A new lease may arrive while the previous command is being cancelled.
	if s.active {
		s.startLocked()
	}
}

func (s *gpuSampler) store(ctx context.Context, data []wshrpc.GpuData, err error, sampled, now time.Time) {
	s.lock.Lock()
	defer s.lock.Unlock()
	if ctx.Err() != nil {
		return
	}
	if err != nil {
		s.failures = min(s.failures+1, 3)
	} else {
		s.failures = 0
		if s.active {
			s.cached, s.sampled = data, sampled
		}
	}
	s.nextAttempt = now.Add(gpuRetryDelay(s.failures))
}

func (s *gpuSampler) sampleDelay(now time.Time) time.Duration {
	s.lock.Lock()
	defer s.lock.Unlock()
	return max(0, s.nextAttempt.Sub(now))
}

func (s *gpuSampler) beginSample(now time.Time) {
	s.lock.Lock()
	defer s.lock.Unlock()
	// Rapid lease changes must not bypass the sampling limit.
	s.nextAttempt = now.Add(gpuSampleInterval)
}

func (s *gpuSampler) latest(now time.Time) []wshrpc.GpuData {
	s.lock.Lock()
	defer s.lock.Unlock()
	if !s.active || now.Sub(s.sampled) >= gpuFreshness {
		return nil
	}
	// Snapshots remain immutable while event serialization may still be reading them.
	return s.cached
}

func gpuRetryDelay(failures int) time.Duration {
	if failures >= 3 {
		return gpuFailureBackoff
	}
	return gpuSampleInterval
}

func (s *gpuSampler) run(ctx context.Context) {
	defer s.finish()
	defer func() { panichandler.PanicHandler("gpuSampler", recover()) }()
	for {
		timer := time.NewTimer(s.sampleDelay(time.Now()))
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		if ctx.Err() != nil {
			return
		}
		started := time.Now()
		s.beginSample(started)
		sampleCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
		data, err := s.collect(sampleCtx)
		cancel()
		if ctx.Err() != nil {
			return
		}
		// Freshness counts from completion: nvidia-smi can take seconds on a busy multi-GPU host, and
		// timing from the start would let good data expire between samples and make the GPU cards flicker.
		finished := time.Now()
		s.store(ctx, data, err, finished, finished)
	}
}
