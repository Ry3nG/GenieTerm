// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package portforward

import (
	"sync"

	"github.com/Ry3nG/GenieTerm/pkg/remote"
	"github.com/Ry3nG/GenieTerm/pkg/remote/conncontroller"
	"github.com/Ry3nG/GenieTerm/pkg/wconfig"
	"github.com/Ry3nG/GenieTerm/pkg/wps"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc/wshclient"
	"golang.org/x/crypto/ssh"
)

var serverOnce sync.Once
var serverManager *Manager

func lookupClient(name string) Dialer {
	opts, err := remote.ParseOpts(name)
	if err != nil {
		return nil
	}
	conn := conncontroller.MaybeGetConn(opts)
	if conn == nil {
		return nil
	}
	return conncontroller.WithLockRtn(conn, func() Dialer {
		if conn.Status != conncontroller.Status_Connected || conn.Client == nil {
			return nil
		}
		return conn.Client
	})
}

func GetManager() *Manager {
	serverOnce.Do(func() {
		serverManager = makeServerManager()
		restorer := makeServiceRestorer()
		client := wshclient.GetBareRpcClient()
		client.EventListener.On(wps.Event_ConnChange, func(*wps.WaveEvent) {
			// Refresh all names because SSHOpts.String omits an explicit :22 in event scopes.
			serverManager.Refresh("")
			restorer.restore(serverManager, wconfig.GetWatcher().GetFullConfig().Connections)
		})
		wps.Broker.Subscribe(wshclient.GetBareRpcClientRouteId(), wps.SubscriptionRequest{
			Event: wps.Event_ConnChange, AllScopes: true,
		})
	})
	return serverManager
}

func makeServerManager() *Manager {
	m := MakeManager(lookupClient, func(name string, list []wshrpc.PortForwardInfo) {
		wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_PortForward, Scopes: []string{name}, Data: list})
	})
	m.closeDialer = func(d Dialer) { remote.CloseClientChain(d.(*ssh.Client)) }
	return m
}

func CloseAll() {
	// Shutdown before the first RPC must not create a bare RPC client or subscribe to events.
	serverOnce.Do(func() { serverManager = makeServerManager() })
	serverManager.CloseAll()
}
