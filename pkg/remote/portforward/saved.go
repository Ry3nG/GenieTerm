// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package portforward

import (
	"context"
	"sync"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/wconfig"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
	"github.com/google/uuid"
)

type serviceRestorer struct {
	lock    sync.Mutex
	clients map[string]Dialer
}

func makeServiceRestorer() *serviceRestorer {
	return &serviceRestorer{clients: make(map[string]Dialer)}
}

func (r *serviceRestorer) restore(m *Manager, connections map[string]wconfig.ConnKeywords) {
	r.lock.Lock()
	defer r.lock.Unlock()
	for name, config := range connections {
		client := m.lookup(name)
		if client == nil {
			delete(r.clients, name)
			continue
		}
		if r.clients[name] == client {
			continue
		}
		// A connection can publish several events while its helper starts. An explicit
		// stop or failed bind must not be retried until a new SSH connection is made.
		r.clients[name] = client
		for i, service := range config.ConnServices {
			if i >= maxForwards {
				break
			}
			if !service.Restore {
				continue
			}
			data := wshrpc.CommandPortForwardStartData{
				ConnName: name, RemoteHost: service.RemoteHost, RemotePort: service.RemotePort, LocalPort: service.LocalPort,
			}
			if _, err := m.Start(context.Background(), data); err != nil {
				m.recordRestoreError(data, err.Error())
			}
		}
	}
	for name := range r.clients {
		if _, ok := connections[name]; !ok {
			delete(r.clients, name)
		}
	}
}

func (m *Manager) recordRestoreError(data wshrpc.CommandPortForwardStartData, message string) {
	m.lock.Lock()
	defer m.lock.Unlock()
	if m.closed || len(m.restoreErrors) >= maxForwards {
		return
	}
	if data.RemoteHost == "" {
		data.RemoteHost = "127.0.0.1"
	}
	key := forwardKey{data.ConnName, data.RemoteHost, data.RemotePort}
	if m.keys[key] != nil {
		return
	}
	m.restoreErrors[key] = wshrpc.PortForwardInfo{
		Id: "saved:" + uuid.NewString(), ConnName: data.ConnName, RemoteHost: data.RemoteHost,
		RemotePort: data.RemotePort, LocalPort: data.LocalPort, Status: wshrpc.PortForwardStatus_Error,
		Error: "Could not restore service: " + message, CreatedTs: time.Now().UnixMilli(),
	}
	m.changedLocked(data.ConnName, true)
}
