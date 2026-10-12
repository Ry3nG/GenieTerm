# Project page

The GenieTerm project page: plain HTML, CSS and a little JavaScript, no build step.

- `index.html`, `styles.css`, `main.js`: the page. Download links and the version are read from the latest GitHub release when the page loads, and fall back to the releases page.
- `media/`: posters (in git) and the films (not in git). The web encodes of the films are assets of the `site-media` release; `.github/workflows/site.yml` downloads them and deploys the folder to GitHub Pages.
- The films come from `film/` (`npx remotion render … Overview` and the `Short*` compositions). To refresh them, encode the masters for the web and replace the release assets:

  ```sh
  site/encode-media.sh            # film/out/master/*.mp4 → site/media/*.mp4
  gh release upload site-media site/media/*.mp4 --clobber
  ```

Preview locally with `npx vite site`.
