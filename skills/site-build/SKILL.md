---
name: site-build
description: Create a Pages-ready launch site or an optional multi-section companion site that links to a read-only bento deck.
---

# Build the site

Use `scripts/site-build.mjs`:

```sh
node scripts/site-build.mjs --deck dist/deck.bento.html --out dist/site --tier launch
node scripts/site-build.mjs --deck dist/deck.bento.html --out dist/site --tier full
```

`launch` is the default and creates a single launch page with a favicon and a presentation link. `full` creates a compact companion site with a top menu; the first item is **Slides ↗**, opening `slides/deck.bento.html` in a new tab with `rel="noopener"`. The site copy is `readonly: true` and has speaker notes removed.

The repository includes a GitHub Pages workflow. Never publish without reviewing the rendered site and confirming the correct deck path.
