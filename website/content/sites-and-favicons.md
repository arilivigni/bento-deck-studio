---
title: Sites and favicons
description: Share a bento deck as a one-page launch site, a full companion site, or the deck alone, with a favicon from your image or theme.
order: 3
---

# Sites and favicons

A bento deck is a single self-contained `.bento.html` file. bento-deck-studio can wrap it in a small static site that works on GitHub Pages, any static host, or straight from disk.

## Choose an output

| Output | What you get | When to use it |
| --- | --- | --- |
| **Launch** (default) | A one-page site with a **Launch the slides** button. | Share a talk or a link in an invitation. |
| **Full** | A multi-section companion site with a top menu. **Slides ↗** is the first menu item and opens the deck in a new tab. | A workshop or project that needs a home page around the slides. |
| **Deck only** | Just the `.bento.html` file. | Present locally or share the file itself. |

```sh
node scripts/site-build.mjs --deck dist/deck.bento.html --out dist/site
node scripts/site-build.mjs --deck dist/deck.bento.html --out dist/full --tier full
```

Both tiers publish `slides/deck.bento.html` as a **read-only** copy. The build removes speaker notes and any collaboration credentials, so it is safe to post publicly. Keep the editable original elsewhere.

This website is itself a full site: **Slides ↗** at the top opens the [showcase deck](../slides/deck.bento.html), and it passes the same `validate.mjs --site` checks.

## Favicons

The favicon appears in browser tabs for both the site and the deck. Choose one of these:

- **Your image:** pass `--favicon mark.svg` to `deck-build` or `site-build`. SVG, PNG, JPEG, and WebP are supported. SVGs with scripts, event handlers, or external references are rejected.
- **A template logo:** the extractor lists `logoCandidates`. The agent only uses one when its identity is clear, and asks first.
- **A monogram:** by default the build draws the first letter of the deck title in the theme's own colors.

The favicon is spliced into the deck's Bento shell. Saving inside bento keeps it, but a Bento release self-update may replace the shell. Check the favicon again after an update.

## Publish on GitHub Pages

Build into a folder, commit it, and deploy it with GitHub Actions:

```yaml
name: Deploy slides
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/configure-pages@v6
      - uses: actions/upload-pages-artifact@v5
        with:
          path: site
      - id: deployment
        uses: actions/deploy-pages@v5
```

Set **Settings → Pages → Source** to **GitHub Actions** before the first run.

## Check before you share

```sh
node scripts/validate.mjs dist/site --site
```

The validator confirms the page title and favicon link, that the deck is read-only with no notes or collaboration keys, and (for full sites) that the first menu item is **Slides ↗** opening in a new tab with `rel="noopener"`. Structural checks do not replace a visual review: open every slide and click through the menu.
