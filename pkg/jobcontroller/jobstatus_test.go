// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

//go:build cgo

package jobcontroller

import (
	"context"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/filestore"
	"github.com/Ry3nG/GenieTerm/pkg/wavebase"
	"github.com/Ry3nG/GenieTerm/pkg/waveobj"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/Ry3nG/GenieTerm/pkg/wstore"
	"github.com/google/uuid"
)

func TestBlockJobStatusOutputGap(t *testing.T) {
	const homeEnv = "GENIETERM_TEST_JOBSTATUS_HOME"
	home := os.Getenv(homeEnv)
	if home == "" {
		// Stores own process-global handles and background flushers.
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestBlockJobStatusOutputGap$", "-test.v")
		cmd.Env = append(os.Environ(), homeEnv+"="+t.TempDir())
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("job status with real stores: %v\n%s", err, out)
		}
		return
	}
	wavebase.DataHome_VarCache = home
	if err := wavebase.EnsureWaveDBDir(); err != nil {
		t.Fatal(err)
	}
	if err := wstore.InitWStore(); err != nil {
		t.Fatal(err)
	}
	if err := filestore.InitFilestore(); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	job := &waveobj.Job{OID: uuid.NewString(), JobManagerStatus: JobManagerStatus_Running}
	block := &waveobj.Block{OID: uuid.NewString(), JobId: job.OID}
	for _, obj := range []waveobj.WaveObj{job, block} {
		if err := wstore.DBInsert(ctx, obj); err != nil {
			t.Fatal(err)
		}
	}
	checkGap := func(want int64) {
		t.Helper()
		status, err := GetBlockJobStatus(ctx, block.OID)
		if err != nil || status.OutputGap != want {
			t.Fatalf("output gap: status=%#v err=%v, want %d", status, err, want)
		}
	}
	checkGap(0)
	if err := filestore.WFS.MakeFile(ctx, job.OID, JobOutputFileName, nil, wshrpc.FileOpts{}); err != nil {
		t.Fatal(err)
	}
	checkGap(0)
	if err := filestore.WFS.WriteMeta(ctx, job.OID, JobOutputFileName, wshrpc.FileMeta{MetaKey_TotalGap: int64(4096)}, true); err != nil {
		t.Fatal(err)
	}
	checkGap(4096)
	job.JobManagerStatus = JobManagerStatus_Done
	if err := wstore.DBUpdate(ctx, job); err != nil {
		t.Fatal(err)
	}
	checkGap(4096)
	newJob := &waveobj.Job{OID: uuid.NewString(), JobManagerStatus: JobManagerStatus_Init}
	if err := wstore.DBInsert(ctx, newJob); err != nil {
		t.Fatal(err)
	}
	block.JobId = newJob.OID
	if err := wstore.DBUpdate(ctx, block); err != nil {
		t.Fatal(err)
	}
	checkGap(0)
}
