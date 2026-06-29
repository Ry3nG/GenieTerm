// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"testing"

	"github.com/Ry3nG/GenieTerm/pkg/baseds"
)

type testRpcClient struct {
	peerInfo string
}

func (c testRpcClient) GetPeerInfo() string {
	return c.peerInfo
}

func (c testRpcClient) SendRpcMessage(msg []byte, ingressLinkId baseds.LinkId, debugStr string) bool {
	return true
}

func (c testRpcClient) RecvRpcMessage() ([]byte, bool) {
	return nil, false
}

func TestBindRouteLocallyRejectsRouteTakeover(t *testing.T) {
	router := NewWshRouter()
	firstLink := router.RegisterTrustedRouter(testRpcClient{peerInfo: "first"})
	secondLink := router.RegisterTrustedRouter(testRpcClient{peerInfo: "second"})

	if err := router.bindRouteLocally(firstLink, ElectronRoute, false); err != nil {
		t.Fatalf("first route bind failed: %v", err)
	}
	if err := router.bindRouteLocally(secondLink, ElectronRoute, false); err == nil {
		t.Fatalf("expected second link to be rejected when binding existing route")
	}
	if got := router.GetLinkIdForRoute(ElectronRoute); got != firstLink {
		t.Fatalf("route owner changed: got %d, want %d", got, firstLink)
	}
}

func TestBindRouteLocallyAllowsSameLinkReannounce(t *testing.T) {
	router := NewWshRouter()
	linkId := router.RegisterTrustedRouter(testRpcClient{peerInfo: "router"})

	if err := router.bindRouteLocally(linkId, ElectronRoute, false); err != nil {
		t.Fatalf("first route bind failed: %v", err)
	}
	if err := router.bindRouteLocally(linkId, ElectronRoute, false); err != nil {
		t.Fatalf("same link route reannounce failed: %v", err)
	}
}
