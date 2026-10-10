# Preview Screenshot Gate

Date: 2026-06-27

Run:

```sh
task visual:preview
```

Screenshots are written to `artifacts/visual-qa`.

## Covered Previews

- `commandpalette`: grouped commands, keycaps, search and the narrow layout.
- `transfer-queue`: full and compact transfer queue states across running, queued, failed, canceled, and completed jobs.
- `processviewer`: process table, status strip, sort state and narrow viewport sizing (it opens as the Host view's Processes tab).
- `host`: Host overview for an 8-GPU SSH host with live mock sysinfo events, and the Ports tab with named services, forwards and folded system listeners.
- `web`: Electron webview fallback with URL chrome and placeholder content.
- `onboarding`: welcome card, the four tour pages and the 1.0 upgrade card.
- `settings`: Settings → General at desktop and narrow widths.
- `files-directory`: the Files table with kinds, sizes and dates, and narrow-width column dropping.
- `files-upload-drop`: file table with active upload drop affordance.

## Automated Checks

- Required text is visible for every preview.
- React error boundary text is absent.
- Browser console errors and page errors fail the run.
- Document-level horizontal overflow fails the run.
- Screenshots must contain enough visible, non-background pixels to reject blank or monochrome output.

## Evidence Files

Each preview is captured at desktop and narrow widths:

```text
artifacts/visual-qa/<preview>-desktop.png
artifacts/visual-qa/<preview>-narrow.png
```
