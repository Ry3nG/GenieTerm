// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/panichandler"
	"github.com/Ry3nG/GenieTerm/pkg/utilds"
	"golang.org/x/crypto/ssh"
	xknownhosts "golang.org/x/crypto/ssh/knownhosts"
)

const clientChainCloseTimeout = 2 * time.Second

// KeepAliveSettings mirrors ssh_config ServerAliveInterval/ServerAliveCountMax.
// A zero Interval means "not configured" (callers use their own defaults).
type KeepAliveSettings struct {
	Interval time.Duration
	CountMax int
}

type clientChainEntry struct {
	jumpClients []*ssh.Client
	keepAlive   KeepAliveSettings
}

var clientChainLock = &sync.Mutex{}
var clientChains = make(map[*ssh.Client]*clientChainEntry)

func registerClientChain(client *ssh.Client, jumpClients []*ssh.Client, keepAlive KeepAliveSettings) {
	if client == nil {
		return
	}
	setClientChainEntry(client, &clientChainEntry{jumpClients: jumpClients, keepAlive: keepAlive})
	// a final client that dies on its own (server closed it, network dropped) must
	// still release the ProxyJump hops it was tunneled through (and its registry entry)
	go func() {
		defer func() {
			panichandler.PanicHandler("sshclient:clientChainWait", recover())
		}()
		client.Wait()
		CloseClientChain(client)
	}()
}

func setClientChainEntry(client *ssh.Client, entry *clientChainEntry) {
	clientChainLock.Lock()
	defer clientChainLock.Unlock()
	clientChains[client] = entry
}

func takeClientChainJumps(client *ssh.Client) []*ssh.Client {
	clientChainLock.Lock()
	defer clientChainLock.Unlock()
	entry := clientChains[client]
	delete(clientChains, client)
	if entry == nil {
		return nil
	}
	return entry.jumpClients
}

// GetClientKeepAliveSettings returns the ServerAlive* settings resolved when the client was created.
func GetClientKeepAliveSettings(client *ssh.Client) KeepAliveSettings {
	clientChainLock.Lock()
	defer clientChainLock.Unlock()
	entry := clientChains[client]
	if entry == nil {
		return KeepAliveSettings{CountMax: DefaultSshServerAliveCountMax}
	}
	return entry.keepAlive
}

// CloseClientChain closes an ssh.Client created by ConnectToClient along with every
// ProxyJump client it was tunneled through. Closing the final client over a dead jump
// transport can block, so it is bounded; the jump hops (whose TCP close never blocks)
// are always closed afterwards, which unblocks anything still waiting on the tunnel.
func CloseClientChain(client *ssh.Client) error {
	if client == nil {
		return nil
	}
	jumpClients := takeClientChainJumps(client)
	closeErrCh := make(chan error, 1)
	go func() {
		defer func() {
			panichandler.PanicHandler("sshclient:CloseClientChain", recover())
		}()
		closeErrCh <- client.Close()
	}()
	var err error
	select {
	case err = <-closeErrCh:
	case <-time.After(clientChainCloseTimeout):
		err = fmt.Errorf("timed out after %v closing ssh client", clientChainCloseTimeout)
	}
	closeClientsReverse(jumpClients)
	return err
}

func closeClientsReverse(clients []*ssh.Client) {
	for i := len(clients) - 1; i >= 0; i-- {
		jumpClient := clients[i]
		if jumpClient == nil {
			continue
		}
		go func() {
			defer func() {
				panichandler.PanicHandler("sshclient:closeJumpClient", recover())
			}()
			closeErr := CloseClientChain(jumpClient)
			if closeErr != nil && !isAlreadyClosedErr(closeErr) {
				log.Printf("[sshclient] error closing proxyjump client: %v", closeErr)
			}
		}()
	}
}

func isAlreadyClosedErr(err error) bool {
	if err == nil {
		return false
	}
	errStr := err.Error()
	return strings.Contains(errStr, "use of closed network connection") || strings.Contains(errStr, "EOF")
}

func makeHostKeyChangedError(hostname string, key ssh.PublicKey, knownKeys []xknownhosts.KnownKey) error {
	var locations []string
	for _, knownKey := range knownKeys {
		locations = append(locations, fmt.Sprintf("%s:%d (%s %s)", knownKey.Filename, knownKey.Line, knownKey.Key.Type(), ssh.FingerprintSHA256(knownKey.Key)))
	}
	locationStr := "your known_hosts file"
	if len(locations) > 0 {
		locationStr = strings.Join(locations, ", ")
	}
	return utilds.Errorf(ConnErrCode_HostKeyChanged,
		"REMOTE HOST IDENTIFICATION HAS CHANGED for %s: the server sent a %s key with fingerprint %s, which does not match %s. "+
			"This could be a man-in-the-middle attack, or the host's key was legitimately replaced. "+
			"If you trust the new key, remove the old entry (e.g. `ssh-keygen -R %s`) and reconnect.",
		hostname, key.Type(), ssh.FingerprintSHA256(key), locationStr, xknownhosts.Normalize(hostname))
}
