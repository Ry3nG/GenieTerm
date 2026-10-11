// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package commandai

import (
	"context"
	"encoding/json"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/secretstore"
	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

var probeTimeout = 8 * time.Second

var versionPattern = regexp.MustCompile(`\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?`)

var detectionCache = struct {
	sync.Mutex
	entries map[string]detectionEntry
}{entries: make(map[string]detectionEntry)}

type detectionEntry struct {
	info wshrpc.CommandAiEngineInfo
	at   time.Time
}

func installCommand(id string) string {
	if id == EngineCodex {
		return "npm install -g @openai/codex"
	}
	return "curl -fsSL https://claude.ai/install.sh | bash"
}

func loginCommand(id string) string {
	if id == EngineCodex {
		return "codex login"
	}
	return "claude auth login"
}

func cachedDetection(key string) (wshrpc.CommandAiEngineInfo, bool) {
	detectionCache.Lock()
	defer detectionCache.Unlock()
	e, ok := detectionCache.entries[key]
	e.info.Models = append([]string(nil), e.info.Models...)
	return e.info, ok && time.Since(e.at) < 60*time.Second
}

func cacheDetection(key string, info wshrpc.CommandAiEngineInfo) {
	detectionCache.Lock()
	defer detectionCache.Unlock()
	info.Models = append([]string(nil), info.Models...)
	detectionCache.entries[key] = detectionEntry{info, time.Now()}
}

func detectOne(ctx context.Context, s settings, refresh bool) wshrpc.CommandAiEngineInfo {
	key := s.engine + "\n" + s.base
	// API key presence is cheap to recheck and must reflect settings changes immediately.
	cacheable := s.engine == EngineCodex || s.engine == EngineClaude || s.engine == EngineOllama
	if cacheable && !refresh {
		if info, ok := cachedDetection(key); ok {
			return info
		}
	}
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	info := wshrpc.CommandAiEngineInfo{Id: s.engine, Label: engineLabel(s.engine), BaseUrl: s.base}
	switch s.engine {
	case EngineCodex, EngineClaude:
		info.Kind = KindCli
		path, err := lookPath(s.engine)
		if err != nil {
			info.Detail = "Not installed"
			info.FixCommand = installCommand(s.engine)
			break
		}
		info.Available = true
		info.Path = path
		args := []string{"login", "status"}
		if s.engine == EngineClaude {
			args = []string{"auth", "status", "--json"}
		}
		// Each probe starts node or a large binary, which can take seconds on a busy
		// machine, so they run side by side.
		var versionOut, out, stderr []byte
		var probes sync.WaitGroup
		probes.Add(2)
		go func() {
			defer probes.Done()
			versionOut, _, _ = runProcess(ctx, path, []string{"--version"}, "", "", childEnv())
		}()
		go func() {
			defer probes.Done()
			out, stderr, err = runProcess(ctx, path, args, "", "", childEnv())
		}()
		probes.Wait()
		info.Version = versionPattern.FindString(string(versionOut))
		if s.engine == EngineCodex {
			info.SignedIn = err == nil
			text := string(out) + string(stderr)
			if info.SignedIn {
				if strings.Contains(strings.ToLower(text), "api key") {
					info.Account = "API key"
				} else if strings.Contains(text, "ChatGPT") {
					info.Account = "ChatGPT"
				}
			}
		} else {
			var auth struct {
				LoggedIn     bool   `json:"loggedIn"`
				Method       string `json:"authMethod"`
				Subscription string `json:"subscriptionType"`
			}
			if err == nil && json.Unmarshal(out, &auth) == nil {
				info.SignedIn = auth.LoggedIn
				if auth.LoggedIn {
					info.Account = "Claude account"
					method := strings.ToLower(auth.Method)
					if strings.Contains(method, "api") {
						info.Account = "API key"
					} else {
						switch strings.ToLower(auth.Subscription) {
						case "max":
							info.Account = "Claude Max"
						case "pro":
							info.Account = "Claude Pro"
						case "team":
							info.Account = "Claude Team"
						case "enterprise":
							info.Account = "Claude Enterprise"
						}
					}
				}
			}
		}
		if !info.SignedIn {
			info.Detail = "Not signed in"
			info.FixCommand = loginCommand(s.engine)
		}
	case EngineOllama:
		info.Kind = KindLocal
		probe, cancel := context.WithTimeout(ctx, time.Second)
		defer cancel()
		models, err := fetchModels(probe, s)
		if err != nil {
			info.Detail = "Not running"
			info.FixCommand = "ollama serve"
			break
		}
		info.Available = true
		info.SignedIn = true
		info.Models = models
		if len(models) == 0 {
			info.Detail = "No models yet"
			info.FixCommand = "ollama pull qwen3"
		} else {
			info.DefaultModel = models[0]
		}
	case EngineOpenAI, EngineAnthropic:
		info.Kind = KindApi
		info.NeedsKey = true
		info.SecretName = apiKeySecretName(s.engine, s.base)
		info.HasKey = apiKey(s) != ""
		info.Available = info.HasKey || (s.engine == EngineOpenAI && localBase(s.base))
		info.SignedIn = info.Available
		if s.engine == EngineAnthropic {
			info.DefaultModel = "claude-haiku-5-5"
		} else if baseHost(s.base) == "api.openai.com" {
			info.DefaultModel = "gpt-5.5"
		}
		if !info.Available {
			info.Detail = "API key required"
		}
	}
	if cacheable && ctx.Err() == nil {
		cacheDetection(key, info)
	}
	return info
}

func GetStatus(ctx context.Context, refresh bool) wshrpc.CommandAiStatus {
	selected := resolveSettings(wshrpc.CommandAiRequest{})
	if refresh {
		resolvePath(true)
	} else {
		resolvePath(false)
	}
	ids := []string{EngineCodex, EngineClaude, EngineOllama, EngineOpenAI, EngineAnthropic}
	result := wshrpc.CommandAiStatus{Enabled: selected.config.Settings.TermCommandComposer, Engine: selected.engine, Engines: make([]wshrpc.CommandAiEngineInfo, len(ids))}
	var wg sync.WaitGroup
	for i, id := range ids {
		s := resolveSettings(wshrpc.CommandAiRequest{Engine: id})
		wg.Add(1)
		go func() { defer wg.Done(); result.Engines[i] = detectOne(ctx, s, refresh) }()
	}
	wg.Wait()
	for _, info := range result.Engines {
		if info.Id == selected.engine {
			result.Ready = info.Available && info.SignedIn
		}
	}
	if runtime.GOOS == "linux" {
		result.SecretBackend, _ = secretstore.GetLinuxStorageBackend()
	}
	return result
}
