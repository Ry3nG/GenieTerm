// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package wshremote

import (
	"context"
	"fmt"

	"github.com/Ry3nG/GenieTerm/pkg/wshrpc"
)

func windowsListeningPorts(context.Context) (*wshrpc.ListeningPortsResponse, error) {
	return nil, fmt.Errorf("Windows TCP tables are unavailable on this platform")
}
