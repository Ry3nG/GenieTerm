# Project page

The landing page is HTML, CSS and JavaScript. Host and Command AI mount the product's React components in isolated frames. GitHub Pages builds these with `npm run site:build` before publishing `site/`.

## Preview

```sh
npm run site:build
python3 -m http.server 58764 --bind 127.0.0.1 --directory site
```

The film plays inline with native controls. Terminal shows two generated states side by side; Files is a fixed render. Host supports its native navigation, metrics, process table and ports. Command AI supports Write, Fix and Explain with local responses, then inserts the result into an xterm prompt.

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
node scripts/verify-site-renders.mjs
```

`img/ui/provenance.json` records the source paths, source hashes, output hashes, dimensions and the base commit at generation time. Source hashes identify the exact files, including changes made after that base commit. No live SSH or AI request is needed.

## Downloads and contribution

Static links point to the last verified stable release. JavaScript updates them from GitHub's latest stable release API with a bounded timeout and repository URL validation. Keep fallback links current when preparing a release.

The contribution section links to the guide and issues.

The landing page uses the terminal view initially; Host and Command AI load on selection. Both interactive frames reuse the site's compact WOFF2 fonts. Rebuild these from the product's fonts with `python scripts/subset-site-fonts.py` after installing `fonttools[woff]` in a development environment. The GitHub mark is from Primer Octicons; its license is in `img/github-mark.LICENSE.txt`.

## Verification

```sh
node scripts/verify-site.mjs
node scripts/verify-site.mjs https://ry3ng.github.io/GenieTerm/
```

Checks cover desktop and mobile layouts, inline playback, interface selection, terminal comparison, Host navigation, Command AI interactions, keyboard navigation, downloads and JavaScript/API fallbacks. Screenshots go to `artifacts/site-qa/`.

Regenerate the social image with `node scripts/generate-site-social.mjs`.
