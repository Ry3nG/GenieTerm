// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"github.com/Ry3nG/GenieTerm/pkg/jobcontroller"
)

// shouldAutoReconnectConn decides whether a dropped SSH connection is worth reconnecting
// automatically: something the user still has open depends on it (a terminal/command
// block controller started on it) or a durable job manager is still running there.
func shouldAutoReconnectConn(connName string) bool {
	if hasControllerForConn(connName) {
		return true
	}
	return jobcontroller.HasRunningJobsForConn(connName)
}

func hasControllerForConn(connName string) bool {
	for _, controller := range getAllControllers() {
		if controller.GetConnName() == connName {
			return true
		}
	}
	return false
}
