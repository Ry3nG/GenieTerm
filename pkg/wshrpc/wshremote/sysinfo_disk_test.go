// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshremote

import (
	"testing"

	"github.com/shirou/gopsutil/v4/disk"
)

func TestSelectDisksInContainer(t *testing.T) {
	bind := []string{"rw", "bind"}
	parts := []disk.PartitionStat{
		{Device: "overlay", Mountpoint: "/", Fstype: "overlay"},
		{Device: "proc", Mountpoint: "/proc", Fstype: "proc"},
		{Device: "/dev/mapper/datavg-datalv", Mountpoint: "/tmp/shared-storage", Fstype: "xfs", Opts: bind},
		{Device: "/dev/mapper/rl-root", Mountpoint: "/tmp/acs", Fstype: "xfs", Opts: bind},
		{Device: "quarkfs_client", Mountpoint: "/mnt/afs", Fstype: "fuse.quarkfs_client"},
		{Device: "/dev/mapper/datavg-datalv", Mountpoint: "/etc/hosts", Fstype: "xfs", Opts: bind},
		{Device: "/dev/mapper/rl-root", Mountpoint: "/usr/bin/nvidia-smi", Fstype: "xfs", Opts: bind},
		{Device: "/dev/mapper/rl-root", Mountpoint: "/tmp/acs-copy", Fstype: "xfs", Opts: bind},
		{Device: "devtmpfs", Mountpoint: "/dev/nvidia0", Fstype: "devtmpfs"},
		{Device: "tmpfs", Mountpoint: "/dev/shm", Fstype: "tmpfs"},
		{Device: "lxcfs", Mountpoint: "/proc/cpuinfo", Fstype: "fuse.lxcfs"},
	}
	files := map[string]bool{"/etc/hosts": true, "/usr/bin/nvidia-smi": true}
	stat := func(mount string) *disk.UsageStat {
		if files[mount] {
			return nil
		}
		return &disk.UsageStat{Path: mount, Total: 100 * BYTES_PER_GB, Used: 40 * BYTES_PER_GB, UsedPercent: 40}
	}
	got := selectDisks(parts, stat)
	var mounts []string
	for _, d := range got {
		mounts = append(mounts, d.Mount)
	}
	want := []string{"/", "/mnt/afs", "/tmp/acs", "/tmp/shared-storage"}
	if len(mounts) != len(want) {
		t.Fatalf("mounts = %v, want %v", mounts, want)
	}
	for i := range want {
		if mounts[i] != want[i] {
			t.Fatalf("mounts = %v, want %v", mounts, want)
		}
	}
}

func TestSelectDisksOnHost(t *testing.T) {
	parts := []disk.PartitionStat{
		{Device: "/dev/nvme0n1p2", Mountpoint: "/", Fstype: "ext4"},
		{Device: "/dev/nvme0n1p1", Mountpoint: "/boot/efi", Fstype: "vfat"},
		{Device: "/dev/loop3", Mountpoint: "/snap/core/1", Fstype: "squashfs"},
		{Device: "nas:/export/data", Mountpoint: "/mnt/data", Fstype: "nfs4"},
		{Device: "//nas/share", Mountpoint: "/mnt/nas", Fstype: "cifs"},
		{Device: "overlay", Mountpoint: "/var/lib/docker/overlay2/abc/merged", Fstype: "overlay"},
		{Device: "/dev/sdb1", Mountpoint: "/data", Fstype: "xfs"},
		{Device: "/dev/sdb1", Mountpoint: "/home/me/data", Fstype: "xfs", Opts: []string{"bind"}},
		{Device: "slow:/export", Mountpoint: "/mnt/slow", Fstype: "nfs"},
	}
	stat := func(mount string) *disk.UsageStat {
		if mount == "/mnt/slow" {
			return nil
		}
		return &disk.UsageStat{Path: mount, Total: 10 * BYTES_PER_GB}
	}
	got := selectDisks(parts, stat)
	want := []string{"/", "/data", "/mnt/data", "/mnt/nas"}
	if len(got) != len(want) {
		t.Fatalf("got %d disks: %+v", len(got), got)
	}
	for i := range want {
		if got[i].Mount != want[i] {
			t.Fatalf("got %+v, want %v", got, want)
		}
	}
}

func TestStatMountDirSkipsFilesAndReportsDirs(t *testing.T) {
	dir := t.TempDir()
	if statMountDir(dir) == nil {
		t.Fatal("a directory should report usage")
	}
	if statMountDir(dir+"/missing") != nil {
		t.Fatal("a missing mount should be skipped")
	}
}
