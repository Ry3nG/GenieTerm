// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"

	"github.com/Ry3nG/GenieTerm/pkg/util/shellutil"
	"github.com/spf13/cobra"
)

var tokenCmd = &cobra.Command{
	Use:    "token [token] [shell-type]",
	Short:  "exchange token for shell initialization script",
	RunE:   tokenCmdRun,
	Hidden: true,
}

func init() {
	rootCmd.AddCommand(tokenCmd)
}

func tokenCmdRun(cmd *cobra.Command, args []string) (rtnErr error) {
	if len(args) != 2 {
		OutputHelpMessage(cmd)
		return fmt.Errorf("genie token requires exactly 2 arguments, got %d", len(args))
	}
	tokenStr, shellType := args[0], args[1]
	if tokenStr == "" || shellType == "" {
		OutputHelpMessage(cmd)
		return fmt.Errorf("genie token requires non-empty arguments")
	}
	rtnData, err := setupRpcClientWithToken(tokenStr)
	if err != nil {
		return fmt.Errorf("error setting up rpc client: %w", err)
	}
	envScriptText, err := shellutil.EncodeEnvVarsForShell(shellType, rtnData.Env)
	if err != nil {
		return fmt.Errorf("error encoding env vars: %w", err)
	}
	WriteStdout("%s\n", envScriptText)
	WriteStdout("%s\n", rtnData.InitScriptText)
	return nil
}
