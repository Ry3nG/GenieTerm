// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobcontroller

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/panichandler"
	"github.com/Ry3nG/GenieTerm/pkg/remote/conncontroller"
	"github.com/Ry3nG/GenieTerm/pkg/streamclient"
	"github.com/Ry3nG/GenieTerm/pkg/util/ds"
	"github.com/Ry3nG/GenieTerm/pkg/waveobj"
	"github.com/Ry3nG/GenieTerm/pkg/wstore"
)

const ReconnectJobTimeout = 15 * time.Second
const ReconnectJobMaxConcurrency = 4
const ReconnectJobMaxAttempts = 3

var ReconnectJobRetryDelays = []time.Duration{1 * time.Second, 3 * time.Second}

// jobStream tracks the active output stream of a job. lock serializes "is this stream
// still current + append its data" in runOutputLoop against "snapshot the file size +
// switch to a new stream" in restartStreaming, so a superseded loop can never append
// after the new stream's start offset was computed (which would duplicate output).
type jobStream struct {
	lock     sync.Mutex
	streamId string
	reader   *streamclient.Reader
}

var jobStreams = ds.MakeSyncMap[*jobStream]()

func getJobStream(jobId string) *jobStream {
	return jobStreams.GetOrCreate(jobId, func() *jobStream {
		return &jobStream{}
	})
}

// returns the reader it replaced (the caller must Close it)
func (js *jobStream) swap(streamId string, reader *streamclient.Reader) *streamclient.Reader {
	js.lock.Lock()
	defer js.lock.Unlock()
	return js.swap_withlock(streamId, reader)
}

func (js *jobStream) swap_withlock(streamId string, reader *streamclient.Reader) *streamclient.Reader {
	oldReader := js.reader
	js.streamId = streamId
	js.reader = reader
	if oldReader == reader {
		return nil
	}
	return oldReader
}

// runs fn under the stream lock if streamId is still the job's current stream
func (js *jobStream) runIfCurrent(streamId string, fn func()) bool {
	js.lock.Lock()
	defer js.lock.Unlock()
	if js.streamId != streamId {
		return false
	}
	fn()
	return true
}

func (js *jobStream) getStreamId() string {
	js.lock.Lock()
	defer js.lock.Unlock()
	return js.streamId
}

func closeStreamReader(reader *streamclient.Reader) {
	if reader == nil {
		return
	}
	reader.Close()
}

func removeJobStream(jobId string) {
	js, ok := jobStreams.GetEx(jobId)
	if !ok {
		return
	}
	jobStreams.Delete(jobId)
	closeStreamReader(js.swap("", nil))
}

func getRunningJobIdsForConn(ctx context.Context, connName string) ([]string, error) {
	allJobs, err := wstore.DBGetAllObjsByType[*waveobj.Job](ctx, waveobj.OType_Job)
	if err != nil {
		return nil, err
	}
	var jobIds []string
	for _, job := range allJobs {
		if job.Connection == connName && isJobManagerRunning(job) {
			jobIds = append(jobIds, job.OID)
		}
	}
	return jobIds, nil
}

// HasRunningJobsForConn reports whether any durable job manager on connName is still
// running (used to decide whether a dropped connection should auto-reconnect).
func HasRunningJobsForConn(connName string) bool {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	jobIds, err := getRunningJobIdsForConn(ctx, connName)
	if err != nil {
		log.Printf("[conn:%s] error checking for running jobs: %v", connName, err)
		return false
	}
	return len(jobIds) > 0
}

// runBounded calls fn for every item with at most limit calls in flight, and waits for all of them.
func runBounded(items []string, limit int, fn func(item string)) {
	if limit < 1 {
		limit = 1
	}
	sem := make(chan struct{}, limit)
	var wg sync.WaitGroup
	for _, item := range items {
		sem <- struct{}{}
		wg.Add(1)
		go func() {
			defer func() {
				panichandler.PanicHandler("jobcontroller:runBounded", recover())
			}()
			defer wg.Done()
			defer func() { <-sem }()
			fn(item)
		}()
	}
	wg.Wait()
}

// retryWithDelays runs attemptFn up to maxAttempts times, sleeping delays[i-1] before
// attempt i (the last delay repeats). attemptFn returns (stop, err): stop=true ends the
// retries early (success or a non-retryable failure).
func retryWithDelays(maxAttempts int, delays []time.Duration, sleepFn func(time.Duration), attemptFn func(attempt int) (bool, error)) error {
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if attempt > 1 && len(delays) > 0 {
			delayIdx := attempt - 2
			if delayIdx >= len(delays) {
				delayIdx = len(delays) - 1
			}
			sleepFn(delays[delayIdx])
		}
		stop, err := attemptFn(attempt)
		lastErr = err
		if stop {
			return err
		}
	}
	return lastErr
}

func reconnectJobWithRetry(connName string, jobId string) error {
	return retryWithDelays(ReconnectJobMaxAttempts, ReconnectJobRetryDelays, time.Sleep, func(attempt int) (bool, error) {
		isConnected, err := conncontroller.IsConnected(connName)
		if err != nil || !isConnected {
			return true, fmt.Errorf("connection %q is not connected", connName)
		}
		ctx, cancelFn := context.WithTimeout(context.Background(), ReconnectJobTimeout)
		defer cancelFn()
		err = ReconnectJob(ctx, jobId, nil)
		if err == nil {
			return true, nil
		}
		log.Printf("[job:%s] reconnect attempt %d/%d failed: %v", jobId, attempt, ReconnectJobMaxAttempts, err)
		getCtx, getCancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer getCancel()
		job, getErr := wstore.DBGet[*waveobj.Job](getCtx, jobId)
		if getErr != nil || job == nil || !isJobManagerRunning(job) {
			// the job manager is gone (or the job was deleted); retrying can't help
			return true, err
		}
		return false, err
	})
}

// CountRunningDurableJobs counts running job managers attached to the blocks of
// workspaceId (if set) plus blockIds. Used to warn before an action (closing a window,
// switching a block's connection) terminates durable sessions.
func CountRunningDurableJobs(ctx context.Context, workspaceId string, blockIds []string) (int, error) {
	allBlockIds := append([]string{}, blockIds...)
	if workspaceId != "" {
		workspace, err := wstore.DBGet[*waveobj.Workspace](ctx, workspaceId)
		if err != nil {
			return 0, fmt.Errorf("error getting workspace: %w", err)
		}
		if workspace != nil {
			for _, tabId := range workspace.TabIds {
				tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
				if err != nil {
					return 0, fmt.Errorf("error getting tab: %w", err)
				}
				if tab != nil {
					allBlockIds = append(allBlockIds, tab.BlockIds...)
				}
			}
		}
	}
	count := 0
	seen := make(map[string]bool)
	for _, blockId := range allBlockIds {
		if blockId == "" || seen[blockId] {
			continue
		}
		seen[blockId] = true
		block, err := wstore.DBGet[*waveobj.Block](ctx, blockId)
		if err != nil {
			return 0, fmt.Errorf("error getting block: %w", err)
		}
		if block == nil || block.JobId == "" {
			continue
		}
		job, err := wstore.DBGet[*waveobj.Job](ctx, block.JobId)
		if err != nil {
			return 0, fmt.Errorf("error getting job: %w", err)
		}
		if job != nil && job.JobManagerStatus != JobManagerStatus_Done {
			count++
		}
	}
	return count, nil
}
