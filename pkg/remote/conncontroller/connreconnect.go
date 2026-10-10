// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package conncontroller

import (
	"context"
	"fmt"
	"log"
	"math/rand/v2"
	"sync"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/panichandler"
	"github.com/Ry3nG/GenieTerm/pkg/remote"
	"github.com/Ry3nG/GenieTerm/pkg/wconfig"
	"golang.org/x/crypto/ssh"
)

const ReconnectInitialDelay = 1 * time.Second
const ReconnectMaxDelay = 60 * time.Second
const ReconnectAttemptTimeout = 45 * time.Second
const ReconnectJitterFraction = 0.2

type reconnectLoop struct {
	cancel context.CancelFunc
	kickCh chan struct{}
}

var autoReconnectPolicyLock = &sync.Mutex{}
var autoReconnectPolicy func(connName string) bool

// SetAutoReconnectPolicy registers the predicate deciding whether a dropped connection is
// worth reconnecting automatically (e.g. it has durable jobs or open terminal blocks).
// It lives outside this package to avoid an import cycle with the block/job controllers.
func SetAutoReconnectPolicy(policyFn func(connName string) bool) {
	autoReconnectPolicyLock.Lock()
	defer autoReconnectPolicyLock.Unlock()
	autoReconnectPolicy = policyFn
}

func getAutoReconnectPolicy() func(connName string) bool {
	autoReconnectPolicyLock.Lock()
	defer autoReconnectPolicyLock.Unlock()
	return autoReconnectPolicy
}

func shouldAutoReconnect(connName string) bool {
	policyFn := getAutoReconnectPolicy()
	if policyFn == nil {
		return false
	}
	return policyFn(connName)
}

// computeReconnectDelay returns the wait before the given (1-based) attempt: exponential
// from ReconnectInitialDelay, capped at ReconnectMaxDelay, with +/-20% jitter so many
// connections dropped by the same network event don't retry in lockstep.
func computeReconnectDelay(attempt int, randFn func() float64) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	delay := ReconnectInitialDelay
	for i := 1; i < attempt && delay < ReconnectMaxDelay; i++ {
		delay *= 2
	}
	if delay > ReconnectMaxDelay {
		delay = ReconnectMaxDelay
	}
	jitter := (randFn()*2 - 1) * ReconnectJitterFraction
	return time.Duration(float64(delay) * (1 + jitter))
}

// isRetryableConnectError reports whether an automatic reconnect should keep trying after
// err. Anything that needs the user (credentials, host key decisions, config fixes) stops
// the loop so we never spam prompts or hammer a server with failing auth.
func isRetryableConnectError(err error) bool {
	if err == nil {
		return false
	}
	code, subCode := remote.ClassifyConnError(err)
	switch code {
	case remote.ConnErrCode_AuthFailed:
		return subCode != remote.AuthSubCode_UnableToAuth
	case remote.ConnErrCode_ConfigParse,
		remote.ConnErrCode_ConfigDefault,
		remote.ConnErrCode_ProxyDepth,
		remote.ConnErrCode_ProxyParse,
		remote.ConnErrCode_ProxyCommand,
		remote.ConnErrCode_SecretStore,
		remote.ConnErrCode_SecretNotFound,
		remote.ConnErrCode_KnownHostsNone,
		remote.ConnErrCode_KnownHostsFmt,
		remote.ConnErrCode_HostKeyRevoked,
		remote.ConnErrCode_HostKeyChanged,
		remote.ConnErrCode_HostKeyVerify,
		remote.ConnErrCode_UserCancelled,
		remote.ConnErrCode_UserTimeout,
		remote.ConnErrCode_UserInputReq:
		return false
	}
	return true
}

func (conn *SSHConn) maybeStartAutoReconnect(reason string) {
	connName := conn.GetName()
	if !shouldAutoReconnect(connName) {
		return
	}
	loopCtx, loopCancel := context.WithCancel(context.Background())
	loop := &reconnectLoop{cancel: loopCancel, kickCh: make(chan struct{}, 1)}
	if !conn.installReconnectLoop(loop) {
		loopCancel()
		return
	}
	log.Printf("[conn:%s] starting automatic reconnect (%s)", connName, reason)
	go func() {
		defer func() {
			panichandler.PanicHandler("conncontroller:runAutoReconnect", recover())
		}()
		conn.runAutoReconnect(loopCtx, loop)
	}()
}

func (conn *SSHConn) installReconnectLoop(loop *reconnectLoop) bool {
	conn.lock.Lock()
	defer conn.lock.Unlock()
	if conn.reconnect != nil {
		return false
	}
	conn.reconnect = loop
	conn.Reconnecting = true
	conn.ReconnectAttempt = 0
	conn.NextReconnectTs = 0
	return true
}

// returns true if loop was still the active reconnect loop
func (conn *SSHConn) clearReconnectLoop(loop *reconnectLoop) bool {
	conn.lock.Lock()
	defer conn.lock.Unlock()
	if loop == nil || conn.reconnect != loop {
		return false
	}
	conn.reconnect = nil
	conn.Reconnecting = false
	conn.ReconnectAttempt = 0
	conn.NextReconnectTs = 0
	return true
}

// stopAutoReconnect cancels the running reconnect loop (user disconnect). Returns true if one was running.
func (conn *SSHConn) stopAutoReconnect() bool {
	loop := WithLockRtn(conn, func() *reconnectLoop {
		return conn.reconnect
	})
	if loop == nil {
		return false
	}
	loop.cancel()
	return conn.clearReconnectLoop(loop)
}

func (conn *SSHConn) kickAutoReconnect() {
	loop := WithLockRtn(conn, func() *reconnectLoop {
		return conn.reconnect
	})
	if loop == nil {
		return
	}
	select {
	case loop.kickCh <- struct{}{}:
	default:
	}
}

func (conn *SSHConn) isReconnectLoopActive(loop *reconnectLoop) bool {
	return WithLockRtn(conn, func() bool {
		return conn.reconnect == loop
	})
}

func (conn *SSHConn) setReconnectProgress(loop *reconnectLoop, attempt int, nextTs int64) {
	conn.lock.Lock()
	defer conn.lock.Unlock()
	if conn.reconnect != loop {
		return
	}
	conn.ReconnectAttempt = attempt
	conn.NextReconnectTs = nextTs
}

func (conn *SSHConn) runAutoReconnect(loopCtx context.Context, loop *reconnectLoop) {
	connName := conn.GetName()
	defer func() {
		loop.cancel()
		if conn.clearReconnectLoop(loop) {
			conn.FireConnChangeEvent()
		}
	}()
	for attempt := 1; ; attempt++ {
		delay := computeReconnectDelay(attempt, rand.Float64)
		conn.setReconnectProgress(loop, attempt, time.Now().Add(delay).UnixMilli())
		conn.FireConnChangeEvent()
		timer := time.NewTimer(delay)
		select {
		case <-loopCtx.Done():
			timer.Stop()
			return
		case <-loop.kickCh:
			timer.Stop()
		case <-timer.C:
		}
		if !conn.isReconnectLoopActive(loop) {
			return
		}
		status := conn.GetStatus()
		if status == Status_Connected || status == Status_Connecting {
			return
		}
		if !shouldAutoReconnect(connName) {
			log.Printf("[conn:%s] automatic reconnect no longer needed, stopping", connName)
			return
		}
		conn.setReconnectProgress(loop, attempt, 0)
		conn.FireConnChangeEvent()
		log.Printf("[conn:%s] automatic reconnect attempt %d", connName, attempt)
		attemptCtx, attemptCancel := context.WithTimeout(remote.ContextWithNoUserInput(loopCtx), ReconnectAttemptTimeout)
		err := conn.Connect(attemptCtx, &wconfig.ConnKeywords{})
		attemptCancel()
		if err == nil {
			log.Printf("[conn:%s] automatic reconnect succeeded (attempt %d)", connName, attempt)
			return
		}
		if loopCtx.Err() != nil {
			return
		}
		status = conn.GetStatus()
		if status == Status_Connected || status == Status_Connecting {
			return
		}
		if !isRetryableConnectError(err) {
			log.Printf("[conn:%s] automatic reconnect stopped (attempt %d): %v", connName, attempt, err)
			conn.WithLock(func() {
				conn.Error = fmt.Sprintf("automatic reconnect stopped: %s", remote.SimpleMessageFromPossibleConnectionError(err))
			})
			return
		}
		log.Printf("[conn:%s] automatic reconnect attempt %d failed: %v", connName, attempt, err)
	}
}

// closeUnresponsiveClient force-closes a client whose transport stopped answering
// keepalives. waitForDisconnect then marks the connection disconnected and starts the
// automatic reconnect, exactly as for any other dropped connection.
func (conn *SSHConn) closeUnresponsiveClient(client *ssh.Client, reason string) {
	isCurrent := WithLockRtn(conn, func() bool {
		if conn.Client != client {
			return false
		}
		conn.Error = fmt.Sprintf("connection unresponsive (%s)", reason)
		return true
	})
	if !isCurrent {
		return
	}
	log.Printf("[conn:%s] closing unresponsive connection: %s", conn.GetName(), reason)
	go func() {
		defer func() {
			panichandler.PanicHandler("conncontroller:closeUnresponsiveClient", recover())
		}()
		remote.CloseClientChain(client)
	}()
}
