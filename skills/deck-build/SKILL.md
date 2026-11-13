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
- A custom icon is embedded in the deck shell; Bento may replace the document title during save, so validate the saved title/icon behavior in a browser before making durability claims.
- Run `node scripts/validate.mjs path/to/deck.bento.html` and perform slide-by-slide browser review.
