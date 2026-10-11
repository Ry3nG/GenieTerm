// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package commandai

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var pathCache struct {
	sync.Mutex
	value string
}

var resolvePath = loginPath

func loginPath(refresh bool) string {
	pathCache.Lock()
	defer pathCache.Unlock()
	if pathCache.value != "" && !refresh {
		return pathCache.value
	}
	current := os.Getenv("PATH")
	shellPath := ""
	if runtime.GOOS != "windows" {
		shell := os.Getenv("SHELL")
		if shell == "" {
			shell = "/bin/bash"
			if runtime.GOOS == "darwin" {
				shell = "/bin/zsh"
			}
		}
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()
		out, _, err := runProcess(ctx, shell, []string{"-ilc", `printf "__GTPATH__%s__GTPATH__" "$PATH"`}, "", "", os.Environ())
		if err == nil {
			parts := strings.Split(string(out), "__GTPATH__")
			if len(parts) >= 3 {
				shellPath = parts[1]
			}
		}
	}
	dirs := append(filepath.SplitList(shellPath), filepath.SplitList(current)...)
	home, _ := os.UserHomeDir()
	dirs = append(dirs, "/opt/homebrew/bin", "/usr/local/bin")
	if home != "" {
		for _, dir := range []string{".local/bin", "bin", ".npm-global/bin", ".bun/bin", ".volta/bin", ".cargo/bin", ".claude/local"} {
			dirs = append(dirs, filepath.Join(home, dir))
		}
		nvm, _ := filepath.Glob(filepath.Join(home, ".nvm/versions/node/*/bin"))
		sort.Slice(nvm, func(i, j int) bool { return newerNode(nvm[i], nvm[j]) })
		if len(nvm) > 0 {
			dirs = append(dirs, nvm[0])
		}
	}
	unique := []string{}
	seen := map[string]bool{}
	for _, d := range dirs {
		if d != "" && filepath.IsAbs(d) && !seen[d] {
			unique = append(unique, d)
			seen[d] = true
		}
	}
	pathCache.value = strings.Join(unique, string(os.PathListSeparator))
	return pathCache.value
}

func newerNode(a, b string) bool {
	av := strings.Split(strings.TrimPrefix(filepath.Base(filepath.Dir(a)), "v"), ".")
	bv := strings.Split(strings.TrimPrefix(filepath.Base(filepath.Dir(b)), "v"), ".")
	for i := 0; i < len(av) && i < len(bv); i++ {
		x, _ := strconv.Atoi(av[i])
		y, _ := strconv.Atoi(bv[i])
		if x != y {
			return x > y
		}
	}
	return a > b
}

func lookPath(name string) (string, error) {
	if runtime.GOOS == "windows" {
		return exec.LookPath(name)
	}
	for _, dir := range filepath.SplitList(resolvePath(false)) {
		p := filepath.Join(dir, name)
		if info, err := os.Stat(p); err == nil && !info.IsDir() && info.Mode()&0111 != 0 {
			return p, nil
		}
	}
	return "", exec.ErrNotFound
}

func childEnv() []string {
	var env []string
	for _, s := range os.Environ() {
		if !strings.HasPrefix(s, "PATH=") && !strings.HasPrefix(s, "NO_COLOR=") {
			env = append(env, s)
		}
	}
	return append(env, "PATH="+resolvePath(false), "NO_COLOR=1")
}
