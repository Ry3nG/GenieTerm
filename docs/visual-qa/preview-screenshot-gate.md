# Preview Screenshot Gate

Date: 2026-06-27

Run:

```sh
task visual:preview
```

Screenshots are written to `artifacts/visual-qa`.

## Covered Previews

- `gitpanel`: Source Control changes, diff, graph, detached checkout confirmation, empty state, and error state.
- `transfer-queue`: full and compact transfer queue states across running, queued, failed, canceled, and completed jobs.
- `processviewer`: process table, status strip, sort state, process summary, and narrow viewport sizing.
- `sysinfo`: CPU and memory charts with mock WPS updates.
- `web`: Electron webview fallback with URL chrome and placeholder content.
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
