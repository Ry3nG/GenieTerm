// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"os/user"
	"path/filepath"
	"regexp"
	"strings"
	"text/template"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/blocklogger"
	"github.com/Ry3nG/GenieTerm/pkg/genconn"
	"github.com/Ry3nG/GenieTerm/pkg/util/iterfn"
	"github.com/Ry3nG/GenieTerm/pkg/util/shellutil"
	"github.com/Ry3nG/GenieTerm/pkg/wavebase"
	"github.com/Ry3nG/GenieTerm/pkg/wconfig"
	"golang.org/x/crypto/ssh"
)

// ssh config Host aliases often contain underscores (e.g. "lab_gpu"), so the host part allows them.
var userHostRe = regexp.MustCompile(`^([a-zA-Z0-9][a-zA-Z0-9._@\\-]*@)?([a-zA-Z0-9][a-zA-Z0-9._-]*)(?::([0-9]+))?$`)

func ParseOpts(input string) (*SSHOpts, error) {
	m := userHostRe.FindStringSubmatch(input)
	if m == nil {
		return nil, fmt.Errorf("invalid format of user@host argument")
	}
	remoteUser, remoteHost, remotePort := m[1], m[2], m[3]
	remoteUser = strings.Trim(remoteUser, "@")

	return &SSHOpts{SSHHost: remoteHost, SSHUser: remoteUser, SSHPort: remotePort}, nil
}

func normalizeOs(os string) string {
	os = strings.ToLower(strings.TrimSpace(os))
	return os
}

func normalizeArch(arch string) string {
	arch = strings.ToLower(strings.TrimSpace(arch))
	switch arch {
	case "x86_64", "amd64":
		arch = "x64"
	case "arm64", "aarch64":
		arch = "arm64"
	}
	return arch
}

// returns (os, arch, error)
// guaranteed to return a supported platform
func GetClientPlatform(ctx context.Context, shell genconn.ShellClient) (string, string, error) {
	blocklogger.Infof(ctx, "[conndebug] running `uname -sm` to detect client platform\n")
	stdout, stderr, err := genconn.RunSimpleCommand(ctx, shell, genconn.CommandSpec{
		Cmd: "uname -sm",
	})
	if err != nil {
		return "", "", fmt.Errorf("error running uname -sm: %w, stderr: %s", err, stderr)
	}
	// Parse and normalize output
	parts := strings.Fields(strings.ToLower(strings.TrimSpace(stdout)))
	if len(parts) != 2 {
		return "", "", fmt.Errorf("unexpected output from uname: %s", stdout)
	}
	os, arch := normalizeOs(parts[0]), normalizeArch(parts[1])
	if err := wavebase.ValidateWshSupportedArch(os, arch); err != nil {
		return "", "", err
	}
	return os, arch, nil
}

func GetClientPlatformFromOsArchStr(ctx context.Context, osArchStr string) (string, string, error) {
	parts := strings.Fields(strings.TrimSpace(osArchStr))
	if len(parts) != 2 {
		return "", "", fmt.Errorf("unexpected output from uname: %s", osArchStr)
	}
	os, arch := normalizeOs(parts[0]), normalizeArch(parts[1])
	if err := wavebase.ValidateWshSupportedArch(os, arch); err != nil {
		return "", "", err
	}
	return os, arch, nil
}

// The helper binary is gzip-compressed on the wire (Go binaries shrink ~60-70%),
// which is the difference between landing and timing out on slow/proxied links.
// gzip/gunzip are effectively universal on the remotes we support.
// Interrupted copies used to leave a temp file behind on every attempt; failures now remove
// theirs, and temp files over an hour old (from earlier versions) are pruned. A concurrent
// install's fresh temp file is never touched.
var installTemplateRawDefault = strings.TrimSpace(`
mkdir -p {{.installDir}} || exit 1;
find {{.installDir}} -maxdepth 1 -name {{.tempGlob}} -mmin +60 -exec rm -f {} + 2>/dev/null || true;
gzip -dc > {{.tempPath}} || { rm -f {{.tempPath}}; exit 1; };
mv {{.tempPath}} {{.installPath}} || { rm -f {{.tempPath}}; exit 1; };
chmod a+x {{.installPath}} || exit 1;
`)
var installTemplate = template.Must(template.New("wsh-install-template").Parse(installTemplateRawDefault))

// remotePath must be the same path the connserver is launched from (conn:wshpath or the
// default helper path); "" means the default.
// InstallProgressFunc reports how much of the helper binary has been sent, in uncompressed bytes.
type InstallProgressFunc func(sent int64, total int64)

const installProgressInterval = 500 * time.Millisecond

// progressReader counts what gzip has read from the binary; the SSH channel's backpressure keeps
// that within a buffer of what has actually been sent.
type progressReader struct {
	r          io.Reader
	sent       int64
	total      int64
	lastReport time.Time
	onProgress InstallProgressFunc
}

func (pr *progressReader) Read(p []byte) (int, error) {
	n, err := pr.r.Read(p)
	pr.sent += int64(n)
	if pr.onProgress != nil && (time.Since(pr.lastReport) >= installProgressInterval || err == io.EOF) {
		pr.lastReport = time.Now()
		pr.onProgress(pr.sent, pr.total)
	}
	return n, err
}

// chunkedWriter hands the SSH channel small pieces so each accepted piece can be reported:
// on a very slow link a single gzip flush can otherwise take longer than the stall threshold.
type chunkedWriter struct {
	w          io.Writer
	chunk      int
	lastReport time.Time
	onAccepted func()
}

func (cw *chunkedWriter) Write(p []byte) (int, error) {
	written := 0
	for written < len(p) {
		end := min(written+cw.chunk, len(p))
		n, err := cw.w.Write(p[written:end])
		written += n
		if err != nil {
			return written, err
		}
		if cw.onAccepted != nil && time.Since(cw.lastReport) >= time.Second {
			cw.lastReport = time.Now()
			cw.onAccepted()
		}
	}
	return written, nil
}

func CpWshToRemote(ctx context.Context, client *ssh.Client, clientOs string, clientArch string, remotePath string, onProgress InstallProgressFunc) error {
	genieLocalPath, err := shellutil.GetLocalGenieBinaryPath(wavebase.WaveVersion, clientOs, clientArch)
	if err != nil {
		return err
	}
	if remotePath == "" {
		remotePath = wavebase.RemoteFullGenieBinPath
	}
	// Deploy only the genie helper — it's what the shell integration and connserver
	// use. We no longer push a second (redundant) wsh binary on every install; the
	// connserver still falls back to a legacy remote's ~/.waveterm/bin/wsh if one is
	// already present. This halves the bytes copied (matters on slow/proxied links).
	return cpHelperToRemote(ctx, client, genieLocalPath, remotePath, onProgress)
}

func cpHelperToRemote(ctx context.Context, client *ssh.Client, localPath string, remotePath string, onProgress InstallProgressFunc) error {
	deadline, ok := ctx.Deadline()
	if ok {
		blocklogger.Debugf(ctx, "[conndebug] CpWshToRemote, timeout: %v\n", time.Until(deadline))
	}
	input, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("cannot open local file %s: %w", localPath, err)
	}
	defer input.Close()
	var total int64
	if info, statErr := input.Stat(); statErr == nil {
		total = info.Size()
	}
	source := &progressReader{r: input, total: total, onProgress: onProgress}
	installWords := map[string]string{
		"installDir": shellutil.SoftQuote(filepath.ToSlash(filepath.Dir(remotePath))),
		// Unique temp path per copy so a retry/background install can't collide with
		// a lingering earlier attempt's write and leave a corrupt binary.
		"tempPath":    shellutil.SoftQuote(fmt.Sprintf("%s.temp.%d", remotePath, time.Now().UnixNano())),
		"installPath": shellutil.SoftQuote(remotePath),
		"tempGlob":    shellutil.HardQuote(filepath.Base(remotePath) + ".temp*"),
	}
	var installCmd bytes.Buffer
	if err := installTemplate.Execute(&installCmd, installWords); err != nil {
		return fmt.Errorf("failed to prepare install command: %w", err)
	}
	blocklogger.Infof(ctx, "[conndebug] copying %q to remote server %q\n", localPath, remotePath)
	genCmd, err := genconn.MakeSSHCmdClient(client, genconn.CommandSpec{
		Cmd: installCmd.String(),
	})
	if err != nil {
		return fmt.Errorf("failed to create remote command: %w", err)
	}
	stdin, err := genCmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("failed to get stdin pipe: %w", err)
	}
	defer stdin.Close()
	stderrBuf, err := genconn.MakeStderrSyncBuffer(genCmd)
	if err != nil {
		return fmt.Errorf("failed to get stderr pipe: %w", err)
	}
	if err := genCmd.Start(); err != nil {
		return fmt.Errorf("failed to start remote command: %w", err)
	}
	copyDone := make(chan error, 1)
	go func() {
		defer close(copyDone)
		defer stdin.Close()
		sink := &chunkedWriter{w: stdin, chunk: 4096}
		if onProgress != nil {
			sink.onAccepted = func() { onProgress(source.sent, source.total) }
		}
		gz, gzErr := gzip.NewWriterLevel(sink, gzip.BestCompression)
		if gzErr != nil {
			copyDone <- fmt.Errorf("failed to init gzip: %w", gzErr)
			return
		}
		if _, err := io.Copy(gz, source); err != nil && err != io.EOF {
			copyDone <- fmt.Errorf("failed to copy data: %w", err)
			return
		}
		if err := gz.Close(); err != nil {
			copyDone <- fmt.Errorf("failed to finalize gzip: %w", err)
			return
		}
		copyDone <- nil
	}()
	procErr := genconn.ProcessContextWait(ctx, genCmd)
	if procErr != nil {
		return fmt.Errorf("remote command failed: %w (stderr: %s)", procErr, stderrBuf.String())
	}
	copyErr := <-copyDone
	if copyErr != nil {
		return fmt.Errorf("failed to copy data: %w (stderr: %s)", copyErr, stderrBuf.String())
	}
	return nil
}

func IsPowershell(shellPath string) bool {
	// get the base path, and then check contains
	shellBase := filepath.Base(shellPath)
	return strings.Contains(shellBase, "powershell") || strings.Contains(shellBase, "pwsh")
}

func NormalizeConfigPattern(pattern string) string {
	userName, err := WaveSshConfigUserSettings().GetStrict(pattern, "User")
	if err != nil || userName == "" {
		log.Printf("warning: error parsing username of %s for conn dropdown: %v", pattern, err)
		localUser, err := user.Current()
		if err == nil {
			userName = localUser.Username
		}
	}
	port, err := WaveSshConfigUserSettings().GetStrict(pattern, "Port")
	if err != nil {
		port = "22"
	}
	if userName != "" {
		userName += "@"
	}
	if port == "22" {
		port = ""
	} else {
		port = ":" + port
	}
	return fmt.Sprintf("%s%s%s", userName, pattern, port)
}

func ParseProfiles() []string {
	connfile, cerrs := wconfig.ReadWaveHomeConfigFile(wconfig.ProfilesFile)
	if len(cerrs) > 0 {
		log.Printf("error reading config file: %v", cerrs[0])
		return nil
	}

	return iterfn.MapKeysToSorted(connfile)
}
