---
name: deck-qa
description: Verify a generated bento deck and site structurally and visually, including every slide and the Pages navigation.
---

# Verify the output

1. Run `node scripts/validate.mjs` on every generated deck.
2. Open the deck in a real browser and review every slide at presentation size. Check clipping, contrast, font fallback, image loading, and visual rhythm. When the source PowerPoint can be rendered, compare matching slides side by side for colors, typefaces, and text and shape positions.
3. For the launch tier, verify the presentation link launches the deck. For the full tier, verify the first top-menu item is **Slides ↗**, opens a new tab, and the deck copy is read-only with no notes.
4. Check favicon/title in the browser and after a save round-trip. Report limitations if Bento updates the shell.
5. Validate site links, mobile layout, and deployment workflow. Do not claim a browser or Pages deployment check unless it actually ran.
6. Verify the narrated project demo plays, captions are readable, and runtime is approximately 90 seconds.
