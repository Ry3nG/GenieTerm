// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"bytes"
	"context"
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

func gitStatusArgs() []string {
	// --no-optional-locks keeps a background refresh from taking index.lock while the user runs git in a terminal.
	return []string{"--no-optional-locks", "-c", "color.status=false", "status", "--porcelain=v1", "-z", "-b", "--untracked-files=all"}
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
			parseGitBranchHeader(rtn, strings.TrimPrefix(record, "## "))
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

// parseGitBranchHeader reads the "## ..." line of `git status --porcelain=v1 -b`:
// "main...origin/main [ahead 1, behind 2]", "main", "HEAD (no branch)", "No commits yet on main".
func parseGitBranchHeader(rtn *wshrpc.GitStatusResponse, header string) {
	if header == "HEAD (no branch)" {
		rtn.Detached = true
		return
	}
	for _, prefix := range []string{"No commits yet on ", "Initial commit on "} {
		if strings.HasPrefix(header, prefix) {
			rtn.Branch = strings.TrimPrefix(header, prefix)
			return
		}
	}
	tracking := ""
	if idx := strings.Index(header, " ["); idx >= 0 && strings.HasSuffix(header, "]") {
		tracking = header[idx+2 : len(header)-1]
		header = header[:idx]
	}
	branch, upstream, _ := strings.Cut(header, "...")
	rtn.Branch = branch
	rtn.Upstream = upstream
	for _, part := range strings.Split(tracking, ",") {
		fields := strings.Fields(part)
		if len(fields) != 2 {
			continue
		}
		count, err := strconv.Atoi(fields[1])
		if err != nil {
			continue
		}
		if fields[0] == "ahead" {
			rtn.Ahead = count
		} else if fields[0] == "behind" {
			rtn.Behind = count
		}
	}
}
