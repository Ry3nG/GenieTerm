# Preview Interaction Gate

Date: 2026-06-27

Run:

```sh
task interaction:preview
```

This gate uses Playwright against the standalone preview server. It is a fast baseline interaction gate, not a replacement for installed-app QA.

## Covered Interactions

- Preview index navigation to and from a named preview.
- GitPanel changes-to-graph tab switching.
- GitPanel graph filtering, empty filtered state, and filter reset.
- GitPanel detached-checkout warning cancellation.
- GitPanel uncommitted-changes row switching back to changes.
- Transfer queue keyboard smoke and status visibility.
- Files upload drop affordance pointer smoke and file-table visibility.

## Safety Boundary

The gate intentionally avoids mutating Git actions such as stage, commit, checkout, pull, push, and fetch. Those flows need RPC-level parameter assertions or installed-app tests with disposable repositories before they can be automated safely.

## Failure Conditions

- Required interaction target is missing or not visible.
- Expected state transition does not happen.
- React error boundary text appears.
- Browser console errors or page errors occur.
