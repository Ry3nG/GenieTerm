# Project page

The GenieTerm project page: plain HTML, CSS and a little JavaScript, no build step.

- `index.html`, `styles.css`, `main.js`: the page. Download links and the version are read from the latest GitHub release when the page loads, and fall back to the releases page.
- `media/`: the films' web encodes and their posters. `.github/workflows/site.yml` deploys the folder to GitHub Pages on every push to `main` that touches `site/`.
- The films come from `film/` (the `Overview` and `Short*` compositions, rendered at 4K into `film/out/master/`). To refresh them, re-encode the masters and commit the result:

  ```sh
  site/encode-media.sh            # film/out/master/*-4k.mp4 → site/media/*.mp4
  ```

Preview locally with `npx vite site`.
