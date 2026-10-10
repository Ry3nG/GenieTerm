// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"context"
	"log"
	"os"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/wps"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc/wshclient"
	"github.com/Ry3nG/GenieTerm/pkg/wshutil"
	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	gopsnet "github.com/shirou/gopsutil/v4/net"
)

const BYTES_PER_GB = 1073741824

// watchers re-send active every few seconds, so a renderer that reloads or crashes
// without sending active:false stops sampling once its lease lapses
const SysInfoWatchExpiry = 15 * time.Second
const SysInfoSampleInterval = 1 * time.Second
const SysInfoIdleCheckInterval = 5 * time.Second

var sysInfoWatchLock sync.Mutex
var sysInfoWatchers = make(map[string]time.Time)
var sysInfoWake = make(chan struct{}, 1)

func SetSysInfoWatchActive(watcherId string, active bool) {
	if !setSysInfoWatcher(watcherId, active) {
		return
	}
	select {
	case sysInfoWake <- struct{}{}:
	default:
	}
}

// returns true if this call added a new watcher
func setSysInfoWatcher(watcherId string, active bool) bool {
	sysInfoWatchLock.Lock()
	defer sysInfoWatchLock.Unlock()
	if !active {
		delete(sysInfoWatchers, watcherId)
		return false
	}
	_, existed := sysInfoWatchers[watcherId]
	sysInfoWatchers[watcherId] = time.Now()
	return !existed
}

func sysInfoHasWatchers() bool {
	sysInfoWatchLock.Lock()
	defer sysInfoWatchLock.Unlock()
	now := time.Now()
	for id, lastSeen := range sysInfoWatchers {
		if now.Sub(lastSeen) >= SysInfoWatchExpiry {
			delete(sysInfoWatchers, id)
		}
	}
	return len(sysInfoWatchers) > 0
}

func getCpuData(values map[string]float64) {
	percentArr, err := cpu.Percent(0, false)
	if err != nil {
		return
	}
	if len(percentArr) > 0 {
		values[wshrpc.TimeSeries_Cpu] = percentArr[0]
	}
	percentArr, err = cpu.Percent(0, true)
	if err != nil {
		return
	}
	for idx, percent := range percentArr {
		values[wshrpc.TimeSeries_Cpu+":"+strconv.Itoa(idx)] = percent
	}
}

func getMemData(values map[string]float64) {
	memData, err := mem.VirtualMemory()
	if err != nil {
		return
	}
	values["mem:total"] = float64(memData.Total) / BYTES_PER_GB
	values["mem:available"] = float64(memData.Available) / BYTES_PER_GB
	values["mem:used"] = float64(memData.Used) / BYTES_PER_GB
	values["mem:free"] = float64(memData.Free) / BYTES_PER_GB
}

func getSwapLoadData(values map[string]float64) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if swap, err := mem.SwapMemoryWithContext(ctx); err == nil {
		values["swap:total"] = float64(swap.Total) / BYTES_PER_GB
		values["swap:used"] = float64(swap.Used) / BYTES_PER_GB
	}
	if runtime.GOOS != "windows" {
		if avg, err := load.AvgWithContext(ctx); err == nil {
			values["load:1"] = avg.Load1
			values["load:5"] = avg.Load5
			values["load:15"] = avg.Load15
		}
	}
}

// diskRoot returns the mountpoint to report disk usage for, per the OS this
// code runs on (which is the remote host for SSH connections).
func diskRoot() string {
	if runtime.GOOS == "windows" {
		if sysDrive := os.Getenv("SystemDrive"); sysDrive != "" {
			return sysDrive + "\\"
		}
		return "C:\\"
	}
	return "/"
}

// pseudoFsTypes are virtual/in-memory filesystems we never want to list as a
// physical disk (tmpfs, snap squashfs mounts, kernel pseudo-fs, etc.).
var pseudoFsTypes = map[string]bool{
	"tmpfs": true, "devtmpfs": true, "devfs": true, "overlay": true,
	"squashfs": true, "efivarfs": true, "autofs": true, "proc": true,
	"sysfs": true, "cgroup": true, "cgroup2": true, "ramfs": true,
	"mqueue": true, "debugfs": true, "tracefs": true, "securityfs": true,
	"pstore": true, "bpf": true, "configfs": true, "hugetlbfs": true,
	"binfmt_misc": true, "nsfs": true, "fusectl": true, "fuse.snapfuse": true,
	"fuse.gvfsd-fuse": true, "fuse.portal": true,
}

// isRealDiskPartition keeps only physical-backed filesystems worth showing:
// drops pseudo filesystems, loop/snap mounts, boot partitions, and macOS
// synthetic system volumes.
func isRealDiskPartition(p disk.PartitionStat) bool {
	if pseudoFsTypes[strings.ToLower(p.Fstype)] {
		return false
	}
	if strings.HasPrefix(p.Device, "/dev/loop") {
		return false
	}
	if p.Mountpoint == "/boot" || strings.HasPrefix(p.Mountpoint, "/boot/") {
		return false
	}
	if strings.HasPrefix(p.Mountpoint, "/System/Volumes/") {
		return false
	}
	return true
}

// getDiskData reports usage for every real physical disk. It also keeps the root
// mount under the disk:* keys for back-compat with clients that read a single disk.
func getDiskData(values map[string]float64) []wshrpc.DiskUsageData {
	if usage, err := disk.Usage(diskRoot()); err == nil {
		values["disk:total"] = float64(usage.Total) / BYTES_PER_GB
		values["disk:used"] = float64(usage.Used) / BYTES_PER_GB
		values["disk:free"] = float64(usage.Free) / BYTES_PER_GB
		values["disk:percent"] = usage.UsedPercent
	}
	parts, err := disk.Partitions(false)
	if err != nil {
		return nil
	}
	var disks []wshrpc.DiskUsageData
	seen := make(map[string]bool)
	for _, p := range parts {
		if !isRealDiskPartition(p) || seen[p.Mountpoint] {
			continue
		}
		usage, err := disk.Usage(p.Mountpoint)
		if err != nil || usage.Total == 0 {
			continue
		}
		seen[p.Mountpoint] = true
		disks = append(disks, wshrpc.DiskUsageData{
			Mount:   p.Mountpoint,
			Total:   float64(usage.Total) / BYTES_PER_GB,
			Used:    float64(usage.Used) / BYTES_PER_GB,
			Free:    float64(usage.Free) / BYTES_PER_GB,
			Percent: usage.UsedPercent,
		})
	}
	sort.Slice(disks, func(i, j int) bool { return disks[i].Mount < disks[j].Mount })
	return disks
}

// netSampler tracks the previous cumulative network counters so per-second
// rates (bytes/sec) can be derived between samples.
type netSampler struct {
	prevSent uint64
	prevRecv uint64
	prevTs   time.Time
	hasPrev  bool
}

func (s *netSampler) getNetData(values map[string]float64, now time.Time) {
	counters, err := gopsnet.IOCounters(false)
	if err != nil || len(counters) == 0 {
		return
	}
	sent := counters[0].BytesSent
	recv := counters[0].BytesRecv
	if s.hasPrev {
		dt := now.Sub(s.prevTs).Seconds()
		if dt > 0 {
			// guard against counter reset/wrap on interface changes
			if sent >= s.prevSent {
				values["net:up"] = float64(sent-s.prevSent) / dt
			}
			if recv >= s.prevRecv {
				values["net:down"] = float64(recv-s.prevRecv) / dt
			}
		}
	}
	s.prevSent = sent
	s.prevRecv = recv
	s.prevTs = now
	s.hasPrev = true
}

func generateSingleServerData(client *wshutil.WshRpc, connName string, netState *netSampler) {
	now := time.Now()
	values := make(map[string]float64)
	getCpuData(values)
	getMemData(values)
	getSwapLoadData(values)
	disks := getDiskData(values)
	netState.getNetData(values, now)
	tsData := wshrpc.TimeSeriesData{Ts: now.UnixMilli(), Values: values, Disks: disks, Gpus: gpuCache.latest(time.Now())}
	event := wps.WaveEvent{
		Event:   wps.Event_SysInfo,
		Scopes:  []string{connName},
		Data:    tsData,
		Persist: 150,
	}
	wshclient.EventPublishCommand(client, event, &wshrpc.RpcOpts{NoResponse: true})
}

func RunSysInfoLoop(client *wshutil.WshRpc, connName string) {
	defer gpuCache.setActive(false)
	defer func() {
		log.Printf("sysinfo loop ended conn:%s\n", connName)
	}()
	netState := &netSampler{}
	for {
		active := sysInfoHasWatchers()
		gpuCache.setActive(active)
		if active {
			generateSingleServerData(client, connName, netState)
			time.Sleep(SysInfoSampleInterval)
			continue
		}
		// a rate computed across an idle gap would be misleading
		netState.hasPrev = false
		select {
		case <-sysInfoWake:
		case <-time.After(SysInfoIdleCheckInterval):
		}
	}
}

func (impl *ServerImpl) RemoteSysInfoWatchCommand(ctx context.Context, data wshrpc.CommandRemoteSysInfoWatchData) error {
	SetSysInfoWatchActive(data.WatcherId, data.Active)
	return nil
}
