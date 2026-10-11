// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package conncontroller

import (
	"context"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/panichandler"
	"github.com/Ry3nG/GenieTerm/pkg/remote"
	"golang.org/x/crypto/ssh"
)

const connMonitorCheckInterval = 10 * time.Second
const connMonitorUrgentCheckDelay = time.Second
const connMonitorInFlightCheckInterval = 2 * time.Second
const connMonitorKeepAliveIdle = 10 * time.Second
const connMonitorStalledThreshold = 10 * time.Second

// on a few-KB/s link an upload's accepted chunks arrive seconds apart, so a moving transfer
// vouches for the link this long after its last chunk
const connMonitorTransferGrace = 30 * time.Second
const connMonitorUrgentStalledThreshold = 5 * time.Second
const connMonitorDeadTimeout = 15 * time.Second
const connMonitorResumeProbeTimeout = 5 * time.Second

// Lock ordering: conn.lock > cm.lock (conn.lock is outer, cm.lock is inner)
// CRITICAL: Methods that hold cm.lock must NEVER call into SSHConn (deadlock - violates ordering).
// Methods called from SSHConn while conn.lock is held should avoid acquiring cm.lock (keep locking simple).
type ConnMonitor struct {
	lock             *sync.Mutex
	Conn             *SSHConn    // always non-nil, set at creation
	Client           *ssh.Client // always non-nil, set at creation
	LastActivityTime atomic.Int64
	LastInputTime    atomic.Int64
	// last time an upload (the helper install) got bytes accepted by the SSH channel; a
	// keepalive queued behind a long upload on a slow link answers late without the link
	// being stalled or dead
	LastTransferTime  atomic.Int64
	KeepAliveSentTime atomic.Int64
	KeepAliveInFlight bool
	KeepAlive         remote.KeepAliveSettings
	closeRequested    atomic.Bool
	ctx               context.Context
	cancelFunc        context.CancelFunc
	inputNotifyCh     chan int64
	activityNotifyCh  chan struct{}
	checkNotifyCh     chan struct{}
}

func MakeConnMonitor(conn *SSHConn, client *ssh.Client) *ConnMonitor {
	if conn == nil {
		panic("conn cannot be nil")
	}
	if client == nil {
		panic("client cannot be nil")
	}
	ctx, cancelFunc := context.WithCancel(context.Background())
	cm := &ConnMonitor{
		lock:             &sync.Mutex{},
		Conn:             conn,
		Client:           client,
		KeepAlive:        remote.GetClientKeepAliveSettings(client),
		ctx:              ctx,
		cancelFunc:       cancelFunc,
		inputNotifyCh:    make(chan int64, 1),
		activityNotifyCh: make(chan struct{}, 1),
		checkNotifyCh:    make(chan struct{}, 1),
	}
	// the handshake just completed, so the transport is known-good right now. Seeding this
	// matters for connections without the helper, which otherwise never produce
	// "activity" and would never get keepalives (or would read as degraded forever).
	cm.LastActivityTime.Store(time.Now().UnixMilli())
	go cm.keepAliveMonitor()
	return cm
}

// setConnHealthStatus calls into SSHConn.SetConnHealthStatus
// CRITICAL: cm.lock must NOT be held when calling this method (violates lock ordering)
func (cm *ConnMonitor) setConnHealthStatus(status string) {
	cm.Conn.SetConnHealthStatus(cm.Client, status)
}

func (cm *ConnMonitor) UpdateLastActivityTime() {
	cm.LastActivityTime.Store(time.Now().UnixMilli())
	cm.setConnHealthStatus(ConnHealthStatus_Good)
	select {
	case cm.activityNotifyCh <- struct{}{}:
	default:
	}
}

func (cm *ConnMonitor) NotifyTransferProgress() {
	cm.LastTransferTime.Store(time.Now().UnixMilli())
	cm.setConnHealthStatus(ConnHealthStatus_Good)
}

func (cm *ConnMonitor) isTransferring(now int64, within int64) bool {
	last := cm.LastTransferTime.Load()
	return last > 0 && now-last < within
}

func (cm *ConnMonitor) NotifyInput() {
	inputTime := time.Now().UnixMilli()
	cm.LastInputTime.Store(inputTime)
	select {
	case cm.inputNotifyCh <- inputTime:
	default:
	}
}

func (cm *ConnMonitor) NotifyCheck() {
	select {
	case cm.checkNotifyCh <- struct{}{}:
	default:
	}
}

func (cm *ConnMonitor) isUrgent() bool {
	lastInput := cm.LastInputTime.Load()
	if lastInput == 0 {
		return false
	}
	return time.Now().UnixMilli()-lastInput < 10000
}

func (cm *ConnMonitor) setKeepAliveInFlight() bool {
	cm.lock.Lock()
	defer cm.lock.Unlock()

	if cm.KeepAliveInFlight {
		return false
	}
	cm.KeepAliveInFlight = true
	cm.KeepAliveSentTime.Store(time.Now().UnixMilli())
	return true
}

func (cm *ConnMonitor) clearKeepAliveInFlight() {
	cm.lock.Lock()
	defer cm.lock.Unlock()

	cm.KeepAliveInFlight = false
}

func (cm *ConnMonitor) isKeepAliveInFlight() bool {
	cm.lock.Lock()
	defer cm.lock.Unlock()
	return cm.KeepAliveInFlight
}

func (cm *ConnMonitor) getTimeSinceKeepAlive() int64 {
	cm.lock.Lock()
	defer cm.lock.Unlock()

	if !cm.KeepAliveInFlight {
		return 0
	}
	return time.Now().UnixMilli() - cm.KeepAliveSentTime.Load()
}

// SendKeepAlive sends an SSH-level keepalive@openssh.com global request. It works with or
// without the remote helper, since any SSH server answers (or rejects) global requests.
func (cm *ConnMonitor) SendKeepAlive() error {
	client := cm.Client
	if !cm.setKeepAliveInFlight() {
		return nil
	}
	go func() {
		defer func() {
			panichandler.PanicHandler("conncontroller:SendKeepAlive", recover())
		}()
		defer cm.clearKeepAliveInFlight()
		startTime := time.Now()
		_, _, err := client.SendRequest("keepalive@openssh.com", true, nil)
		if err != nil {
			// errors are only returned for network and I/O issues (likely disconnection). do not update last activity time
			duration := time.Since(startTime).Milliseconds()
			log.Printf("[conncontroller] conn:%s keepalive error (duration=%dms): %v", cm.Conn.GetName(), duration, err)
			return
		}
		cm.UpdateLastActivityTime()
	}()
	return nil
}

func (cm *ConnMonitor) keepAliveIdleThreshold() time.Duration {
	if cm.KeepAlive.Interval > 0 {
		return cm.KeepAlive.Interval
	}
	return connMonitorKeepAliveIdle
}

// deadTimeout is how long a keepalive may stay unanswered before the transport is
// considered dead (ServerAliveInterval * ServerAliveCountMax when configured).
func (cm *ConnMonitor) deadTimeout() time.Duration {
	if cm.KeepAlive.Interval > 0 {
		countMax := cm.KeepAlive.CountMax
		if countMax <= 0 {
			countMax = remote.DefaultSshServerAliveCountMax
		}
		return cm.KeepAlive.Interval * time.Duration(countMax)
	}
	return connMonitorDeadTimeout
}

func (cm *ConnMonitor) nextCheckDelay() time.Duration {
	if cm.isKeepAliveInFlight() {
		return connMonitorInFlightCheckInterval
	}
	idle := cm.keepAliveIdleThreshold()
	if idle < connMonitorCheckInterval {
		return idle
	}
	return connMonitorCheckInterval
}

func (cm *ConnMonitor) checkConnection() {
	lastActivity := cm.LastActivityTime.Load()
	if lastActivity == 0 {
		return
	}
	urgent := cm.isUrgent()
	timeSinceActivity := time.Now().UnixMilli() - lastActivity

	keepAliveThreshold := cm.keepAliveIdleThreshold().Milliseconds()
	if urgent {
		keepAliveThreshold = connMonitorUrgentCheckDelay.Milliseconds()
	}
	if timeSinceActivity > keepAliveThreshold {
		cm.SendKeepAlive()
	}

	stalledThreshold := connMonitorStalledThreshold.Milliseconds()
	if urgent {
		stalledThreshold = connMonitorUrgentStalledThreshold.Milliseconds()
	}
	timeSinceKeepAlive := cm.getTimeSinceKeepAlive()
	if cm.isTransferring(time.Now().UnixMilli(), connMonitorTransferGrace.Milliseconds()) {
		return
	}
	if timeSinceKeepAlive > stalledThreshold {
		cm.setConnHealthStatus(ConnHealthStatus_Stalled)
	}
	if timeSinceKeepAlive > cm.deadTimeout().Milliseconds() {
		cm.handleDeadConnection(fmt.Sprintf("no keepalive response for %ds", timeSinceKeepAlive/1000))
	}
}

// handleDeadConnection closes the transport so the connection can be re-established.
// Only done when an automatic reconnect will follow (durable jobs / open terminals) or
// when the user explicitly configured ServerAliveInterval (OpenSSH semantics); otherwise
// the connection is just shown as stalled and the user decides.
func (cm *ConnMonitor) handleDeadConnection(reason string) {
	if cm.ctx == nil || cm.ctx.Err() != nil || cm.Client == nil {
		return
	}
	if cm.KeepAlive.Interval <= 0 && !shouldAutoReconnect(cm.Conn.GetName()) {
		return
	}
	if !cm.closeRequested.CompareAndSwap(false, true) {
		return
	}
	cm.Conn.closeUnresponsiveClient(cm.Client, reason)
}

// ProbeAfterResume sends an immediate keepalive with a short timeout. After sleep the
// TCP connection is often silently dead; waiting for the regular stall detection would
// leave durable sessions detached for much longer than necessary.
func (cm *ConnMonitor) ProbeAfterResume() {
	if cm.Client == nil || cm.ctx == nil {
		return
	}
	go func() {
		defer func() {
			panichandler.PanicHandler("conncontroller:ProbeAfterResume", recover())
		}()
		err := cm.probeKeepAlive(connMonitorResumeProbeTimeout)
		if cm.ctx.Err() != nil {
			return
		}
		if err == nil {
			cm.UpdateLastActivityTime()
			return
		}
		log.Printf("[conncontroller] conn:%s resume probe failed: %v", cm.Conn.GetName(), err)
		cm.handleDeadConnection("no response after system resume")
	}()
}

func (cm *ConnMonitor) probeKeepAlive(timeout time.Duration) error {
	resultCh := make(chan error, 1)
	go func() {
		defer func() {
			panichandler.PanicHandler("conncontroller:probeKeepAlive", recover())
		}()
		_, _, err := cm.Client.SendRequest("keepalive@openssh.com", true, nil)
		resultCh <- err
	}()
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case err := <-resultCh:
		return err
	case <-timer.C:
		return fmt.Errorf("keepalive not answered within %v", timeout)
	case <-cm.ctx.Done():
		return nil
	}
}

func (cm *ConnMonitor) keepAliveMonitor() {
	defer func() {
		panichandler.PanicHandler("conncontroller:keepAliveMonitor", recover())
	}()
	timer := time.NewTimer(connMonitorCheckInterval)
	if !timer.Stop() {
		<-timer.C
	}
	defer timer.Stop()
	var timerCh <-chan time.Time
	var pendingInputTime int64
	resetTimer := func(delay time.Duration) {
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		timer.Reset(delay)
		timerCh = timer.C
	}
	resetTimer(cm.nextCheckDelay())

	for {
		// check if our client is still the active one
		if cm.Conn.GetClient() != cm.Client {
			return
		}

		select {
		case <-timerCh:
			timerCh = nil
			if pendingInputTime != 0 {
				if cm.LastActivityTime.Load() >= pendingInputTime {
					pendingInputTime = 0
				} else if cm.getTimeSinceKeepAlive() < connMonitorUrgentCheckDelay.Milliseconds() {
					// input with no response yet: probe the transport (works without the
					// helper, whose traffic is otherwise the only "activity" signal)
					cm.SendKeepAlive()
					resetTimer(connMonitorUrgentCheckDelay)
					continue
				} else {
					cm.setConnHealthStatus(ConnHealthStatus_Degraded)
					pendingInputTime = 0
				}
			}
			cm.checkConnection()
			resetTimer(cm.nextCheckDelay())

		case inputTime := <-cm.inputNotifyCh:
			if cm.LastActivityTime.Load() >= inputTime {
				continue
			}
			pendingInputTime = inputTime
			resetTimer(connMonitorUrgentCheckDelay)

		case <-cm.activityNotifyCh:
			pendingInputTime = 0
			resetTimer(cm.nextCheckDelay())

		case <-cm.checkNotifyCh:
			cm.checkConnection()
			resetTimer(cm.nextCheckDelay())

		case <-cm.ctx.Done():
			return
		}
	}
}

func (cm *ConnMonitor) Close() {
	if cm.cancelFunc != nil {
		cm.cancelFunc()
	}
}
