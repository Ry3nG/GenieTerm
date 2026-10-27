// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/Ry3nG/GenieTerm/pkg/wavebase"
	"github.com/Ry3nG/GenieTerm/pkg/waveobj"
)

func savedServicesConfigFixture(t *testing.T) string {
	t.Helper()
	previous := wavebase.ConfigHome_VarCache
	wavebase.ConfigHome_VarCache = t.TempDir()
	t.Cleanup(func() { wavebase.ConfigHome_VarCache = previous })
	return filepath.Join(wavebase.ConfigHome_VarCache, ConnectionsFile)
}

func savedServiceForTest(id string, port int) SavedPortService {
	return SavedPortService{Id: id, Name: id, RemoteHost: "127.0.0.1", RemotePort: port}
}

func readSavedServicesForTest(t *testing.T) map[string]ConnKeywords {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(wavebase.GetWaveConfigDir(), ConnectionsFile))
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]ConnKeywords
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatal(err)
	}
	return config
}

func TestSavedServicesConcurrentMutationsPreserveOtherEdits(t *testing.T) {
	savedServicesConfigFixture(t)
	if err := SetConnectionsConfigValue("dev", waveobj.MetaMapType{"display:name": "Development"}); err != nil {
		t.Fatal(err)
	}
	const count = 16
	start := make(chan struct{})
	errors := make(chan error, count*2)
	var wg sync.WaitGroup
	for i := range count {
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			_, err := UpdateSavedPortService("dev", savedServiceForTest(fmt.Sprintf("service-%d", i), 3000+i), false)
			errors <- err
		}()
		go func() {
			defer wg.Done()
			<-start
			errors <- SetConnectionsConfigValue(fmt.Sprintf("host-%d", i), waveobj.MetaMapType{"display:name": "Other host"})
		}()
	}
	close(start)
	wg.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	config := readSavedServicesForTest(t)
	if len(config["dev"].ConnServices) != count || config["dev"].DisplayName != "Development" || len(config) != count+1 {
		t.Fatalf("concurrent service or unrelated config edits were lost: %#v", config)
	}
}

func TestSavedServicesEditAndRemoveOnlyTargetID(t *testing.T) {
	savedServicesConfigFixture(t)
	first := savedServiceForTest("first", 3000)
	second := savedServiceForTest("second", 4000)
	if _, err := UpdateSavedPortService("dev", first, false); err != nil {
		t.Fatal(err)
	}
	if _, err := UpdateSavedPortService("dev", second, false); err != nil {
		t.Fatal(err)
	}
	first.Name, first.Restore = "Renamed", true
	updated, err := UpdateSavedPortService("dev", first, false)
	if err != nil || len(updated) != 2 || updated[0] != first || updated[1] != second {
		t.Fatalf("same-ID edit should replace only that service: %v, %v", updated, err)
	}
	updated, err = UpdateSavedPortService("dev", SavedPortService{Id: first.Id}, true)
	if err != nil || len(updated) != 1 || updated[0] != second {
		t.Fatalf("removal should retain the other renderer's service: %v, %v", updated, err)
	}
	if _, err := UpdateSavedPortService("dev", savedServiceForTest("duplicate", 4000), false); err == nil {
		t.Fatal("duplicate endpoint must be checked against the latest saved file")
	}
}

func TestSavedServicesCorruptConfigIsNotReplaced(t *testing.T) {
	path := savedServicesConfigFixture(t)
	for _, original := range []string{`{"dev":`, `{"dev":{"conn:services":"unexpected"}}`} {
		if err := os.WriteFile(path, []byte(original), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := UpdateSavedPortService("dev", savedServiceForTest("api", 3000), false); err == nil {
			t.Fatal("unreadable config must reject the mutation")
		}
		data, err := os.ReadFile(path)
		if err != nil || string(data) != original {
			t.Fatalf("unreadable config was changed: %s, %v", data, err)
		}
	}
}

func TestSavedServicesLimitUsesCurrentFile(t *testing.T) {
	savedServicesConfigFixture(t)
	services := make([]SavedPortService, MaxSavedPortServices)
	for i := range services {
		services[i] = savedServiceForTest(fmt.Sprintf("service-%d", i), 3000+i)
	}
	if err := SetConnectionsConfigValue("dev", waveobj.MetaMapType{"conn:services": services}); err != nil {
		t.Fatal(err)
	}
	if _, err := UpdateSavedPortService("dev", savedServiceForTest("extra", 5000), false); err == nil {
		t.Fatal("must reject a new service above the limit")
	}
	services[0].Restore = true
	if _, err := UpdateSavedPortService("dev", services[0], false); err != nil {
		t.Fatalf("an existing service remains editable at the limit: %v", err)
	}
}
