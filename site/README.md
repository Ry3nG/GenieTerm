# Project page

The GenieTerm homepage is buildless HTML, CSS and JavaScript. `index.html` loads `home.css` and `home.js`. GitHub Pages publishes `site/` when its files change on `main`.

Preview with `python3 -m http.server 58764 --bind 127.0.0.1 --directory site` from the repository root.

## Film

The full product film leads the homepage. Its poster and the hero action open a keyboard-accessible video dialog. Closing the dialog pauses playback. The video uses native controls and loads on demand.

## Product views

The galleries display real application components with illustrative data. Their images support an accessible full-size dialog. The session, port and command examples run locally in the browser and make no SSH or AI requests.

- `img/host-overview.png`: the repository's Host screenshot in `assets/screenshots/host.png`.
- `img/host-detail.jpg` and `img/host-ports.jpg`: the Host component preview at `/?preview=host&hostheight=700`.
- `img/command-ai.jpg`: the Fix case at `/?preview=commandai`.
- `img/files.jpg`: the curated project fixture at `/?preview=site-files`.

Run the component preview with `npx vite --config frontend/preview/vite.config.ts --host 127.0.0.1 --port 7007`. Capture the component boundaries, excluding the preview server's navigation. Keep sample accounts and paths in published captures.

Regenerate the share image with `node scripts/generate-site-social.mjs`.

## Downloads and checks

The HTML contains working downloads for the last verified stable release. The page refreshes them from GitHub's latest release API, with a bounded timeout and validated repository URLs. Keep the HTML fallback version and links current when preparing a release. Windows links to prereleases.

Check desktop and narrow layouts, gallery switching and enlargement, Escape and focus return, the three session states, port-example reset, Command AI examples and insertion, disclosure controls, and all six platform download links. The content and download links remain available with JavaScript disabled; respect reduced-motion preferences.
