// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/genconn"
	"github.com/Ry3nG/GenieTerm/pkg/remote"
	"github.com/Ry3nG/GenieTerm/pkg/remote/conncontroller"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/Ry3nG/GenieTerm/pkg/wslconn"
)

const GitStatusDefaultTimeoutMs = 5000
const GitStatusMaxTimeoutMs = 15000
const GitGraphDefaultLimit = 80
const GitGraphMaxLimit = 200

func (ws *WshServer) GitStatusCommand(ctx context.Context, data wshrpc.CommandGitStatusData) (*wshrpc.GitStatusResponse, error) {
	timeoutMs := data.TimeoutMs
	if timeoutMs <= 0 || timeoutMs > GitStatusMaxTimeoutMs {
		timeoutMs = GitStatusDefaultTimeoutMs
	}
	runCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	stdout, stderr, exitCode, supported := runGitCommand(runCtx, data.ConnName, data.Cwd, gitStatusArgs())
	rtn := parseGitStatusPorcelain(stdout)
	rtn.Stdout = stdout
	rtn.Stderr = stderr
	rtn.ExitCode = exitCode
	rtn.Supported = supported
	return rtn, nil
}

func (ws *WshServer) GitGraphCommand(ctx context.Context, data wshrpc.CommandGitGraphData) (*wshrpc.GitGraphResponse, error) {
	timeoutMs := data.TimeoutMs
	if timeoutMs <= 0 || timeoutMs > GitStatusMaxTimeoutMs {
		timeoutMs = GitStatusDefaultTimeoutMs
	}
	runCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	stdout, stderr, exitCode, supported := runGitCommand(runCtx, data.ConnName, data.Cwd, gitGraphArgs(data.Limit))
	rtn := parseGitGraph(stdout)
	rtn.Stdout = stdout
	rtn.Stderr = stderr
	rtn.ExitCode = exitCode
	rtn.Supported = supported
	return rtn, nil
}

func gitStatusArgs() []string {
	return []string{"-c", "color.status=false", "status", "--porcelain=v1", "-z", "-b", "--untracked-files=all"}
}

func gitGraphArgs(limit int) []string {
	if limit <= 0 || limit > GitGraphMaxLimit {
		limit = GitGraphDefaultLimit
	}
	return []string{
		"-c",
		"color.ui=false",
		"--no-pager",
		"log",
		"--graph",
		"--all",
		"--date-order",
		"--decorate=short",
		"--date=short",
		fmt.Sprintf("--max-count=%d", limit),
		"--pretty=format:%x1f%H%x1f%h%x1f%P%x1f%D%x1f%an%x1f%ar%x1f%ct%x1f%s",
	}
}

func runGitCommand(ctx context.Context, connName string, cwd string, args []string) (string, string, int, bool) {
	if connName == "" || conncontroller.IsLocalConnName(connName) {
		return runLocalGitCommand(ctx, cwd, args)
	}
	if strings.HasPrefix(connName, "wsl://") {
		return runWslGitCommand(ctx, connName, cwd, args)
	}
	return runSshGitCommand(ctx, connName, cwd, args)
}

func runLocalGitCommand(ctx context.Context, cwd string, args []string) (string, string, int, bool) {
	cmd := exec.CommandContext(ctx, "git", args...)
	if cwd != "" {
		cmd.Dir = cwd
	}
	cmd.Env = os.Environ()
	var stdoutBuf, stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf
	runErr := cmd.Run()
	return stdoutBuf.String(), stderrBuf.String(), completionGenExitCode(runErr), true
}

func runWslGitCommand(ctx context.Context, connName string, cwd string, args []string) (string, string, int, bool) {
	distroName := strings.TrimPrefix(connName, "wsl://")
	conn := wslconn.GetWslConn(distroName)
	if conn == nil || conn.GetClient() == nil {
		return "", "WSL connection is not available", -1, false
	}
	stdout, stderr, runErr := genconn.RunSimpleCommand(ctx, genconn.MakeWSLShellClient(conn.GetClient()), genconn.CommandSpec{
		Cmd: buildCompletionGenCmdStr("git", args),
		Cwd: cwd,
	})
	return stdout, stderr, completionGenExitCode(runErr), true
}

func runSshGitCommand(ctx context.Context, connName string, cwd string, args []string) (string, string, int, bool) {
	connOpts, err := remote.ParseOpts(connName)
	if err != nil {
		return "", err.Error(), -1, false
	}
	conn := conncontroller.MaybeGetConn(connOpts)
	if conn == nil || conn.GetClient() == nil {
		return "", "SSH connection is not available", -1, false
	}
	stdout, stderr, runErr := genconn.RunSimpleCommand(ctx, genconn.MakeSSHShellClient(conn.GetClient()), genconn.CommandSpec{
		Cmd: buildCompletionGenCmdStr("git", args),
		Cwd: cwd,
	})
	return stdout, stderr, completionGenExitCode(runErr), true
}

func parseGitStatusPorcelain(stdout string) *wshrpc.GitStatusResponse {
	rtn := &wshrpc.GitStatusResponse{Files: []wshrpc.GitStatusFile{}}
	if stdout == "" {
		return rtn
	}
	records := strings.Split(stdout, "\x00")
	for idx := 0; idx < len(records); idx++ {
		record := records[idx]
		if record == "" {
			continue
		}
		if strings.HasPrefix(record, "## ") {
			rtn.Branch = strings.TrimPrefix(record, "## ")
			continue
		}
		if len(record) < 4 {
			continue
		}
		file := wshrpc.GitStatusFile{
			Index:    record[0:1],
			Worktree: record[1:2],
			Path:     record[3:],
		}
		if (file.Index == "R" || file.Index == "C") && idx+1 < len(records) {
			idx++
			file.OrigPath = records[idx]
		}
		rtn.Files = append(rtn.Files, file)
	}
	return rtn
}

func parseGitGraph(stdout string) *wshrpc.GitGraphResponse {
	rtn := &wshrpc.GitGraphResponse{Commits: []wshrpc.GitGraphCommit{}}
	if stdout == "" {
		return rtn
	}
	for _, line := range strings.Split(stdout, "\n") {
		sepIdx := strings.Index(line, "\x1f")
		if sepIdx < 0 {
			continue
		}
		fields := strings.Split(line[sepIdx:], "\x1f")
		if len(fields) < 9 {
			continue
		}
		timestamp, _ := strconv.ParseInt(fields[7], 10, 64)
		rtn.Commits = append(rtn.Commits, wshrpc.GitGraphCommit{
			Hash:      fields[1],
			ShortHash: fields[2],
			Parents:   strings.Fields(fields[3]),
			Refs:      parseGitRefs(fields[4]),
			Subject:   fields[8],
			Author:    fields[5],
			RelDate:   fields[6],
			Timestamp: timestamp,
			Graph:     strings.TrimRight(line[:sepIdx], " "),
		})
	}
	return rtn
}

func parseGitRefs(refs string) []string {
	rtn := []string{}
	for _, ref := range strings.Split(refs, ",") {
		ref = strings.TrimSpace(ref)
		if ref == "" {
			continue
		}
		rtn = append(rtn, ref)
	}
	return rtn
}
