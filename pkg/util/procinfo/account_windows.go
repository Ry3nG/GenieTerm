// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package procinfo

import (
	"context"
	"sync"
	"time"

	"golang.org/x/sys/windows"
)

const (
	windowsUserCacheLimit  = 128
	windowsUserLookupLimit = 4
	windowsUserLookupWait  = 200 * time.Millisecond
	windowsUserCacheTTL    = 5 * time.Minute
	windowsUserFailureTTL  = 15 * time.Second
)

type windowsUserEntry struct {
	ready   chan struct{}
	name    string
	done    bool
	expires time.Time
}

type windowsUserCache struct {
	lock    sync.Mutex
	entries map[string]*windowsUserEntry
	pending int
	resolve func(string) string
}

var windowsUsers = windowsUserCache{resolve: resolveWindowsSID}

func resolveWindowsSID(sidString string) string {
	sid, err := windows.StringToSid(sidString)
	if err != nil {
		return ""
	}
	account, domain, _, err := sid.LookupAccount("")
	if err != nil {
		return ""
	}
	if domain != "" {
		return domain + `\` + account
	}
	return account
}

func (c *windowsUserCache) acquire(key string) (*windowsUserEntry, bool) {
	c.lock.Lock()
	defer c.lock.Unlock()
	now := time.Now()
	for key, entry := range c.entries {
		if entry.done && !now.Before(entry.expires) {
			delete(c.entries, key)
		}
	}
	if entry := c.entries[key]; entry != nil {
		return entry, false
	}
	if c.pending >= windowsUserLookupLimit {
		return nil, false
	}
	if len(c.entries) >= windowsUserCacheLimit {
		for key, entry := range c.entries {
			if entry.done {
				delete(c.entries, key)
				break
			}
		}
	}
	if len(c.entries) >= windowsUserCacheLimit {
		return nil, false
	}
	if c.entries == nil {
		c.entries = make(map[string]*windowsUserEntry)
	}
	entry := &windowsUserEntry{ready: make(chan struct{})}
	c.entries[key] = entry
	c.pending++
	return entry, true
}

func (c *windowsUserCache) complete(entry *windowsUserEntry, name string) {
	c.lock.Lock()
	defer c.lock.Unlock()
	entry.name = name
	entry.done = true
	ttl := windowsUserCacheTTL
	if name == "" {
		ttl = windowsUserFailureTTL
	}
	entry.expires = time.Now().Add(ttl)
	c.pending--
	close(entry.ready)
}

func (c *windowsUserCache) lookup(ctx context.Context, key string) string {
	if ctx.Err() != nil {
		return ""
	}
	entry, start := c.acquire(key)
	if entry == nil {
		return ""
	}
	if !start {
		select {
		case <-entry.ready:
			return entry.name
		default:
			return ""
		}
	}
	// Domain account resolution can block inside Windows without a cancellation API.
	// Bound both outstanding native calls and the sampling caller's wait; other
	// processes with the same pending SID skip the wait until a later sample.
	go func() { c.complete(entry, c.resolve(key)) }()
	ctx, cancel := context.WithTimeout(ctx, windowsUserLookupWait)
	defer cancel()
	select {
	case <-ctx.Done():
		return ""
	case <-entry.ready:
		return entry.name
	}
}

func windowsProcessUser(ctx context.Context, handle windows.Handle) string {
	if ctx.Err() != nil {
		return ""
	}
	var token windows.Token
	if err := windows.OpenProcessToken(handle, windows.TOKEN_QUERY, &token); err != nil {
		return ""
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil {
		return ""
	}
	return windowsUsers.lookup(ctx, user.User.Sid.String())
}
