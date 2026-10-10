# Preview Interaction Gate

Date: 2026-06-27

Run:

```sh
task interaction:preview
```

This gate uses Playwright against the standalone preview server. It is a fast baseline interaction gate, not a replacement for installed-app QA.

## Covered Interactions

- Preview index navigation to and from a named preview.
- Transfer queue keyboard smoke and status visibility.
- Host: GPU cards render, system listeners fold under Other listeners and expand, Forward & open turns a row into Open with its local address, the Forward a port form validates input, and the Processes tab shows the process list.
- Files upload drop affordance pointer smoke and file-table visibility.

## Safety Boundary

Port forwarding runs against mocked RPCs here. Real forwarding is covered by the Go integration tests in `pkg/remote/portforward` (a real SSH client against an in-process SSH server) and by the installed-app gate.

## Failure Conditions

- Required interaction target is missing or not visible.
- Expected state transition does not happen.
- React error boundary text appears.
- Browser console errors or page errors occur.
