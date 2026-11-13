---
name: deck-build
description: Build a self-contained editable bento slide file using a verified Bento shell, theme tokens, content, and optional favicon.
---

# Build a bento deck

Use `scripts/deck-build.mjs` to build a standalone `.bento.html`. It fetches the signed Bento Slides manifest, verifies the pinned ECDSA signature and shell SHA-256, then splices a valid `bento/slides` document into the shell. A previously verified local cache is used only when network access fails.

- Keep all generated content in the user-selected output directory.
- Escape `<` in the embedded JSON and verify that the document reads back identically.
- For a new deck, do not mint `docId` or collaboration credentials. For an existing deck being restyled, preserve its `docId`.
- Build editable text and shapes rather than rasterized slides.
- Match the source: content goes onto the theme's own layouts with source geometry, theme color references, embedded licence-permitted fonts, and PowerPoint-calibrated line placement and spacing. Pick a master with `--variant dark|light|N|name` and a layout per slide with `<!-- layout: name -->` under a heading.
- Font options: `--fonts dir[,dir]` adds licensed font folders, `--no-font-download` skips Google Fonts (open-licensed only), and `--no-fonts` skips embedding. Report every "Font not embedded" line to the user.
- Spaced, wrapped bodies become grouped per-paragraph text boxes so gaps match PowerPoint; use `--single-body` when the user wants one editable box. Overflowing placeholders grow around their anchor, and long sections paginate.
- A custom icon is embedded in the deck shell; Bento may replace the document title during save, so validate the saved title/icon behavior in a browser before making durability claims.
- Run `node scripts/validate.mjs path/to/deck.bento.html` and perform slide-by-slide browser review. When a PowerPoint rendering (PDF export or screenshots) of the source is available, compare it with the deck at the same size for colors, fonts, and positions.
