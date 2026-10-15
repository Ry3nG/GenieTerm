# Project page

The homepage is buildless HTML, CSS and JavaScript. GitHub Pages publishes `site/` on pushes to `main`.

## Preview

From the repository root:

```sh
python3 -m http.server 58764 --bind 127.0.0.1 --directory site
```

## Product demo

The workspace is an illustrative, browser-rendered demo with sample data. Text and controls use HTML/CSS, the GPU chart uses inline SVG, and the logo uses the repository's SVG artwork.

The four tabs demonstrate durable sessions, host metrics and port forwarding, remote file previews, and reviewing an AI command before inserting it. All interactions stay in the page. No SSH connection or AI request is made.

The product film opens in a keyboard-accessible dialog and pauses on close. Without JavaScript, its link opens the video directly. Downloads and the initial workspace remain available.

## Downloads

The HTML contains links for the last verified stable release. JavaScript refreshes them from GitHub's latest stable release API, with a bounded timeout and repository URL validation. Keep fallback links current when preparing a release. Installation details live in the repository README.

## Verification

With the preview server running:

```sh
node scripts/verify-site.mjs
```

The check covers desktop, narrow and mobile layouts, all four demo interactions, keyboard tab navigation, film dismissal and focus return, the six stable downloads, and the no-JavaScript fallback. Screenshots are saved under `artifacts/site-qa/`. Pass the published homepage URL as the first argument to verify deployment.

Regenerate the social image with `node scripts/generate-site-social.mjs`.
