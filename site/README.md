# Project page

The homepage is buildless HTML, CSS and JavaScript. GitHub Pages publishes `site/` on pushes to `main`.

## Preview

```sh
python3 -m http.server 58764 --bind 127.0.0.1 --directory site
```

The film is the main visual. Four tabs present the product's interface. Product images open in a scrollable dialog; the video pauses on close. Both have direct links when JavaScript is unavailable.

## Reproduce the interface renders

The website uses self-contained SVG renders with embedded fonts. README images are 3× PNG renders of the same elements. Rendering uses actual product code with illustrative fixtures; the terminal is generated using xterm.js, the app's theme and its connection-status component.

| View       | Source                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------- |
| Terminal   | `frontend/preview/previews/site-terminal.preview.tsx`; xterm.js and `BlockStatusLineContent` |
| Files      | `DirectoryPreview`, through `site-files.preview.tsx`                                         |
| Host       | `HostView`, through `host.preview.tsx`                                                       |
| Command AI | `CommandAiSheet`, through the Fix case in `commandai.preview.tsx`                            |

From the repository root:

```sh
npx vite --config frontend/preview/vite.config.ts --host 127.0.0.1 --port 7007
# In another terminal:
node scripts/render-site-ui.mjs
```

`img/ui/provenance.json` records the source paths, source hashes, output hashes, dimensions and the base commit at generation time. Source hashes identify the exact files, including changes made after that base commit. No live SSH or AI request is needed.

## Downloads and contribution

Static links point to the last verified stable release. JavaScript updates them from GitHub's latest stable release API with a bounded timeout and repository URL validation. Keep fallback links current when preparing a release.

The contribution section links to the guide, issues and roadmap.

## Verification

```sh
node scripts/verify-site.mjs
node scripts/verify-site.mjs https://ry3ng.github.io/GenieTerm/
```

Checks cover desktop and mobile layouts, film placement, interface selection, SVG loading, enlargement, keyboard navigation, terminal states, contribution links, download links and JavaScript/API fallbacks. Screenshots go to `artifacts/site-qa/`.

Regenerate the social image with `node scripts/generate-site-social.mjs`.
