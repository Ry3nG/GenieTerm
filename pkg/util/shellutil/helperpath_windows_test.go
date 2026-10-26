// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/wavebase"
)

const helperSwapToken = "test token 用户 O'Brien"

func TestMain(m *testing.M) {
	if os.Getenv("GENIETERM_TEST_LONG_HELPER") == "1" {
		if len(os.Args) < 2 {
			os.Exit(90)
		}
		switch os.Args[1] {
		case "token":
			if !reflect.DeepEqual(os.Args[1:], []string{"token", helperSwapToken, "pwsh"}) {
				os.Exit(93)
			}
			fmt.Printf("$env:GENIETERM_TEST_TOKEN = 'ready'\n$env:GENIETERM_TEST_TOKEN_VALUE = '用户 O''Brien'\n")
		case "completion":
			if !reflect.DeepEqual(os.Args[1:], []string{"completion", "powershell"}) {
				os.Exit(94)
			}
			fmt.Printf("$env:GENIETERM_TEST_COMPLETION = 'ready'\n")
		default:
			if !reflect.DeepEqual(os.Args[1:], []string{"check", "用户 O'Brien"}) {
				os.Exit(95)
			}
			os.Exit(7)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func TestPowerShellLongHelperPath(t *testing.T) {
	cacheRoot := filepath.Join(t.TempDir(), "用户 O'Brien cache")
	t.Setenv("LOCALAPPDATA", cacheRoot)
	oldAppPath, oldDataHome := wavebase.AppPath_VarCache, wavebase.DataHome_VarCache
	t.Cleanup(func() { wavebase.AppPath_VarCache, wavebase.DataHome_VarCache = oldAppPath, oldDataHome })
	wavebase.AppPath_VarCache = t.TempDir()
	if err := os.MkdirAll(wavebase.GetWaveAppBinPath(), 0700); err != nil {
		t.Fatal(err)
	}
	program, err := os.ReadFile(os.Args[0])
	if err != nil {
		t.Fatal(err)
	}
	artifactPath, err := GetLocalGenieBinaryPath(wavebase.WaveVersion, "windows", runtime.GOARCH)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(artifactPath, program, 0700); err != nil {
		t.Fatal(err)
	}
	for _, profile := range []string{"normal", "long"} {
		t.Run(profile, func(t *testing.T) {
			home := filepath.Join(t.TempDir(), "用户 O'Brien profile")
			if profile == "long" {
				for range 6 {
					home = filepath.Join(home, strings.Repeat("long-path-", 6))
				}
			}
			wavebase.DataHome_VarCache = home
			bin, err := getLocalHelperBinDir(home)
			if err != nil {
				t.Fatal(err)
			}
			for _, dir := range []string{bin, filepath.Join(home, ZshIntegrationDir), filepath.Join(home, BashIntegrationDir), filepath.Join(home, FishIntegrationDir), filepath.Join(home, PwshIntegrationDir)} {
				if err := os.MkdirAll(dir, 0700); err != nil {
					t.Fatal(err)
				}
			}
			if err := initCustomShellStartupFilesInternal(); err != nil {
				t.Fatal(err)
			}
			if profile == "normal" && bin != filepath.Join(home, "bin") {
				t.Fatal("normal profile moved its helper directory")
			}
			if profile == "long" && !strings.HasPrefix(bin, cacheRoot+string(os.PathSeparator)) {
				t.Fatalf("long profile did not use the isolated cache: %s", bin)
			}
			if got := WaveshellLocalEnvVars("")["WAVETERM_WSHBINDIR"]; got != bin {
				t.Fatalf("helper environment directory differs: %s != %s", got, bin)
			}
			verification := "\nif ($env:GENIETERM_TEST_TOKEN -ne 'ready' -or $env:GENIETERM_TEST_COMPLETION -ne 'ready' -or $env:GENIETERM_TEST_TOKEN_VALUE -ne \"用户 O'Brien\") { exit 91 }; " +
				"genie check \"用户 O'Brien\"; if ($LASTEXITCODE -ne 7) { exit 92 }; " +
				"wsh check \"用户 O'Brien\"; if ($LASTEXITCODE -ne 7) { exit 96 }; exit 0\n"
			scriptFile, err := os.OpenFile(GetLocalWavePowershellEnv(), os.O_APPEND|os.O_WRONLY, 0)
			if err != nil {
				t.Fatal(err)
			}
			_, err = scriptFile.WriteString(verification)
			scriptFile.Close()
			if err != nil {
				t.Fatal(err)
			}
			for _, shell := range []string{"powershell.exe", "pwsh.exe"} {
				t.Run(shell, func(t *testing.T) {
					if _, err := exec.LookPath(shell); err != nil {
						if shell == "powershell.exe" {
							t.Fatal(err)
						}
						t.Skip("PowerShell 7 is not installed")
					}
					ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
					defer cancel()
					cmd := exec.CommandContext(ctx, shell, "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", GetLocalWavePowershellEnv())
					cmd.Env = append(os.Environ(), "GENIETERM_TEST_LONG_HELPER=1", "WAVETERM_SWAPTOKEN="+helperSwapToken)
					if output, err := cmd.CombinedOutput(); err != nil {
						t.Fatalf("helper bootstrap and invocation failed: %v\n%s", err, output)
					}
				})
			}
		})
	}
}

func TestWindowsHelperCacheIsolationAndLimits(t *testing.T) {
	t.Setenv("LOCALAPPDATA", t.TempDir())
	home := filepath.Join(t.TempDir(), strings.Repeat("a", 250))
	first, err := getLocalHelperBinDir(home)
	if err != nil {
		t.Fatal(err)
	}
	other, err := getLocalHelperBinDir(home + "other")
	if err != nil || first == other {
		t.Fatalf("profiles share helper cache: %s / %s (%v)", first, other, err)
	}
	version := wavebase.WaveVersion
	t.Cleanup(func() { wavebase.WaveVersion = version })
	wavebase.WaveVersion = "test-next"
	nextVersion, err := getLocalHelperBinDir(home)
	if err != nil || nextVersion == first {
		t.Fatalf("versions share helper cache: %s / %s (%v)", first, nextVersion, err)
	}
	t.Setenv("LOCALAPPDATA", home)
	if _, err := getLocalHelperBinDir(home); err == nil {
		t.Fatal("unlaunchable cache directory accepted")
	}
}
