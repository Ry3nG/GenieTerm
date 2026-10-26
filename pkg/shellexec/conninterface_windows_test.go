// Copyright 2026, GenieTerm
// SPDX-License-Identifier: Apache-2.0

package shellexec

import (
	"io"
	"os"
	"os/exec"
	"strconv"
	"testing"
	"time"

	"github.com/Ry3nG/GenieTerm/pkg/util/ptyutil"
	"github.com/creack/pty"
)

func TestWindowsPtyExitStatus(t *testing.T) {
	for _, code := range []int{0, 7} {
		t.Run(strconv.Itoa(code), func(t *testing.T) {
			cmd := exec.Command(os.Args[0], "-test.run=^TestShellExitHelper$", "--", strconv.Itoa(code))
			cmd.Env = append(os.Environ(), "GENIETERM_TEST_SHELL_EXIT=1")
			term, err := ptyutil.StartWithSize(cmd, &pty.Winsize{Rows: 24, Cols: 80})
			if err != nil {
				t.Fatal(err)
			}
			drained := make(chan struct{})
			go func() {
				io.Copy(io.Discard, term)
				close(drained)
			}()
			wrapped := MakeCmdWrap(cmd, term, false)
			select {
			case <-drained:
			case <-time.After(5 * time.Second):
				t.Error("ConPTY output did not close after shell exit")
			}
			assertRetainedWaitResult(t, wrapped, code)
		})
	}
}
