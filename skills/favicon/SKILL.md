---
name: favicon
description: Choose or create a favicon for a bento deck or companion site using a user asset, an identified template logo, or a theme-colored monogram.
---

# Choose a favicon

Prefer, in order: a user-supplied image; a clearly identified logo asset from the source template; a deterministic monogram SVG using the extracted theme. Never guess a brand mark from arbitrary slide artwork.

The site builder emits `favicon.svg`; it copies a supported user image when supplied. Generated monograms are deterministic and work offline. Tell the user when raster/ICO fallbacks are not produced. Keep any selected asset with the generated site and embed a data URI in the deck shell.
