// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package portforward

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"strings"
	"testing"

	"github.com/Ry3nG/GenieTerm/pkg/wconfig"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

func savedConfig(restore bool) map[string]wconfig.ConnKeywords {
	return map[string]wconfig.ConnKeywords{"test-host": {ConnServices: []wconfig.SavedPortService{
		{Id: "api", Name: "API", RemoteHost: "127.0.0.1", RemotePort: 3000, Restore: restore},
	}}}
}

func TestSavedServicesRestoreOnlyOnNewConnection(t *testing.T) {
	state := &clientState{}
	m := makeMemoryManager(t, state, nil)
	r := makeServiceRestorer()
	config := savedConfig(true)
	r.restore(m, config)
	if len(m.List("")) != 0 {
		t.Fatal("disconnected hosts must not start listeners")
	}
	state.client.Store(&fakeDialer{})
	r.restore(m, config)
	list := m.List("")
	if len(list) != 1 {
		t.Fatalf("expected restored service, got %v", list)
	}
	m.Stop(list[0].Id)
	r.restore(m, config)
	if len(m.List("")) != 0 {
		t.Fatal("helper events must not undo an explicit stop")
	}
	state.client.Store(&fakeDialer{})
	r.restore(m, config)
	if len(m.List("")) != 1 {
		t.Fatal("new SSH connection should restore opted-in service")
	}
}

func TestSavedServiceRestoreDefaultsOffAfterConfigRoundTrip(t *testing.T) {
	var config map[string]wconfig.ConnKeywords
	err := json.Unmarshal([]byte(`{"test-host":{"display:name":"Development","conn:services":[{"id":"api","name":"API","remotehost":"127.0.0.1","remoteport":3000,"localport":0}]}}`), &config)
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatal(err)
	}
	if config["test-host"].DisplayName != "Development" || config["test-host"].ConnServices[0].Name != "API" {
		t.Fatal("saved service or unrelated connection settings did not round-trip")
	}
	state := &clientState{}
	state.client.Store(&fakeDialer{})
	m := makeMemoryManager(t, state, nil)
	makeServiceRestorer().restore(m, config)
	if len(m.List("")) != 0 {
		t.Fatal("missing restore preference must not create a listener")
	}
}

func TestSavedServiceCollisionIsVisibleAndRetryable(t *testing.T) {
	state := &clientState{}
	state.client.Store(&fakeDialer{})
	m := makeMemoryManager(t, state, nil)
	listen := m.listen
	attempts := 0
	m.listen = func(data wshrpc.CommandPortForwardStartData) (net.Listener, error) {
		attempts++
		if attempts == 1 {
			return nil, errors.New("local port 3000 is in use")
		}
		return listen(data)
	}
	r := makeServiceRestorer()
	r.restore(m, savedConfig(true))
	list := m.List("")
	if len(list) != 1 || list[0].Status != "error" || !strings.Contains(list[0].Error, "in use") {
		t.Fatalf("restore failure should be visible, got %v", list)
	}
	r.restore(m, savedConfig(true))
	if attempts != 1 {
		t.Fatal("same connection must not repeatedly retry a collision")
	}
	if _, err := m.Start(context.Background(), wshrpc.CommandPortForwardStartData{ConnName: "test-host", RemotePort: 3000}); err != nil {
		t.Fatal(err)
	}
	if list = m.List(""); len(list) != 1 || list[0].Status == "error" {
		t.Fatalf("successful retry should replace the stale failure, got %v", list)
	}
}
