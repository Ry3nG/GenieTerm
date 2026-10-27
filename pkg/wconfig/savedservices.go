// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/Ry3nG/GenieTerm/pkg/waveobj"
)

const MaxSavedPortServices = 128

func UpdateSavedPortService(connName string, service SavedPortService, remove bool) ([]SavedPortService, error) {
	if strings.TrimSpace(connName) == "" || service.Id == "" || len(service.Id) > 128 {
		return nil, fmt.Errorf("host and service id are required")
	}
	if !remove {
		service.Name = strings.TrimSpace(service.Name)
		service.RemoteHost = strings.TrimSpace(service.RemoteHost)
		if service.RemoteHost == "" {
			service.RemoteHost = "127.0.0.1"
		}
		if service.Name == "" || utf8.RuneCountInString(service.Name) > 80 {
			return nil, fmt.Errorf("give this service a name of up to 80 characters")
		}
		if service.RemotePort < 1 || service.RemotePort > 65535 || service.LocalPort < 0 || service.LocalPort > 65535 {
			return nil, fmt.Errorf("ports must be from 1 to 65535, or 0 for an automatic local port")
		}
		if len(service.RemoteHost) > 253 || strings.ContainsAny(service.RemoteHost, "/[]") || strings.ContainsFunc(service.RemoteHost, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) }) {
			return nil, fmt.Errorf("enter a remote hostname or IP address without a port")
		}
	}

	// Every renderer edits one ID against the latest file, not its last observed config snapshot.
	configWriteLock.Lock()
	defer configWriteLock.Unlock()
	m, cerrs := ReadWaveHomeConfigFile(ConnectionsFile)
	if len(cerrs) > 0 {
		return nil, fmt.Errorf("error reading config file: %v", cerrs[0])
	}
	if m == nil {
		m = make(waveobj.MetaMapType)
	}
	connData := m.GetMap(connName)
	if connData == nil {
		connData = make(waveobj.MetaMapType)
	}
	services := make([]SavedPortService, 0)
	if raw := connData["conn:services"]; raw != nil {
		data, err := json.Marshal(raw)
		if err != nil {
			return nil, fmt.Errorf("cannot read saved services: %w", err)
		}
		if err := json.Unmarshal(data, &services); err != nil {
			return nil, fmt.Errorf("cannot read saved services: %w", err)
		}
	}
	updated := make([]SavedPortService, 0, len(services)+1)
	found := false
	for _, existing := range services {
		if existing.Id == service.Id {
			if !remove && !found {
				updated = append(updated, service)
			}
			found = true
			continue
		}
		if !remove && existing.RemoteHost == service.RemoteHost && existing.RemotePort == service.RemotePort {
			return nil, fmt.Errorf("this remote address already has a saved service; edit that service instead")
		}
		updated = append(updated, existing)
	}
	if !remove && !found {
		if len(updated) >= MaxSavedPortServices {
			return nil, fmt.Errorf("this host already has %d saved services; forget one before adding another", MaxSavedPortServices)
		}
		updated = append(updated, service)
	}
	connData["conn:services"] = updated
	m[connName] = connData
	if err := writeWaveHomeConfigFileLocked(ConnectionsFile, m); err != nil {
		return nil, err
	}
	return updated, nil
}
