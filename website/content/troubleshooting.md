---
title: Troubleshooting
description: Fixes for common bento-deck-studio install, build, font, and site problems.
order: 6
---

# Troubleshooting

## The plugin does not appear after install

- Run `copilot plugin list` and confirm `bento-deck-studio` is listed and enabled. Enable it with `copilot plugin enable bento-deck-studio@bento-deck-studio`.
- Start a new Copilot session after installing; running sessions do not pick up new agents and skills.
- If the marketplace was added at an older ref, remove it with `copilot plugin marketplace remove bento-deck-studio` and add it again.

## "Refusing to overwrite existing output"

The builders never replace files. Delete the old deck or site folder, or choose a new `--out` path, then build again.

## The first build fails offline

The first deck build must download and verify the signed Bento shell. Connect once, then later builds reuse the verified cache in `~/.cache/bento-deck-studio`.

## Text uses a different font

The build reports every face it could not embed. Common causes:

- The font is proprietary and does not permit embedding. Supply a licensed copy with `--fonts dir`, or accept the metric-compatible fallback.
- `--no-font-download` or `--no-fonts` was set.
- The font is not installed locally and is not on Google Fonts.

## The layout does not match a slide in my template

- Choose the right master with `--variant dark`, `--variant light`, a variant number, or a master name.
- Pick a layout for a slide with `<!-- layout: name -->` under its heading.
- Check the `report` in `theme.json` for approximated shapes or skipped media. Charts, tables, and SmartArt drawn on layouts are not converted.

## Too much text on a slide

Placeholders grow around their anchor rather than clipping, but dense slides still crowd. Split the content into two slides, or move detail into speaker notes with `<!-- notes: … -->`.

## The favicon disappeared after a bento update

A Bento release self-update can replace the shell that holds the favicon. Rebuild the deck with `--favicon`, or re-run `site-build`, and check the tab icon again.

## `validate.mjs --site` fails

- **"Site deck must be read-only…"**: you copied an editable deck into `slides/`. Rebuild the site with `site-build` instead.
- **"First menu item must be Slides ↗…"**: a hand edit moved or changed the first menu link. It must point to `slides/deck.bento.html` with `target="_blank"` and `rel="noopener"`.

## Still stuck?

Search or open an [issue](https://github.com/arilivigni/bento-deck-studio/issues) with your Node.js version, operating system, the command you ran, and its full output. Do not attach confidential templates.
