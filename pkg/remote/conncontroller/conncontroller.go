// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package conncontroller

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/blocklogger"
	"github.com/Ry3nG/GenieTerm/pkg/genconn"
	"github.com/Ry3nG/GenieTerm/pkg/panichandler"
	"github.com/Ry3nG/GenieTerm/pkg/remote"
	"github.com/Ry3nG/GenieTerm/pkg/telemetry"
	"github.com/Ry3nG/GenieTerm/pkg/telemetry/telemetrydata"
	"github.com/Ry3nG/GenieTerm/pkg/userinput"
	"github.com/Ry3nG/GenieTerm/pkg/util/envutil"
	"github.com/Ry3nG/GenieTerm/pkg/util/shellutil"
	"github.com/Ry3nG/GenieTerm/pkg/util/utilfn"
	"github.com/Ry3nG/GenieTerm/pkg/wavebase"
	"github.com/Ry3nG/GenieTerm/pkg/waveobj"
	"github.com/Ry3nG/GenieTerm/pkg/wconfig"
	"github.com/Ry3nG/GenieTerm/pkg/wps"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc/wshclient"
	"github.com/Ry3nG/GenieTerm/pkg/wshutil"
	"github.com/Ry3nG/GenieTerm/pkg/wstore"
	"github.com/kevinburke/ssh_config"
	"github.com/skeema/knownhosts"
	"golang.org/x/crypto/ssh"
	"golang.org/x/mod/semver"
)

const (
	Status_Init         = "init"
	Status_Connecting   = "connecting"
	Status_Connected    = "connected"
	Status_Disconnected = "disconnected"
	Status_Error        = "error"
)

const (
	NoWshCode_Disabled              = "disabled"
	NoWshCode_PermissionError       = "permission-error"
	NoWshCode_UserDeclined          = "user-declined"
	NoWshCode_DomainSocketError     = "domainsocket-error"
	NoWshCode_ConnServerStartError  = "connserver-start-error"
	NoWshCode_InstallError          = "install-error"
	NoWshCode_PostInstallStartError = "postinstall-start-error"
	NoWshCode_InstallVerifyError    = "install-verify-error"
	NoWshCode_InstallingBackground  = "installing-background"
)

const (
	ConnHealthStatus_Good     = "good"
	ConnHealthStatus_Degraded = "degraded"
	ConnHealthStatus_Stalled  = "stalled"
)

const DefaultConnectionTimeout = 60 * time.Second
const sshCloseWarningTimeout = 5 * time.Second

var globalLock = &sync.Mutex{}
var clientControllerMap = make(map[remote.SSHOpts]*SSHConn)
var activeConnCounter = &atomic.Int32{}
var activeSSHCleanupCount = &atomic.Int64{}

type SSHConn struct {
	lock          *sync.Mutex // this lock protects the fields in the struct from concurrent access
	lifecycleLock *sync.Mutex // this protects the lifecycle from concurrent calls

	Status             string
	ConnHealthStatus   string
	WshEnabled         *atomic.Bool
	Opts               *remote.SSHOpts
	Client             *ssh.Client
	DomainSockName     string // if "", then no domain socket
	DomainSockListener net.Listener
	ConnController     *ssh.Session
	Error              string
	WshError           string
	NoWshReason        string
	WshVersion         string
	WshInstallPct      int
	LastConnectTime    int64
	ActiveConnNum      int
	Monitor            *ConnMonitor // will not be nil
	wshInstalling      atomic.Bool  // guards a single background wsh install at a time
	installCancel      context.CancelFunc
	connectAbort       context.CancelFunc // non-nil while a Connect attempt is in flight
	reconnect          *reconnectLoop     // non-nil while an automatic reconnect loop is running
	Reconnecting       bool
	ReconnectAttempt   int
	NextReconnectTs    int64
}

func IsLocalConnName(connName string) bool {
	return strings.HasPrefix(connName, "local:") || connName == "local" || connName == ""
}

func MakeConnServerCommand(primaryPath string, fallbackPath string, connName string, flags ...string) string {
	flagStr := strings.TrimSpace(strings.Join(flags, " "))
	if flagStr != "" {
		flagStr = " " + flagStr
	}
	return strings.TrimSpace(strings.Join([]string{
		fmt.Sprintf("mkdir -p %s %s || exit 1;", shellutil.SoftQuote(wavebase.RemoteFullGenieHomePath), shellutil.SoftQuote(wavebase.RemoteFullGenieHomePath+"/client")),
		fmt.Sprintf("_genieterm_helper=%s;", shellutil.SoftQuote(primaryPath)),
		fmt.Sprintf("if [ ! -x \"$_genieterm_helper\" ] && [ -x %s ]; then _genieterm_helper=%s; fi;", shellutil.SoftQuote(fallbackPath), shellutil.SoftQuote(fallbackPath)),
		// a truncated or foreign binary can crash here, and the shell's own crash report would
		// otherwise reach the version parser; anything that isn't a version line means reinstall
		"_genieterm_version=$( ( \"$_genieterm_helper\" version --protocol || \"$_genieterm_helper\" version ) 2> /dev/null ) 2> /dev/null;",
		"case \"$_genieterm_version\" in \"genie v\"*|\"wsh v\"*) echo \"$_genieterm_version\";; *) printf \"not-installed %s\\n\" \"$(uname -sm)\"; exit 0;; esac;",
		fmt.Sprintf("exec \"$_genieterm_helper\" connserver --conn %s%s", shellutil.HardQuote(connName), flagStr),
	}, "\n"))
}

func IsWslConnName(connName string) bool {
	return strings.HasPrefix(connName, "wsl://")
}

func GetAllConnStatus() []wshrpc.ConnStatus {
	globalLock.Lock()
	defer globalLock.Unlock()

	var connStatuses []wshrpc.ConnStatus
	for _, conn := range clientControllerMap {
		connStatuses = append(connStatuses, conn.DeriveConnStatus())
	}
	return connStatuses
}

func getConnectionSnapshot() []*SSHConn {
	globalLock.Lock()
	defer globalLock.Unlock()

	connections := make([]*SSHConn, 0, len(clientControllerMap))
	for _, conn := range clientControllerMap {
		connections = append(connections, conn)
	}
	return connections
}

// NotifySystemResume probes every live connection right away (a connection that slept
// through a network change is usually dead but looks fine until TCP times out) and
// skips the backoff wait of any pending automatic reconnect.
func NotifySystemResume() int {
	connections := getConnectionSnapshot()
	notified := 0
	for _, conn := range connections {
		conn.kickAutoReconnect()
		monitor := conn.GetMonitor()
		if monitor == nil {
			continue
		}
		monitor.NotifyCheck()
		monitor.ProbeAfterResume()
		notified++
	}
	return notified
}

func (conn *SSHConn) DeriveConnStatus() wshrpc.ConnStatus {
	conn.lock.Lock()
	defer conn.lock.Unlock()
	var lastActivityBeforeStalledTime int64
	var keepAliveSentTime int64
	monitor := conn.Monitor
	if conn.ConnHealthStatus == ConnHealthStatus_Stalled && monitor != nil {
		lastActivityBeforeStalledTime = monitor.LastActivityTime.Load()
		keepAliveSentTime = monitor.KeepAliveSentTime.Load()
	}
	return wshrpc.ConnStatus{
		Status:                        conn.Status,
		Connected:                     conn.Status == Status_Connected,
		Connection:                    conn.Opts.String(),
		HasConnected:                  (conn.LastConnectTime > 0),
		ActiveConnNum:                 conn.ActiveConnNum,
		Error:                         conn.Error,
		WshEnabled:                    conn.WshEnabled.Load(),
		WshError:                      conn.WshError,
		NoWshReason:                   conn.NoWshReason,
		WshVersion:                    conn.WshVersion,
		WshInstallPct:                 conn.WshInstallPct,
		ConnHealthStatus:              conn.ConnHealthStatus,
		LastActivityBeforeStalledTime: lastActivityBeforeStalledTime,
		KeepAliveSentTime:             keepAliveSentTime,
		Reconnecting:                  conn.Reconnecting,
		ReconnectAttempt:              conn.ReconnectAttempt,
		NextReconnectTs:               conn.NextReconnectTs,
	}
}

func (conn *SSHConn) Infof(ctx context.Context, format string, args ...any) {
	log.Print(fmt.Sprintf("[conn:%s] ", conn.GetName()) + fmt.Sprintf(format, args...))
	blocklogger.Infof(ctx, "[conndebug] "+format, args...)
}

func (conn *SSHConn) Debugf(ctx context.Context, format string, args ...any) {
	blocklogger.Debugf(ctx, "[conndebug] "+format, args...)
}

func (conn *SSHConn) FireConnChangeEvent() {
	status := conn.DeriveConnStatus()
	event := wps.WaveEvent{
		Event: wps.Event_ConnChange,
		Scopes: []string{
			fmt.Sprintf("connection:%s", conn.GetName()),
		},
		Data: status,
	}
	log.Printf("sending event: %+#v", event)
	wps.Broker.Publish(event)
}

// Close is the user-facing disconnect: it stops any automatic reconnect loop and aborts an
// in-flight connect attempt (so a hung handshake can't block the disconnect behind
// lifecycleLock) before tearing the connection down.
func (conn *SSHConn) Close() error {
	wasReconnecting := conn.stopAutoReconnect()
	conn.abortConnectAttempt()
	conn.lifecycleLock.Lock()
	defer conn.lifecycleLock.Unlock()

	defer conn.FireConnChangeEvent()
	conn.WithLock(func() {
		if conn.Status == Status_Connected || conn.Status == Status_Connecting || wasReconnecting {
			// if status is init, disconnected, or error don't change it
			conn.Status = Status_Disconnected
		}
	})
	conn.closeInternal_withlifecyclelock()
	return nil
}

func (conn *SSHConn) setConnectAbort(abortFn context.CancelFunc) {
	conn.lock.Lock()
	defer conn.lock.Unlock()
	conn.connectAbort = abortFn
}

func (conn *SSHConn) abortConnectAttempt() {
	abortFn := WithLockRtn(conn, func() context.CancelFunc {
		return conn.connectAbort
	})
	if abortFn != nil {
		abortFn()
	}
}

func (conn *SSHConn) closeInternal_withlifecyclelock() {
	// does not set status (that should happen at another level)
	conn.WithLock(func() {
		if conn.installCancel != nil {
			conn.installCancel()
			conn.installCancel = nil
		}
		// Clear the dedup flag so a reconnect can re-arm a background install; the
		// old goroutine bails via its cancelled context, and its deferred reset is
		// then a harmless no-op.
		conn.wshInstalling.Store(false)
		if conn.Monitor != nil {
			conn.Monitor.Close()
			conn.Monitor = nil
		}
		conn.Monitor = nil
	})
	// Detach the network handles up front, then close them in the background.
	// Closing an SSH client/listener/session over a dead transport can block
	// indefinitely (DomainSockListener.Close() sends SSH protocol packets), and
	// this runs while holding lifecycleLock — so a synchronous close on a dead
	// network would wedge every future connect/disconnect on this conn. Nil the
	// handles now so a reconnect starts fresh, and let the slow closes happen
	// detached where blocking is harmless.
	connName := conn.GetName()
	client := conn.GetClient()
	listener := WithLockRtn(conn, func() net.Listener {
		return conn.DomainSockListener
	})
	controller := WithLockRtn(conn, func() *ssh.Session {
		return conn.ConnController
	})
	conn.WithLock(func() {
		conn.Client = nil
		conn.DomainSockListener = nil
		conn.DomainSockName = ""
		conn.ConnController = nil
	})
	if client == nil && listener == nil && controller == nil {
		return
	}
	go func() {
		defer func() {
			panichandler.PanicHandler("conncontroller:closeInternal", recover())
		}()
		activeSSHCleanupCount.Add(1)
		defer activeSSHCleanupCount.Add(-1)
		closeDetachedSSHHandles(connName, client, listener, controller)
	}()
}

func closeDetachedSSHHandles(connName string, client *ssh.Client, listener net.Listener, controller *ssh.Session) {
	if client != nil {
		closeClientOwnedSSHHandles(connName, clientChainCloser{client: client}, listener, controller)
		return
	}
	if listener != nil {
		closeWithLog(connName, "DomainSockListener.Close()", listener)
	}
	if controller != nil {
		closeWithLog(connName, "ConnController.Close()", controller)
	}
}

func closeClientOwnedSSHHandles(connName string, client io.Closer, _ io.Closer, _ io.Closer) {
	// ssh.Client owns its forwarded listeners and sessions. Once its mux is
	// closed, invoking protocol-level child Close methods can block forever in
	// older x/crypto versions and cannot provide any additional cleanup.
	closeWithLog(connName, "Client.Close()", client)
}

// closes the client together with any ProxyJump clients it was tunneled through
type clientChainCloser struct {
	client *ssh.Client
}

func (c clientChainCloser) Close() error {
	return remote.CloseClientChain(c.client)
}

func closeWithLog(connName string, label string, closer io.Closer) {
	startTime := time.Now()
	warningTimer := time.AfterFunc(sshCloseWarningTimeout, func() {
		log.Printf(
			"[conncontroller] conn:%s still waiting for %s after %s (active cleanups:%d)",
			connName,
			label,
			sshCloseWarningTimeout,
			activeSSHCleanupCount.Load(),
		)
	})
	err := closer.Close()
	warningTimer.Stop()
	duration := time.Since(startTime).Milliseconds()
	if err != nil {
		log.Printf("[conncontroller] conn:%s %s failed after %d ms: %v", connName, label, duration, err)
		return
	}
	if duration > 100 {
		log.Printf("[conncontroller] conn:%s %s took %d ms", connName, label, duration)
	}
}

func (conn *SSHConn) GetDomainSocketName() string {
	conn.lock.Lock()
	defer conn.lock.Unlock()
	return conn.DomainSockName
}

func (conn *SSHConn) GetStatus() string {
	conn.lock.Lock()
	defer conn.lock.Unlock()
	return conn.Status
}

func (conn *SSHConn) GetName() string {
	// no lock required because opts is immutable
	return conn.Opts.String()
}

func (conn *SSHConn) OpenDomainSocketListener(ctx context.Context) error {
	return conn.openDomainSocketListener(ctx, Status_Connecting)
}

func (conn *SSHConn) openDomainSocketListener(ctx context.Context, requiredStatus string) error {
	conn.Infof(ctx, "running OpenDomainSocketListener...\n")
	allowed := WithLockRtn(conn, func() bool {
		return conn.Status == requiredStatus
	})
	if !allowed {
		return fmt.Errorf("cannot open domain socket for %q when status is %q", conn.GetName(), conn.GetStatus())
	}
	client := conn.GetClient()
	if client == nil {
		return fmt.Errorf("cannot open domain socket for %q: ssh client is not connected", conn.GetName())
	}
	randStr, err := utilfn.RandomHexString(16) // 64-bits of randomness
	if err != nil {
		return fmt.Errorf("error generating random string: %w", err)
	}
	sockName := fmt.Sprintf("/tmp/genieterm-%s.sock", randStr)
	conn.Infof(ctx, "generated domain socket name %s\n", sockName)
	listener, err := client.ListenUnix(sockName)
	if err != nil {
		return fmt.Errorf("unable to request connection domain socket: %w (the server may have AllowStreamLocalForwarding disabled in sshd_config)", err)
	}
	conn.WithLock(func() {
		conn.DomainSockName = sockName
		conn.DomainSockListener = listener
	})
	conn.Infof(ctx, "successfully connected domain socket\n")
	go func() {
		defer func() {
			panichandler.PanicHandler("conncontroller:OpenDomainSocketListener", recover())
		}()
		defer clearDomainSocketIfCurrent(conn, listener)
		monitor := conn.GetMonitor()
		var updateCallback func()
		if monitor != nil {
			updateCallback = monitor.UpdateLastActivityTime
		}
		wshutil.RunWshRpcOverListener(listener, updateCallback)
	}()
	return nil
}

// only clears listener's own state; a reconnect may already have installed a newer listener
func clearDomainSocketIfCurrent(conn *SSHConn, listener net.Listener) {
	conn.lock.Lock()
	defer conn.lock.Unlock()
	if conn.DomainSockListener != listener {
		return
	}
	conn.DomainSockListener = nil
	conn.DomainSockName = ""
}

// splitHelperProtocol reads the "+p<N>" build suffix printed by `genie version --protocol`;
// helpers older than the flag print a bare version, which is protocol 0.
func splitHelperProtocol(version string) (string, int) {
	base, build, found := strings.Cut(version, "+")
	if !found || !strings.HasPrefix(build, "p") {
		return base, 0
	}
	protocol, err := strconv.Atoi(strings.TrimPrefix(build, "p"))
	if err != nil {
		return base, 0
	}
	return base, protocol
}

// expects the output of `wsh version` which looks like `wsh v0.10.4` or "not-installed [os] [arch]"
// returns (up-to-date, semver, osArchStr, error)
// if not up to date, or error, version might be ""
func IsWshVersionUpToDate(logCtx context.Context, wshVersionLine string) (bool, string, string, error) {
	wshVersionLine = strings.TrimSpace(wshVersionLine)
	if strings.HasPrefix(wshVersionLine, "not-installed") {
		return false, "not-installed", strings.TrimSpace(strings.TrimPrefix(wshVersionLine, "not-installed")), nil
	}
	parts := strings.Fields(wshVersionLine)
	if len(parts) != 2 {
		return false, "", "", fmt.Errorf("unexpected version format: %s", wshVersionLine)
	}
	helperName := parts[0]
	clientVersion, protocol := splitHelperProtocol(parts[1])
	expectedVersion := fmt.Sprintf("v%s", wavebase.WaveVersion)
	if helperName != "genie" {
		return false, clientVersion, "", nil
	}
	if protocol < wavebase.HelperProtocol {
		return false, clientVersion, "", nil
	}
	// Reinstall whenever the remote wsh version differs from ours, not just when it
	// is older: GenieTerm reset its version (0.x) below upstream Wave's last release
	// (0.14.x), so a leftover upstream wsh is numerically "newer" and a `< 0` check
	// would treat it as up-to-date and never replace it (losing newer wsh features).
	if semver.Compare(clientVersion, expectedVersion) != 0 {
		return false, clientVersion, "", nil
	}
	return true, clientVersion, "", nil
}

// for testing only -- trying to determine the env difference when attaching or not attaching a pty to an ssh session
func (conn *SSHConn) GetEnvironmentMaps(ctx context.Context) (map[string]string, map[string]string, error) {
	client := conn.GetClient()
	if client == nil {
		return nil, nil, fmt.Errorf("ssh client is not connected")
	}

	noPtyEnv, err := conn.getEnvironmentNoPty(ctx, client)
	if err != nil {
		return nil, nil, fmt.Errorf("error getting environment without PTY: %w", err)
	}

	ptyEnv, err := conn.getEnvironmentWithPty(ctx, client)
	if err != nil {
		return nil, nil, fmt.Errorf("error getting environment with PTY: %w", err)
	}

	return noPtyEnv, ptyEnv, nil
}

func runSessionWithContext(ctx context.Context, session *ssh.Session, cmd string) error {
	errCh := make(chan error, 1)

	go func() {
		errCh <- session.Run(cmd)
	}()

	select {
	case <-ctx.Done():
		session.Close()
		return ctx.Err()
	case err := <-errCh:
		return err
	}
}

func (conn *SSHConn) getEnvironmentNoPty(ctx context.Context, client *ssh.Client) (map[string]string, error) {
	session, err := client.NewSession()
	if err != nil {
		return nil, fmt.Errorf("unable to create ssh session: %w", err)
	}
	defer session.Close()

	outputBuf := &strings.Builder{}
	session.Stdout = outputBuf
	session.Stderr = outputBuf

	err = runSessionWithContext(ctx, session, "env -0")
	if err != nil {
		return nil, fmt.Errorf("error running env command: %w", err)
	}

	return envutil.EnvToMap(outputBuf.String()), nil
}

func (conn *SSHConn) getEnvironmentWithPty(ctx context.Context, client *ssh.Client) (map[string]string, error) {
	session, err := client.NewSession()
	if err != nil {
		return nil, fmt.Errorf("unable to create ssh session: %w", err)
	}
	defer session.Close()

	termSize := waveobj.TermSize{Rows: 24, Cols: 80}
	err = session.RequestPty("xterm-256color", termSize.Rows, termSize.Cols, nil)
	if err != nil {
		return nil, fmt.Errorf("unable to request PTY: %w", err)
	}

	outputBuf := &strings.Builder{}
	session.Stdout = outputBuf
	session.Stderr = outputBuf

	err = runSessionWithContext(ctx, session, "env -0")
	if err != nil {
		return nil, fmt.Errorf("error running env command: %w", err)
	}

	return envutil.EnvToMap(outputBuf.String()), nil
}

func (conn *SSHConn) getWshPath() string {
	config, ok := conn.getConnectionConfig()
	if ok && config.ConnWshPath != "" {
		return config.ConnWshPath
	}
	return wavebase.RemoteFullGenieBinPath
}

func (conn *SSHConn) getFallbackWshPath() string {
	config, ok := conn.getConnectionConfig()
	if ok && config.ConnWshPath != "" {
		return config.ConnWshPath
	}
	return wavebase.RemoteFullWshBinPath
}

func (conn *SSHConn) GetConfigShellPath() string {
	config, ok := conn.getConnectionConfig()
	if !ok {
		return ""
	}
	return config.ConnShellPath
}

// returns (needsInstall, clientVersion, osArchStr, error)
// if wsh is not installed, the clientVersion will be "not-installed", and it will also return an osArchStr
// if clientVersion is set, then no osArchStr will be returned
// if useRouterMode is true, will start connserver with --router-domainsocket flag
func (conn *SSHConn) StartConnServer(ctx context.Context, afterUpdate bool, useRouterMode bool) (bool, string, string, error) {
	conn.Infof(ctx, "running StartConnServer (routerMode=%v)...\n", useRouterMode)
	// Status_Connected is allowed so a background wsh install can upgrade an
	// already-connected (no-wsh) connection in place once the slow copy finishes.
	allowed := WithLockRtn(conn, func() bool {
		return conn.Status == Status_Connecting || conn.Status == Status_Connected
	})
	if !allowed {
		return false, "", "", fmt.Errorf("cannot start conn server for %q when status is %q", conn.GetName(), conn.GetStatus())
	}
	client := conn.GetClient()
	if client == nil {
		return false, "", "", fmt.Errorf("cannot start conn server for %q: ssh client is not connected", conn.GetName())
	}
	wshPath := conn.getWshPath()
	fallbackWshPath := conn.getFallbackWshPath()
	sockName := conn.GetDomainSocketName()
	var rpcCtx wshrpc.RpcContext
	if useRouterMode {
		rpcCtx = wshrpc.RpcContext{
			IsRouter: true,
			SockName: sockName,
			Conn:     conn.GetName(),
		}
	} else {
		rpcCtx = wshrpc.RpcContext{
			RouteId:  wshutil.MakeConnectionRouteId(conn.GetName()),
			SockName: sockName,
			Conn:     conn.GetName(),
		}
	}
	jwtToken, err := wshutil.MakeClientJWTToken(rpcCtx)
	if err != nil {
		return false, "", "", fmt.Errorf("unable to create jwt token for conn controller: %w", err)
	}
	conn.Infof(ctx, "SSH-NEWSESSION (StartConnServer)\n")
	sshSession, err := client.NewSession()
	if err != nil {
		return false, "", "", fmt.Errorf("unable to create ssh session for conn controller: %w", err)
	}
	pipeRead, pipeWrite := io.Pipe()
	sshSession.Stdout = pipeWrite
	sshSession.Stderr = pipeWrite
	stdinPipe, err := sshSession.StdinPipe()
	if err != nil {
		return false, "", "", fmt.Errorf("unable to get stdin pipe: %w", err)
	}
	devFlag := ""
	if wavebase.IsDevMode() {
		devFlag = "--dev"
	}
	routerFlag := ""
	if useRouterMode {
		routerFlag = "--router-domainsocket"
	}
	cmdStr := MakeConnServerCommand(wshPath, fallbackWshPath, conn.GetName(), devFlag, routerFlag)
	log.Printf("starting conn controller: %q\n", cmdStr)
	shWrappedCmdStr := fmt.Sprintf("sh -c %s", shellutil.HardQuote(cmdStr))
	blocklogger.Debugf(ctx, "[conndebug] wrapped command:\n%s\n", shWrappedCmdStr)
	err = sshSession.Start(shWrappedCmdStr)
	if err != nil {
		return false, "", "", fmt.Errorf("unable to start conn controller command: %w", err)
	}
	linesChan := utilfn.StreamToLinesChan(pipeRead)
	versionLine, err := utilfn.ReadLineWithTimeout(linesChan, utilfn.TimeoutFromContext(ctx, 30*time.Second))
	if err != nil {
		sshSession.Close()
		return false, "", "", fmt.Errorf("error reading wsh version: %w", err)
	}
	conn.Infof(ctx, "actual connnserverversion: %q\n", versionLine)
	conn.Infof(ctx, "got connserver version: %s\n", strings.TrimSpace(versionLine))
	isUpToDate, clientVersion, osArchStr, err := IsWshVersionUpToDate(ctx, versionLine)
	if err != nil {
		sshSession.Close()
		return false, "", "", fmt.Errorf("error checking wsh version: %w", err)
	}
	if isUpToDate && !afterUpdate && os.Getenv(wavebase.WaveWshForceUpdateVarName) != "" {
		isUpToDate = false
		conn.Infof(ctx, "%s set, forcing wsh update\n", wavebase.WaveWshForceUpdateVarName)
	}
	conn.Infof(ctx, "connserver up-to-date: %v\n", isUpToDate)
	if !isUpToDate {
		sshSession.Close()
		return true, clientVersion, osArchStr, nil
	}
	jwtLine, err := utilfn.ReadLineWithTimeout(linesChan, 3*time.Second)
	if err != nil {
		sshSession.Close()
		return false, clientVersion, "", fmt.Errorf("error reading jwt status line: %w", err)
	}
	conn.Infof(ctx, "got jwt status line: %s\n", jwtLine)
	if strings.TrimSpace(jwtLine) == wavebase.NeedJwtConst {
		// write the jwt
		conn.Infof(ctx, "writing jwt token to connserver\n")
		_, err = fmt.Fprintf(stdinPipe, "%s\n", jwtToken)
		if err != nil {
			sshSession.Close()
			return false, clientVersion, "", fmt.Errorf("failed to write JWT token: %w", err)
		}
	}
	conn.WithLock(func() {
		conn.ConnController = sshSession
	})
	// service the I/O
	go func() {
		defer func() {
			panichandler.PanicHandler("conncontroller:sshSession.Wait", recover())
		}()
		// wait for termination, clear the controller
		waitErr := sshSession.Wait()
		log.Printf("conn controller (%q) terminated: %v", conn.GetName(), waitErr)
		if conn.clearConnController(sshSession, waitErr) {
			// durable jobs depend on the connserver route; let listeners (jobcontroller,
			// UI) see wshenabled flip to false
			conn.FireConnChangeEvent()
		}
	}()
	go func() {
		defer func() {
			panichandler.PanicHandler("conncontroller:sshSession-output", recover())
		}()
		for output := range linesChan {
			if output.Error != nil {
				log.Printf("[conncontroller:%s:output] error: %v\n", conn.GetName(), output.Error)
				continue
			}
			monitor := conn.GetMonitor()
			if monitor != nil {
				monitor.UpdateLastActivityTime()
			}
			line := output.Line
			if !strings.HasSuffix(line, "\n") {
				line += "\n"
			}
			log.Printf("[conncontroller:%s:output] %s", conn.GetName(), line)
		}
	}()
	conn.Infof(ctx, "connserver started, waiting for route to be registered\n")
	regCtx, cancelFn := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelFn()
	connRoute := wshutil.MakeConnectionRouteId(rpcCtx.Conn)
	err = wshutil.DefaultRouter.WaitForRegister(regCtx, connRoute)
	if err != nil {
		return false, clientVersion, "", fmt.Errorf("timeout waiting for connserver to register")
	}
	time.Sleep(300 * time.Millisecond) // TODO remove this sleep (but we need to wait until connserver is "ready")
	err = wshclient.ConnServerInitCommand(
		wshclient.GetBareRpcClient(),
		wshrpc.CommandConnServerInitData{ClientId: wstore.GetClientId()},
		&wshrpc.RpcOpts{Route: connRoute},
	)
	if err != nil {
		return false, clientVersion, "", fmt.Errorf("connserver init failed: %w", err)
	}
	conn.Infof(ctx, "connserver is registered and ready\n")
	return false, clientVersion, "", nil
}

// returns true if session was the current controller (and wsh was marked disabled)
func (conn *SSHConn) clearConnController(session *ssh.Session, waitErr error) bool {
	conn.lock.Lock()
	defer conn.lock.Unlock()
	if conn.ConnController != session {
		return false
	}
	conn.ConnController = nil
	conn.WshEnabled.Store(false)
	conn.NoWshReason = "connserver terminated"
	if waitErr != nil {
		conn.WshError = fmt.Sprintf("connserver terminated unexpectedly with error: %v", waitErr)
	}
	return true
}

type WshInstallOpts struct {
	Force        bool
	NoUserPrompt bool
}

var queryTextTemplate = strings.TrimSpace(`
Wave requires Wave Shell Extensions to be
installed on %q
to ensure a seamless experience.

Would you like to install them?
`)

func (conn *SSHConn) UpdateWsh(ctx context.Context, clientDisplayName string, remoteInfo *wshrpc.RemoteInfo) error {
	conn.Infof(ctx, "attempting to update wsh for connection %s (os:%s arch:%s version:%s)\n",
		conn.GetName(), remoteInfo.ClientOs, remoteInfo.ClientArch, remoteInfo.ClientVersion)
	client := conn.GetClient()
	if client == nil {
		return fmt.Errorf("cannot update wsh: ssh client is not connected")
	}
	defer conn.clearInstallProgress()
	err := remote.CpWshToRemote(ctx, client, remoteInfo.ClientOs, remoteInfo.ClientArch, conn.getWshPath(), conn.noteInstallProgress)
	if err != nil {
		return fmt.Errorf("error installing wsh to remote: %w", err)
	}
	conn.Infof(ctx, "successfully updated wsh on %s\n", conn.GetName())
	return nil

}

// returns (allowed, error)
func (conn *SSHConn) getPermissionToInstallWsh(ctx context.Context, clientDisplayName string) (bool, error) {
	conn.Infof(ctx, "running getPermissionToInstallWsh...\n")
	queryText := fmt.Sprintf(queryTextTemplate, clientDisplayName)
	title := "Install Wave Shell Extensions"
	request := &userinput.UserInputRequest{
		ResponseType: "confirm",
		QueryText:    queryText,
		Title:        title,
		Markdown:     true,
		CheckBoxMsg:  "Automatically install for all connections",
		OkLabel:      "Install wsh",
		CancelLabel:  "No wsh",
	}
	conn.Infof(ctx, "requesting user confirmation...\n")
	response, err := userinput.GetUserInput(ctx, request)
	if err != nil {
		conn.Infof(ctx, "error getting user input: %v\n", err)
		return false, err
	}
	conn.Infof(ctx, "user response to allowing wsh: %v\n", response.Confirm)
	meta := make(map[string]any)
	meta["conn:wshenabled"] = response.Confirm
	conn.Infof(ctx, "writing conn:wshenabled=%v to connections.json\n", response.Confirm)
	err = wconfig.SetConnectionsConfigValue(conn.GetName(), meta)
	if err != nil {
		log.Printf("warning: error writing to connections file: %v", err)
	}
	if !response.Confirm {
		return false, nil
	}
	if response.CheckboxStat {
		conn.Infof(ctx, "writing conn:askbeforewshinstall=false to settings.json\n")
		meta := waveobj.MetaMapType{
			wconfig.ConfigKey_ConnAskBeforeWshInstall: false,
		}
		setConfigErr := wconfig.SetBaseConfigValue(meta)
		if setConfigErr != nil {
			// this is not a critical error, just log and continue
			log.Printf("warning: error writing to base config file: %v", err)
		}
	}
	return true, nil
}

// noteInstallProgress keeps the health monitor from reading a busy upload as a stalled link and
// publishes the install percentage for the UI.
func (conn *SSHConn) noteInstallProgress(sent int64, total int64) {
	if monitor := conn.GetMonitor(); monitor != nil {
		monitor.NotifyTransferProgress()
	}
	if total <= 0 {
		return
	}
	pct := int(min(max(sent*100/total, 1), 100))
	changed := WithLockRtn(conn, func() bool {
		if conn.WshInstallPct == pct {
			return false
		}
		conn.WshInstallPct = pct
		return true
	})
	if changed {
		conn.FireConnChangeEvent()
	}
}

func (conn *SSHConn) clearInstallProgress() {
	changed := WithLockRtn(conn, func() bool {
		if conn.WshInstallPct == 0 {
			return false
		}
		conn.WshInstallPct = 0
		return true
	})
	if changed {
		conn.FireConnChangeEvent()
	}
}

func (conn *SSHConn) InstallWsh(ctx context.Context, osArchStr string) error {
	conn.Infof(ctx, "running installWsh...\n")
	client := conn.GetClient()
	if client == nil {
		conn.Infof(ctx, "ERROR ssh client is not connected, cannot install\n")
		return fmt.Errorf("ssh client is not connected, cannot install")
	}
	var clientOs, clientArch string
	var err error
	if osArchStr != "" {
		clientOs, clientArch, err = remote.GetClientPlatformFromOsArchStr(ctx, osArchStr)
	} else {
		clientOs, clientArch, err = remote.GetClientPlatform(ctx, genconn.MakeSSHShellClient(client))
	}
	if err != nil {
		conn.Infof(ctx, "ERROR detecting client platform: %v\n", err)
		return fmt.Errorf("error detecting client platform: %w", err)
	}
	conn.Infof(ctx, "detected remote platform os:%s arch:%s\n", clientOs, clientArch)
	defer conn.clearInstallProgress()
	err = remote.CpWshToRemote(ctx, client, clientOs, clientArch, conn.getWshPath(), conn.noteInstallProgress)
	if err != nil {
		conn.Infof(ctx, "ERROR copying wsh binary to remote: %v\n", err)
		return fmt.Errorf("error copying wsh binary to remote: %w", err)
	}
	conn.Infof(ctx, "successfully installed wsh\n")
	return nil
}

// UpgradeWsh installs the current helper and, when the connection is up, starts a new connserver
// on the same SSH client (as the background install does), so the new RPCs work without
// dropping the connection or the shells on it.
func (conn *SSHConn) UpgradeWsh(ctx context.Context) error {
	if err := conn.InstallWsh(ctx, ""); err != nil {
		return err
	}
	live := WithLockRtn(conn, func() bool {
		return conn.Status == Status_Connected && conn.Client != nil
	})
	if !live {
		return nil
	}
	// A connection that came up without the helper (install declined or turned off) never opened
	// the domain socket the helper reports back on.
	if conn.GetDomainSocketName() == "" {
		if err := conn.openDomainSocketListener(ctx, Status_Connected); err != nil {
			return err
		}
	}
	needsInstall, clientVersion, _, err := conn.StartConnServer(ctx, true, true)
	if err != nil {
		return fmt.Errorf("restarting the genie helper: %w", err)
	}
	if needsInstall {
		return fmt.Errorf("the genie helper on %s is still out of date after updating", conn.GetName())
	}
	conn.persistWshInstalled(ctx, WshCheckResult{WshEnabled: true, ClientVersion: clientVersion})
	conn.FireConnChangeEvent()
	return nil
}

func (conn *SSHConn) GetClient() *ssh.Client {
	conn.lock.Lock()
	defer conn.lock.Unlock()
	return conn.Client
}

func (conn *SSHConn) GetMonitor() *ConnMonitor {
	conn.lock.Lock()
	defer conn.lock.Unlock()
	return conn.Monitor
}

func (conn *SSHConn) WaitForConnect(ctx context.Context) error {
	for {
		status := conn.DeriveConnStatus()
		if status.Status == Status_Connected {
			return nil
		}
		if status.Status == Status_Connecting {
			select {
			case <-ctx.Done():
				return fmt.Errorf("context timeout")
			case <-time.After(100 * time.Millisecond):
				continue
			}
		}
		if status.Status == Status_Init || status.Status == Status_Disconnected {
			return fmt.Errorf("disconnected")
		}
		if status.Status == Status_Error {
			return fmt.Errorf("error: %v", status.Error)
		}
		return fmt.Errorf("unknown status: %q", status.Status)
	}
}

// does not return an error since that error is stored inside of SSHConn
func (conn *SSHConn) Connect(ctx context.Context, connFlags *wconfig.ConnKeywords) error {
	conn.lifecycleLock.Lock()
	defer conn.lifecycleLock.Unlock()

	blocklogger.Infof(ctx, "\n")
	var connectAllowed bool
	conn.WithLock(func() {
		if conn.Status == Status_Connecting || conn.Status == Status_Connected {
			connectAllowed = false
		} else {
			conn.Status = Status_Connecting
			conn.Error = ""
			connectAllowed = true
		}
	})
	if !connectAllowed {
		conn.Infof(ctx, "cannot connect to %q when status is %q\n", conn.GetName(), conn.GetStatus())
		return fmt.Errorf("cannot connect to %q when status is %q", conn.GetName(), conn.GetStatus())
	}
	conn.Infof(ctx, "trying to connect to %q...\n", conn.GetName())
	conn.FireConnChangeEvent()
	// abortCtx is cancelled by Close() (user disconnect); connCtx additionally carries the
	// caller's deadline. Close() must not wait behind lifecycleLock for a hung handshake.
	abortCtx, abortFn := context.WithCancel(context.Background())
	defer abortFn()
	conn.setConnectAbort(abortFn)
	defer conn.setConnectAbort(nil)
	connCtx, connCancel := context.WithCancel(ctx)
	defer connCancel()
	stopAbortWatch := context.AfterFunc(abortCtx, connCancel)
	defer stopAbortWatch()
	err := conn.connectInternal(connCtx, abortCtx, connFlags)
	if err == nil && abortCtx.Err() != nil {
		err = fmt.Errorf("connection attempt to %q was cancelled", conn.GetName())
	}
	if err != nil {
		errorCode, subCode := remote.ClassifyConnError(err)
		isContextError := errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
		conn.Infof(ctx, "ERROR [%s] %v\n\n", errorCode, err)
		aborted := abortCtx.Err() != nil
		conn.WithLock(func() {
			if aborted {
				conn.Status = Status_Disconnected
				return
			}
			conn.Status = Status_Error
			conn.Error = err.Error()
		})
		conn.closeInternal_withlifecyclelock()
		telemetry.GoUpdateActivityWrap(wshrpc.ActivityUpdate{
			Conn: map[string]int{"ssh:connecterror": 1},
		}, "ssh-connconnect")
		telemetry.GoRecordTEventWrap(&telemetrydata.TEvent{
			Event: "conn:connecterror",
			Props: telemetrydata.TEventProps{
				ConnType:         "ssh",
				ConnErrorCode:    errorCode,
				ConnSubErrorCode: subCode,
				ConnContextError: isContextError,
			},
		})
	} else {
		conn.Infof(ctx, "successfully connected (wsh:%v)\n\n", conn.WshEnabled.Load())
		conn.WithLock(func() {
			conn.Status = Status_Connected
			conn.LastConnectTime = time.Now().UnixMilli()
			if conn.ActiveConnNum == 0 {
				conn.ActiveConnNum = int(activeConnCounter.Add(1))
			}
		})
		telemetry.GoUpdateActivityWrap(wshrpc.ActivityUpdate{
			Conn: map[string]int{"ssh:connect": 1},
		}, "ssh-connconnect")
		telemetry.GoRecordTEventWrap(&telemetrydata.TEvent{
			Event: "conn:connect",
			Props: telemetrydata.TEventProps{
				ConnType: "ssh",
			},
		})
	}
	conn.FireConnChangeEvent()
	if err != nil {
		return err
	}

	// logic for saving connection and potential flags (we only save once a connection has been made successfully)
	// at the moment, identity files is the only saved flag
	var existingIdentityFiles []string
	existingConnection, ok := conn.getConnectionConfig()
	if ok {
		existingIdentityFiles = existingConnection.SshIdentityFile
	}

	meta := make(map[string]any)
	if connFlags != nil && connFlags.SshIdentityFile != nil {
		meta["ssh:identityfile"] = mergeIdentityFiles(existingIdentityFiles, connFlags.SshIdentityFile)
	}
	err = wconfig.SetConnectionsConfigValue(conn.GetName(), meta)
	if err != nil {
		// i do not consider this a critical failure
		log.Printf("config write error: unable to save connection %s: %v", conn.GetName(), err)
	}
	return nil
}

// appends the new identity files that aren't already present, preserving order
func mergeIdentityFiles(existing []string, added []string) []string {
	merged := append([]string{}, existing...)
	for _, identityFile := range added {
		if utilfn.ContainsStr(merged, identityFile) {
			continue
		}
		merged = append(merged, identityFile)
	}
	return merged
}

func (conn *SSHConn) WithLock(fn func()) {
	conn.lock.Lock()
	defer conn.lock.Unlock()
	fn()
}

func WithLockRtn[T any](conn *SSHConn, fn func() T) T {
	conn.lock.Lock()
	defer conn.lock.Unlock()
	return fn()
}

// returns (enable-wsh, ask-before-install)
func (conn *SSHConn) getConnWshSettings() (bool, bool) {
	config := wconfig.GetWatcher().GetFullConfig()
	enableWsh := config.Settings.ConnWshEnabled
	askBeforeInstall := wconfig.DefaultBoolPtr(config.Settings.ConnAskBeforeWshInstall, true)
	connSettings, ok := conn.getConnectionConfig()
	if ok {
		if connSettings.ConnWshEnabled != nil {
			enableWsh = *connSettings.ConnWshEnabled
		}
		// if the connection object exists, and conn:askbeforewshinstall is not set, the user must have allowed it
		// TODO: in v0.12+ this should be removed.  we'll explicitly write a "false" into the connection object on successful connection
		if connSettings.ConnAskBeforeWshInstall == nil {
			askBeforeInstall = false
		} else {
			askBeforeInstall = *connSettings.ConnAskBeforeWshInstall
		}
	}
	return enableWsh, askBeforeInstall
}

type WshCheckResult struct {
	WshEnabled    bool
	ClientVersion string
	NoWshReason   string
	NoWshCode     string
	WshError      error
}

// returns (wsh-enabled, clientVersion, text-reason, wshError)
func (conn *SSHConn) tryEnableWsh(ctx context.Context, clientDisplayName string) WshCheckResult {
	conn.Infof(ctx, "running tryEnableWsh...\n")
	enableWsh, askBeforeInstall := conn.getConnWshSettings()
	conn.Infof(ctx, "wsh settings enable:%v ask:%v\n", enableWsh, askBeforeInstall)
	if !enableWsh {
		return WshCheckResult{NoWshReason: "conn:wshenabled set to false", NoWshCode: NoWshCode_Disabled}
	}
	if askBeforeInstall && remote.IsNoUserInputContext(ctx) {
		return WshCheckResult{NoWshReason: "wsh install needs confirmation; skipped during automatic reconnect", NoWshCode: NoWshCode_PermissionError}
	}
	if askBeforeInstall {
		allowInstall, err := conn.getPermissionToInstallWsh(ctx, clientDisplayName)
		if err != nil {
			log.Printf("error getting permission to install wsh: %v\n", err)
			return WshCheckResult{NoWshReason: "error getting user permission to install", NoWshCode: NoWshCode_PermissionError, WshError: err}
		}
		if !allowInstall {
			return WshCheckResult{NoWshReason: "user selected not to install wsh extensions", NoWshCode: NoWshCode_UserDeclined}
		}
	}
	err := conn.OpenDomainSocketListener(ctx)
	if err != nil {
		conn.Infof(ctx, "ERROR opening domain socket listener: %v\n", err)
		err = fmt.Errorf("error opening domain socket listener: %w", err)
		return WshCheckResult{NoWshReason: "error opening domain socket", NoWshCode: NoWshCode_DomainSocketError, WshError: err}
	}
	needsInstall, clientVersion, osArchStr, err := conn.StartConnServer(ctx, false, true)
	if err != nil {
		conn.Infof(ctx, "ERROR starting conn server: %v\n", err)
		err = fmt.Errorf("error starting conn server: %w", err)
		return WshCheckResult{NoWshReason: "error starting connserver", NoWshCode: NoWshCode_ConnServerStartError, WshError: err}
	}
	if needsInstall {
		conn.Infof(ctx, "connserver needs to be (re)installed\n")
		// Try inline first so fast/moderate links get wsh (and the command-block
		// gutter) immediately. Bound it so a slow link can't block the terminal; on
		// failure fall back to a background install and connect in no-wsh mode now —
		// the connection upgrades in place once the slow copy finishes, and new
		// shells started after that pick up shell integration.
		installCtx, installCancel := context.WithTimeout(context.WithoutCancel(ctx), 60*time.Second)
		err = conn.InstallWsh(installCtx, osArchStr)
		installCancel()
		if err != nil {
			conn.Infof(ctx, "inline wsh install did not finish (%v); continuing without wsh, installing in background\n", err)
			conn.startBackgroundWshInstall(osArchStr)
			return WshCheckResult{NoWshReason: "installing wsh in background", NoWshCode: NoWshCode_InstallingBackground}
		}
		// the install may have consumed most of the caller's (RPC) deadline; give the
		// post-install start its own budget
		startCtx, startCancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		needsInstall, clientVersion, _, err = conn.StartConnServer(startCtx, true, true)
		startCancel()
		if err != nil {
			conn.Infof(ctx, "ERROR starting conn server (after install): %v\n", err)
			err = fmt.Errorf("error starting conn server (after install): %w", err)
			return WshCheckResult{NoWshReason: "error starting connserver", NoWshCode: NoWshCode_PostInstallStartError, WshError: err}
		}
		if needsInstall {
			conn.Infof(ctx, "conn server not installed correctly (after install)\n")
			err = fmt.Errorf("conn server not installed correctly (after install)")
			return WshCheckResult{NoWshReason: "connserver not installed properly", NoWshCode: NoWshCode_InstallVerifyError, WshError: err}
		}
		return WshCheckResult{WshEnabled: true, ClientVersion: clientVersion}
	} else {
		return WshCheckResult{WshEnabled: true, ClientVersion: clientVersion}
	}
}

// startBackgroundWshInstall copies the helper binary and upgrades an
// already-connected (no-wsh) connection to wsh in place once the (potentially
// very slow) copy finishes. The terminal is usable in no-wsh mode meanwhile;
// shells started after the upgrade pick up shell integration. Safe on a slow
// link: cancelled on disconnect, deduped, and a no-op on failure.
func (conn *SSHConn) startBackgroundWshInstall(osArchStr string) {
	if !conn.wshInstalling.CompareAndSwap(false, true) {
		return
	}
	// Detached from the connect RPC context; bounded generously for slow links and
	// cancelled by closeInternal on disconnect.
	bgCtx, bgCancel := context.WithTimeout(context.Background(), 20*time.Minute)
	conn.WithLock(func() { conn.installCancel = bgCancel })
	go func() {
		defer func() {
			panichandler.PanicHandler("startBackgroundWshInstall", recover())
		}()
		defer conn.wshInstalling.Store(false)
		// Self-cancel this attempt's context on return. We intentionally do NOT clear
		// conn.installCancel here — a later reconnect may have overwritten it with its
		// own handle, and calling an already-finished attempt's cancel is a harmless
		// no-op. closeInternal cancels whatever the latest handle is.
		defer bgCancel()
		conn.Infof(bgCtx, "background wsh install starting (terminal stays usable in no-wsh mode)...\n")
		if err := conn.InstallWsh(bgCtx, osArchStr); err != nil {
			conn.Infof(bgCtx, "background wsh install failed: %v\n", err)
			return
		}
		// Bail if the connection was torn down (or replaced) while we were copying.
		live := WithLockRtn(conn, func() bool {
			return conn.Status == Status_Connected && conn.Client != nil
		})
		if !live || bgCtx.Err() != nil {
			conn.Infof(bgCtx, "background wsh install: connection no longer live, skipping upgrade\n")
			return
		}
		needsInstall, clientVersion, _, err := conn.StartConnServer(bgCtx, true, true)
		if err != nil || needsInstall {
			conn.Infof(bgCtx, "background wsh upgrade failed (err=%v needsInstall=%v)\n", err, needsInstall)
			return
		}
		conn.persistWshInstalled(bgCtx, WshCheckResult{WshEnabled: true, ClientVersion: clientVersion})
		conn.FireConnChangeEvent()
		conn.Infof(bgCtx, "background wsh install complete — new shells on this connection get command blocks\n")
	}()
}

func (conn *SSHConn) getConnectionConfig() (wconfig.ConnKeywords, bool) {
	config := wconfig.GetWatcher().GetFullConfig()
	connSettings, ok := config.Connections[conn.GetName()]
	if !ok {
		return wconfig.ConnKeywords{}, false
	}
	return connSettings, true
}

func (conn *SSHConn) persistWshInstalled(ctx context.Context, result WshCheckResult) {
	conn.WshEnabled.Store(result.WshEnabled)
	conn.SetWshError(result.WshError)
	conn.WithLock(func() {
		conn.NoWshReason = result.NoWshReason
		conn.WshVersion = result.ClientVersion
	})
	connConfig, ok := conn.getConnectionConfig()
	if ok && connConfig.ConnWshEnabled != nil {
		return
	}
	if !result.WshEnabled {
		// Don't persist a transient install failure (e.g. a slow-link copy timeout)
		// as a permanent conn:wshenabled=false — that would stop wsh from ever
		// retrying. Leave it unset so the next connect force-retries the install.
		return
	}
	meta := make(map[string]any)
	meta["conn:wshenabled"] = result.WshEnabled
	err := wconfig.SetConnectionsConfigValue(conn.GetName(), meta)
	if err != nil {
		conn.Infof(ctx, "WARN could not write conn:wshenabled=%v to connections.json: %v\n", result.WshEnabled, err)
		log.Printf("warning: error writing to connections file: %v", err)
	}
	// doesn't return an error since none of this is required for connection to work
}

// returns (connect-error)
func (conn *SSHConn) connectInternal(ctx context.Context, abortCtx context.Context, connFlags *wconfig.ConnKeywords) error {
	conn.Infof(ctx, "connectInternal %s\n", conn.GetName())
	client, _, err := remote.ConnectToClient(ctx, conn.Opts, nil, 0, connFlags)
	if err != nil {
		conn.Infof(ctx, "ERROR ConnectToClient: %s\n", remote.SimpleMessageFromPossibleConnectionError(err))
		log.Printf("error: failed to connect to client %s: %s\n", conn.GetName(), err)
		return err
	}
	// a user disconnect during the post-handshake setup (wsh install, connserver start)
	// closes the client so every pending remote operation fails fast and releases
	// lifecycleLock
	stopCloseOnAbort := context.AfterFunc(abortCtx, func() {
		remote.CloseClientChain(client)
	})
	defer stopCloseOnAbort()
	conn.WithLock(func() {
		if conn.Monitor != nil {
			conn.Monitor.Close()
			conn.Monitor = nil
		}
		conn.Client = client
		conn.ConnHealthStatus = ConnHealthStatus_Good
		conn.Monitor = MakeConnMonitor(conn, client)
	})
	go func() {
		defer func() {
			panichandler.PanicHandler("conncontroller:waitForDisconnect", recover())
		}()
		conn.waitForDisconnect(client)
	}()
	fmtAddr := knownhosts.Normalize(fmt.Sprintf("%s@%s", client.User(), client.RemoteAddr().String()))
	conn.Infof(ctx, "normalized knownhosts address: %s\n", fmtAddr)
	clientDisplayName := fmt.Sprintf("%s (%s)", conn.GetName(), fmtAddr)
	wshResult := conn.tryEnableWsh(ctx, clientDisplayName)
	if !wshResult.WshEnabled {
		if wshResult.WshError != nil {
			conn.Infof(ctx, "ERROR enabling wsh: %v\n", wshResult.WshError)
			conn.Infof(ctx, "will connect with wsh disabled\n")
		} else {
			conn.Infof(ctx, "wsh not enabled: %s\n", wshResult.NoWshReason)
		}
		telemetry.GoRecordTEventWrap(&telemetrydata.TEvent{
			Event: "conn:nowsh",
			Props: telemetrydata.TEventProps{
				ConnType:         "ssh",
				ConnWshErrorCode: wshResult.NoWshCode,
			},
		})
	}
	conn.persistWshInstalled(ctx, wshResult)
	return nil
}

// waitForDisconnect only tears down state that still belongs to client: by the time Wait()
// returns, a user Close() or a newer Connect may already own the connection.
func (conn *SSHConn) waitForDisconnect(client *ssh.Client) {
	if client == nil {
		return
	}
	err := client.Wait()
	if err != nil {
		log.Printf("[conn:%s] client.Wait() returned error: %v", conn.GetName(), err)
	} else {
		log.Printf("[conn:%s] client.Wait() completed (clean disconnect)", conn.GetName())
	}
	if !conn.handleClientDisconnect(client, err) {
		log.Printf("[conn:%s] client.Wait() returned for a superseded client, ignoring", conn.GetName())
		return
	}
	conn.FireConnChangeEvent()
	conn.maybeStartAutoReconnect("connection lost")
}

// returns false if client is no longer the connection's current client
func (conn *SSHConn) handleClientDisconnect(client *ssh.Client, waitErr error) bool {
	conn.lifecycleLock.Lock()
	defer conn.lifecycleLock.Unlock()
	isCurrent := WithLockRtn(conn, func() bool {
		if conn.Client != client {
			return false
		}
		// disconnects happen for a variety of reasons (like network, etc. and are typically transient)
		// so we just set the status to "disconnected" here (not error)
		// don't overwrite any existing error (or error status)
		if waitErr != nil && conn.Error == "" {
			conn.Error = waitErr.Error()
		}
		if conn.Status != Status_Error {
			conn.Status = Status_Disconnected
		}
		return true
	})
	if !isCurrent {
		return false
	}
	conn.closeInternal_withlifecyclelock()
	return true
}

func (conn *SSHConn) SetWshError(err error) {
	conn.WithLock(func() {
		if err == nil {
			conn.WshError = ""
		} else {
			conn.WshError = err.Error()
		}
	})
}

func (conn *SSHConn) ClearWshError() {
	conn.WithLock(func() {
		conn.WshError = ""
	})
}

func (conn *SSHConn) SetConnHealthStatus(client *ssh.Client, status string) {
	changed := false
	conn.WithLock(func() {
		if conn.Client != client {
			return
		}
		if conn.ConnHealthStatus != status {
			conn.ConnHealthStatus = status
			changed = true
		}
	})
	if changed {
		conn.FireConnChangeEvent()
	}
}

func (conn *SSHConn) GetConnHealthStatus() string {
	var status string
	conn.WithLock(func() {
		status = conn.ConnHealthStatus
	})
	return status
}

func getConnInternal(opts *remote.SSHOpts, createIfNotExists bool) *SSHConn {
	globalLock.Lock()
	defer globalLock.Unlock()
	rtn := clientControllerMap[*opts]
	if rtn == nil && createIfNotExists {
		rtn = &SSHConn{
			lock:             &sync.Mutex{},
			lifecycleLock:    &sync.Mutex{},
			Status:           Status_Init,
			ConnHealthStatus: ConnHealthStatus_Good,
			WshEnabled:       &atomic.Bool{},
			Opts:             opts,
		}
		clientControllerMap[*opts] = rtn
	}
	return rtn
}

// does NOT connect, does not return nil
func GetConn(opts *remote.SSHOpts) *SSHConn {
	conn := getConnInternal(opts, true)
	return conn
}

// does NOT connect, can return nil
func MaybeGetConn(opts *remote.SSHOpts) *SSHConn {
	conn := getConnInternal(opts, false)
	return conn
}

func IsConnected(connName string) (bool, error) {
	if IsLocalConnName(connName) {
		return true, nil
	}
	connOpts, err := remote.ParseOpts(connName)
	if err != nil {
		return false, fmt.Errorf("error parsing connection name: %w", err)
	}
	conn := getConnInternal(connOpts, false)
	if conn == nil {
		return false, nil
	}
	return conn.GetStatus() == Status_Connected, nil
}

// Convenience function for ensuring a connection is established
func EnsureConnection(ctx context.Context, connName string) error {
	if IsLocalConnName(connName) {
		return nil
	}
	connOpts, err := remote.ParseOpts(connName)
	if err != nil {
		return fmt.Errorf("error parsing connection name: %w", err)
	}
	conn := GetConn(connOpts)
	if conn == nil {
		return fmt.Errorf("connection not found: %s", connName)
	}
	connStatus := conn.DeriveConnStatus()
	switch connStatus.Status {
	case Status_Connected:
		return nil
	case Status_Connecting:
		return conn.WaitForConnect(ctx)
	case Status_Init, Status_Disconnected:
		return conn.Connect(ctx, &wconfig.ConnKeywords{})
	case Status_Error:
		return fmt.Errorf("connection error: %s", connStatus.Error)
	default:
		return fmt.Errorf("unknown connection status %q", connStatus.Status)
	}
}

func DisconnectClient(opts *remote.SSHOpts) error {
	conn := getConnInternal(opts, false)
	if conn == nil {
		return fmt.Errorf("client %q not found", opts.String())
	}
	err := conn.Close()
	return err
}

func resolveSshConfigPatterns(configFiles []string) ([]string, error) {
	// using two separate containers to track order and have O(1) lookups
	// since go does not have an ordered map primitive
	var discoveredPatterns []string
	alreadyUsed := make(map[string]bool)
	alreadyUsed[""] = true // this excludes the empty string from potential alias

	var errs []error
	for _, configFile := range configFiles {
		fd, openErr := os.Open(configFile)
		if fd == nil {
			errs = append(errs, openErr)
			continue
		}

		cfg, decodeErr := ssh_config.Decode(fd, true)
		fd.Close()
		if decodeErr != nil {
			errs = append(errs, fmt.Errorf("could not parse %s: %w", configFile, decodeErr))
			continue
		}
		for _, host := range cfg.Hosts {
			// for each host, find the first good alias
			for _, hostPattern := range host.Patterns {
				hostPatternStr := hostPattern.String()
				if hostPatternStr == "" || strings.Contains(hostPatternStr, "*") || strings.Contains(hostPatternStr, "?") || strings.Contains(hostPatternStr, "!") {
					continue
				}
				normalized := remote.NormalizeConfigPattern(hostPatternStr)
				if !alreadyUsed[normalized] {
					discoveredPatterns = append(discoveredPatterns, normalized)
					alreadyUsed[normalized] = true
					break
				}
			}
		}
	}
	if len(errs) == len(configFiles) {
		errs = append([]error{fmt.Errorf("no ssh config files could be opened: ")}, errs...)
		return nil, errors.Join(errs...)
	}
	if len(discoveredPatterns) == 0 {
		return nil, fmt.Errorf("no compatible hostnames found in ssh config files")
	}

	return discoveredPatterns, nil
}

func GetConnectionsList() ([]string, error) {
	existing := GetAllConnStatus()
	var currentlyRunning []string
	var hasConnected []string

	// populate all lists
	for _, stat := range existing {
		if stat.Connected {
			currentlyRunning = append(currentlyRunning, stat.Connection)
		}

		if stat.HasConnected {
			hasConnected = append(hasConnected, stat.Connection)
		}
	}

	fromInternal := GetConnectionsFromInternalConfig()

	fromConfig, err := GetConnectionsFromConfig()
	if err != nil {
		// this is not a fatal error. do not return
		log.Printf("warning: no connections from ssh config found: %v", err)
	}

	// sort into one final list and remove duplicates
	alreadyUsed := make(map[string]struct{})
	var connList []string

	for _, subList := range [][]string{currentlyRunning, hasConnected, fromInternal, fromConfig} {
		for _, pattern := range subList {
			if _, used := alreadyUsed[pattern]; !used {
				connList = append(connList, pattern)
				alreadyUsed[pattern] = struct{}{}
			}
		}
	}

	return connList, nil
}

func GetConnectionsFromInternalConfig() []string {
	var internalNames []string
	config := wconfig.GetWatcher().GetFullConfig()
	for internalName := range config.Connections {
		if strings.HasPrefix(internalName, "wsl://") {
			// don't add wsl conns to this list
			continue
		}
		internalNames = append(internalNames, internalName)
	}
	return internalNames
}

func GetConnectionsFromConfig() ([]string, error) {
	home := wavebase.GetHomeDir()
	localConfig := filepath.Join(home, ".ssh", "config")
	systemConfig := filepath.Join("/etc", "ssh", "config")
	sshConfigFiles := []string{localConfig, systemConfig}
	remote.WaveSshConfigUserSettings().ReloadConfigs()

	return resolveSshConfigPatterns(sshConfigFiles)
}
