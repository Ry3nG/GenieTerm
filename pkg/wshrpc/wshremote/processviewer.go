// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"fmt"
	"os"
	"os/user"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/panichandler"
	"github.com/Ry3nG/GenieTerm/pkg/util/procinfo"
	"github.com/Ry3nG/GenieTerm/pkg/util/unixutil"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	goproc "github.com/shirou/gopsutil/v4/process"
)

const (
	// must stay above 2x the slowest UI refresh interval (5s) so a polling widget never lapses
	ProcCacheIdleTimeout     = 12 * time.Second
	ProcWidgetOrderExpiry    = 60 * time.Second
	ProcCacheDefaultInterval = 1 * time.Second
	ProcCacheMaxInterval     = 5 * time.Second
	ProcCacheMinSleep        = 500 * time.Millisecond
	ProcViewerMaxLimit       = 500
)

// cpuSample records a single CPU time measurement for a process.
type cpuSample struct {
	CPUSec    float64   // user+system cpu seconds at sample time
	SampledAt time.Time // when the sample was taken
	Epoch     int       // epoch at which this sample was recorded
}

// widgetPidOrder stores the ordered pid list from the last non-LastPidOrder request for a widget.
type widgetPidOrder struct {
	pids        []int32
	totalCount  int
	lastRequest time.Time
}

// procLease is held by a widget that is actively polling for fresh data. Only data requests
// renew a lease (keepalives do not), so paused or hidden widgets let sampling stop.
type procLease struct {
	lastSeen time.Time
	interval time.Duration
}

// procCacheState is the singleton background cache for process list data.
// lastCPUSamples, lastCPUEpoch, and uidCache are only accessed by the single runLoop goroutine.
type procCacheState struct {
	lock    sync.Mutex
	cached  *wshrpc.ProcessListResponse
	running bool
	// ready is closed when the first result is placed in cache; set to nil after close.
	ready chan struct{}

	lastCPUSamples map[int32]cpuSample
	lastCPUEpoch   int
	uidCache       map[uint32]string // uid -> username, populated lazily

	leases          map[string]*procLease      // keyed by widgetId ("" for anonymous callers)
	widgetPidOrders map[string]*widgetPidOrder // keyed by widgetId
}

// procCache is the singleton background cache for process list data.
var procCache = &procCacheState{}

func clampProcInterval(intervalMs int) time.Duration {
	if intervalMs <= 0 {
		return ProcCacheDefaultInterval
	}
	interval := time.Duration(intervalMs) * time.Millisecond
	return max(ProcCacheDefaultInterval, min(interval, ProcCacheMaxInterval))
}

// requestAndWait renews the caller's lease and returns the current cached result. If the
// background goroutine is not running it starts it and waits for the first populate before returning.
func (s *procCacheState) requestAndWait(ctx context.Context, widgetId string, interval time.Duration) (*wshrpc.ProcessListResponse, error) {
	readyCh := s.renewLeaseAndEnsureRunning(widgetId, interval)
	if readyCh != nil {
		select {
		case <-readyCh:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	result := s.getCached()
	if result == nil {
		return nil, fmt.Errorf("process list unavailable")
	}
	return result, nil
}

func (s *procCacheState) renewLeaseAndEnsureRunning(widgetId string, interval time.Duration) chan struct{} {
	s.lock.Lock()
	defer s.lock.Unlock()
	if s.leases == nil {
		s.leases = make(map[string]*procLease)
	}
	s.leases[widgetId] = &procLease{lastSeen: time.Now(), interval: interval}
	if !s.running {
		s.running = true
		s.ready = make(chan struct{})
		go s.runLoop(s.ready)
	}
	return s.ready
}

func (s *procCacheState) getCached() *wshrpc.ProcessListResponse {
	s.lock.Lock()
	defer s.lock.Unlock()
	return s.cached
}

// touchWidgetPidOrder keeps a paused widget's pid order from expiring without renewing its lease.
func (s *procCacheState) touchWidgetPidOrder(widgetId string) {
	if widgetId == "" {
		return
	}
	s.lock.Lock()
	defer s.lock.Unlock()
	if entry, ok := s.widgetPidOrders[widgetId]; ok {
		entry.lastRequest = time.Now()
	}
}

func (s *procCacheState) releaseWidget(widgetId string) {
	s.lock.Lock()
	defer s.lock.Unlock()
	delete(s.leases, widgetId)
	delete(s.widgetPidOrders, widgetId)
}

func (s *procCacheState) storeWidgetPidOrder(widgetId string, pids []int32, totalCount int) {
	if widgetId == "" {
		return
	}
	s.lock.Lock()
	defer s.lock.Unlock()
	if s.widgetPidOrders == nil {
		s.widgetPidOrders = make(map[string]*widgetPidOrder)
	}
	now := time.Now()
	for id, entry := range s.widgetPidOrders {
		if now.Sub(entry.lastRequest) >= ProcWidgetOrderExpiry {
			delete(s.widgetPidOrders, id)
		}
	}
	s.widgetPidOrders[widgetId] = &widgetPidOrder{
		pids:        pids,
		totalCount:  totalCount,
		lastRequest: now,
	}
}

func (s *procCacheState) getWidgetPidOrder(widgetId string) ([]int32, int) {
	if widgetId == "" {
		return nil, 0
	}
	s.lock.Lock()
	defer s.lock.Unlock()
	entry, ok := s.widgetPidOrders[widgetId]
	if !ok {
		return nil, 0
	}
	if time.Since(entry.lastRequest) >= ProcWidgetOrderExpiry {
		delete(s.widgetPidOrders, widgetId)
		return nil, 0
	}
	return entry.pids, entry.totalCount
}

// updateCacheAndCheckIdle stores the latest snapshot, signals the first-ready channel if needed,
// and drops expired leases. Returns (true, 0) if the loop should exit because no lease remains,
// otherwise (false, sleep) where sleep comes from the smallest interval requested by a live lease.
// Pid orders are intentionally kept on exit so a paused widget can still page through its frozen order.
func (s *procCacheState) updateCacheAndCheckIdle(result *wshrpc.ProcessListResponse, firstDone *bool, firstReadyCh chan struct{}) (bool, time.Duration) {
	s.lock.Lock()
	defer s.lock.Unlock()
	if result != nil {
		s.cached = result
	}
	// the very first snapshot has no CPU deltas, so hold readers until the second one rather
	// than handing them a CPU-less list (which would also make the default cpu sort meaningless)
	if !*firstDone && (result == nil || result.HasCPU) {
		*firstDone = true
		close(firstReadyCh)
		s.ready = nil
	}
	now := time.Now()
	interval := time.Duration(0)
	for id, lease := range s.leases {
		if now.Sub(lease.lastSeen) >= ProcCacheIdleTimeout {
			delete(s.leases, id)
			continue
		}
		if interval == 0 || lease.interval < interval {
			interval = lease.interval
		}
	}
	if interval > 0 {
		if !*firstDone {
			return false, ProcCacheMinSleep
		}
		return false, interval
	}
	if !*firstDone {
		*firstDone = true
		close(firstReadyCh)
		s.ready = nil
	}
	s.cached = nil
	s.running = false
	s.lastCPUSamples = nil
	s.lastCPUEpoch = 0
	s.uidCache = nil
	return true, 0
}

func (s *procCacheState) runLoop(firstReadyCh chan struct{}) {
	firstDone := false
	defer func() {
		if panichandler.PanicHandler("procCache.runLoop", recover()) == nil {
			return
		}
		s.lock.Lock()
		defer s.lock.Unlock()
		s.running = false
		if !firstDone {
			close(firstReadyCh)
			s.ready = nil
		}
	}()

	numCPU := max(runtime.NumCPU(), 1)

	for {
		iterStart := time.Now()

		s.lastCPUEpoch++
		result := s.collectSnapshot(numCPU)

		// Remove stale entries (pids that weren't seen this epoch).
		for pid, sample := range s.lastCPUSamples {
			if sample.Epoch < s.lastCPUEpoch {
				delete(s.lastCPUSamples, pid)
			}
		}

		exit, interval := s.updateCacheAndCheckIdle(result, &firstDone, firstReadyCh)
		if exit {
			return
		}

		elapsed := time.Since(iterStart)
		time.Sleep(max(ProcCacheMinSleep, interval-elapsed))
	}
}

// lookupUID resolves a uid to a username, using the per-run cache to avoid
// repeated syscalls for the same uid.
func (s *procCacheState) lookupUID(uid uint32) string {
	if runtime.GOOS == "windows" {
		return ""
	}
	if s.uidCache == nil {
		s.uidCache = make(map[uint32]string)
	}
	if name, ok := s.uidCache[uid]; ok {
		return name
	}
	u, err := user.LookupId(strconv.FormatUint(uint64(uid), 10))
	if err != nil {
		s.uidCache[uid] = ""
		return ""
	}
	name := u.Username
	s.uidCache[uid] = name
	return name
}

// collectSnapshot fetches all process info, updates lastCPUSamples with fresh measurements,
// and computes CPU% using each pid's previous sample (if available).
func (s *procCacheState) collectSnapshot(numCPU int) *wshrpc.ProcessListResponse {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	procs, err := goproc.ProcessesWithContext(ctx)
	if err != nil {
		return nil
	}

	if s.lastCPUSamples == nil {
		s.lastCPUSamples = make(map[int32]cpuSample, len(procs))
	}

	snap, err := procinfo.MakeGlobalSnapshot()
	if err != nil {
		return nil
	}

	hasCPU := s.lastCPUEpoch > 1 // first epoch has no previous sample to diff against

	type pidInfo struct {
		pid  int32
		info *procinfo.ProcInfo
	}
	rawInfos := make([]pidInfo, len(procs))
	for i, p := range procs {
		pi, err := procinfo.GetProcInfo(ctx, snap, p.Pid)
		if err != nil {
			pi = nil
		}
		rawInfos[i] = pidInfo{pid: p.Pid, info: pi}
	}

	// Sample CPU times and compute CPU% sequentially to keep epoch accounting simple.
	cpuPcts := make(map[int32]float64, len(procs))
	sampleTime := time.Now()
	for _, ri := range rawInfos {
		if ri.info == nil {
			continue
		}
		if ri.info.CpuUser < 0 || ri.info.CpuSys < 0 {
			continue
		}
		curCPUSec := ri.info.CpuUser + ri.info.CpuSys

		if hasCPU {
			if prev, ok := s.lastCPUSamples[ri.pid]; ok {
				elapsed := sampleTime.Sub(prev.SampledAt).Seconds()
				if elapsed > 0 {
					cpuPcts[ri.pid] = computeCPUPct(prev.CPUSec, curCPUSec, elapsed)
				}
			}
		}

		s.lastCPUSamples[ri.pid] = cpuSample{
			CPUSec:    curCPUSec,
			SampledAt: sampleTime,
			Epoch:     s.lastCPUEpoch,
		}
	}

	// Compute total memory for MemPct and summary.
	vmStat, _ := mem.VirtualMemoryWithContext(ctx)
	var totalMem uint64
	if vmStat != nil {
		totalMem = vmStat.Total
	}

	var cpuSum float64
	infos := make([]wshrpc.ProcessInfo, 0, len(rawInfos))
	for _, ri := range rawInfos {
		if ri.info == nil {
			continue
		}
		pi := ri.info
		username := pi.User
		if username == "" {
			username = s.lookupUID(pi.Uid)
		}
		info := wshrpc.ProcessInfo{
			Pid:        pi.Pid,
			Ppid:       pi.Ppid,
			Command:    pi.Command,
			Status:     pi.Status,
			Mem:        pi.VmRSS,
			MemPct:     -1,
			Cpu:        -1,
			NumThreads: pi.NumThreads,
			User:       username,
		}
		if totalMem > 0 && pi.VmRSS >= 0 {
			info.MemPct = float64(pi.VmRSS) / float64(totalMem) * 100
		}
		if hasCPU {
			if cpu, ok := cpuPcts[pi.Pid]; ok {
				info.Cpu = cpu
				cpuSum += cpu
			}
		}
		infos = append(infos, info)
	}

	summary := buildProcessSummary(ctx, len(procs), numCPU, cpuSum, vmStat)

	return &wshrpc.ProcessListResponse{
		Processes: infos,
		Summary:   summary,
		Ts:        time.Now().UnixMilli(),
		HasCPU:    hasCPU,
		Platform:  runtime.GOOS,
	}
}

func bound(v, lo, hi int) int {
	return max(lo, min(v, hi))
}

func computeCPUPct(t1, t2, elapsedSec float64) float64 {
	delta := (t2 - t1) / elapsedSec * 100
	if delta < 0 {
		delta = 0
	}
	return delta
}

func buildProcessSummary(ctx context.Context, total int, numCPU int, cpuSum float64, vmStat *mem.VirtualMemoryStat) wshrpc.ProcessSummary {
	summary := wshrpc.ProcessSummary{Total: total, NumCPU: numCPU, CpuSum: cpuSum}
	if avg, err := load.AvgWithContext(ctx); err == nil {
		summary.Load1 = avg.Load1
		summary.Load5 = avg.Load5
		summary.Load15 = avg.Load15
	}
	if vmStat != nil {
		summary.MemTotal = vmStat.Total
		summary.MemUsed = vmStat.Used
		summary.MemFree = vmStat.Free
	}
	return summary
}

func filterProcesses(processes []wshrpc.ProcessInfo, textSearch string) []wshrpc.ProcessInfo {
	if textSearch == "" {
		return processes
	}
	search := strings.ToLower(textSearch)
	filtered := processes[:0]
	for _, p := range processes {
		pidStr := strconv.Itoa(int(p.Pid))
		if strings.Contains(strings.ToLower(p.Command), search) ||
			strings.Contains(strings.ToLower(p.Status), search) ||
			strings.Contains(strings.ToLower(p.User), search) ||
			strings.Contains(pidStr, search) {
			filtered = append(filtered, p)
		}
	}
	return filtered
}

func sortProcesses(processes []wshrpc.ProcessInfo, sortBy string, sortDesc bool) {
	switch sortBy {
	case "cpu":
		sort.Slice(processes, func(i, j int) bool {
			ci := processes[i].Cpu
			cj := processes[j].Cpu
			iNull := ci < 0
			jNull := cj < 0
			if iNull != jNull {
				return !iNull
			}
			if !iNull && ci != cj {
				if sortDesc {
					return ci > cj
				}
				return ci < cj
			}
			return processes[i].Pid < processes[j].Pid
		})
	case "mem":
		sort.Slice(processes, func(i, j int) bool {
			mi := processes[i].Mem
			mj := processes[j].Mem
			iNull := mi < 0
			jNull := mj < 0
			if iNull != jNull {
				return !iNull
			}
			if !iNull && mi != mj {
				if sortDesc {
					return mi > mj
				}
				return mi < mj
			}
			return processes[i].Pid < processes[j].Pid
		})
	case "command":
		sort.Slice(processes, func(i, j int) bool {
			if processes[i].Command != processes[j].Command {
				if sortDesc {
					return processes[i].Command > processes[j].Command
				}
				return processes[i].Command < processes[j].Command
			}
			return processes[i].Pid < processes[j].Pid
		})
	case "user":
		sort.Slice(processes, func(i, j int) bool {
			if processes[i].User != processes[j].User {
				if sortDesc {
					return processes[i].User > processes[j].User
				}
				return processes[i].User < processes[j].User
			}
			return processes[i].Pid < processes[j].Pid
		})
	case "status":
		sort.Slice(processes, func(i, j int) bool {
			if processes[i].Status != processes[j].Status {
				if sortDesc {
					return processes[i].Status > processes[j].Status
				}
				return processes[i].Status < processes[j].Status
			}
			return processes[i].Pid < processes[j].Pid
		})
	case "threads":
		sort.Slice(processes, func(i, j int) bool {
			ti := processes[i].NumThreads
			tj := processes[j].NumThreads
			iNull := ti < 0
			jNull := tj < 0
			if iNull != jNull {
				return !iNull
			}
			if !iNull && ti != tj {
				if sortDesc {
					return ti > tj
				}
				return ti < tj
			}
			return processes[i].Pid < processes[j].Pid
		})
	default: // "pid"
		sort.Slice(processes, func(i, j int) bool {
			if sortDesc {
				return processes[i].Pid > processes[j].Pid
			}
			return processes[i].Pid < processes[j].Pid
		})
	}
}

func (impl *ServerImpl) RemoteProcessListCommand(ctx context.Context, data wshrpc.CommandRemoteProcessListData) (*wshrpc.ProcessListResponse, error) {
	if data.Release {
		procCache.releaseWidget(data.WidgetId)
		return nil, nil
	}
	if data.KeepAlive {
		procCache.touchWidgetPidOrder(data.WidgetId)
		return nil, nil
	}

	raw, err := procCache.requestAndWait(ctx, data.WidgetId, clampProcInterval(data.Interval))
	if err != nil {
		return nil, err
	}

	totalCount := len(raw.Processes)

	// Phase 1: derive the pid order.
	// Use cached order if LastPidOrder is set and a cached order exists; otherwise filter/sort and store.
	var pidOrder []int32
	var filteredCount int
	if data.LastPidOrder {
		var cachedTotal int
		pidOrder, cachedTotal = procCache.getWidgetPidOrder(data.WidgetId)
		if pidOrder != nil {
			filteredCount = len(pidOrder)
			totalCount = cachedTotal
		}
	}
	if pidOrder == nil {
		sortBy := data.SortBy
		sortDesc := data.SortDesc
		if sortBy == "" {
			sortBy = "cpu"
			sortDesc = true
		}
		procs := make([]wshrpc.ProcessInfo, len(raw.Processes))
		copy(procs, raw.Processes)
		procs = filterProcesses(procs, data.TextSearch)
		filteredCount = len(procs)
		sortProcesses(procs, sortBy, sortDesc)
		pidOrder = make([]int32, len(procs))
		for i, p := range procs {
			pidOrder[i] = p.Pid
		}
		if data.WidgetId != "" {
			procCache.storeWidgetPidOrder(data.WidgetId, pidOrder, totalCount)
		}
	}

	// Phase 2: limit and populate process info from the pid order.
	limit := data.Limit
	if limit <= 0 || limit > ProcViewerMaxLimit {
		limit = ProcViewerMaxLimit
	}
	pidMap := make(map[int32]wshrpc.ProcessInfo, len(raw.Processes))
	for _, p := range raw.Processes {
		pidMap[p.Pid] = p
	}
	start := bound(data.Start, 0, len(pidOrder))
	window := pidOrder[start:]
	if limit > 0 && len(window) > limit {
		window = window[:limit]
	}
	processes := make([]wshrpc.ProcessInfo, 0, len(window))
	for _, pid := range window {
		if p, ok := pidMap[pid]; ok {
			processes = append(processes, p)
		} else {
			processes = append(processes, wshrpc.ProcessInfo{Pid: pid, Gone: true})
		}
	}

	return &wshrpc.ProcessListResponse{
		Processes:     processes,
		Summary:       raw.Summary,
		Ts:            raw.Ts,
		HasCPU:        raw.HasCPU,
		Platform:      raw.Platform,
		TotalCount:    totalCount,
		FilteredCount: filteredCount,
	}, nil
}

func (impl *ServerImpl) RemoteProcessSignalCommand(ctx context.Context, data wshrpc.CommandRemoteProcessSignalData) error {
	if runtime.GOOS == "windows" {
		// special case handling for windows. SIGTERM is mapped to "Kill Process" context menu so will do a proc.Kill() on windows
		proc, err := os.FindProcess(int(data.Pid))
		if err != nil {
			return fmt.Errorf("process %d not found: %w", data.Pid, err)
		}
		sig := strings.ToUpper(data.Signal)
		if sig == "SIGINT" {
			return proc.Signal(os.Interrupt)
		}
		if sig == "SIGTERM" || sig == "SIGKILL" {
			return proc.Kill()
		}
		return fmt.Errorf("signal %q is not supported on Windows", data.Signal)
	}
	return unixutil.SendSignalByName(int(data.Pid), data.Signal)
}
