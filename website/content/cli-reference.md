---
title: Script reference
description: Options for the dependency-free theme-extract, deck-build, site-build, validate, and create-demo scripts.
order: 4
---

# Script reference

The agent calls these scripts for you, but you can run them directly. They need Node.js 20 or later and use built-in modules only.

## theme-extract

```sh
node scripts/theme-extract.mjs <template.pptx|template.potx> --out theme.json [--assets-out dir]
```

| Option | Effect |
| --- | --- |
| `--out` | Where to write the theme JSON. Required. |
| `--assets-out` | Also copy candidate images (logos, backgrounds) into this folder for review. |

The source file is only read, never changed.

## deck-build

```sh
node scripts/deck-build.mjs --theme theme.json --content outline.md --out deck.bento.html [options]
```

| Option | Effect |
| --- | --- |
| `--variant dark\|light\|N\|name` | Choose a slide master. Defaults to the template's first variant. |
| `--favicon file` | Use an SVG, PNG, JPEG, or WebP image as the deck's tab icon. |
| `--fonts dir[,dir]` | Extra folders of licensed fonts to embed. Each font's embedding permission is checked. |
| `--no-font-download` | Embed local fonts only; do not fetch open-licensed fonts from Google Fonts. |
| `--no-fonts` | Do not embed fonts; viewers see the fallback stack. |
| `--single-body` | Keep a spaced, multi-paragraph body as one text box. |

The build fetches the current signed Bento Slides shell, verifies its manifest signature and SHA-256, and caches it under `~/.cache/bento-deck-studio` (or `$XDG_CACHE_HOME`).

### Outline format

```md
# Deck title
Subtitle for the cover slide.

## A content slide
- One bullet per line
- Inline **bold**, *italic*, and `code` work

## A statement slide
<!-- layout: statement -->
<!-- notes: Speaker notes for this slide. -->

## Section divider

## Thank you
```

- `#` sets the deck title; text before the first `##` becomes the cover subtitle.
- Each `##` heading starts a slide. Bulleted and numbered lists are kept.
- A `##` heading with no content becomes a section slide. When it is the last slide and titled "Thank you", "Thanks", "Questions", "Q&A", or "The end", it uses the closing layout.
- `<!-- layout: name -->` picks a layout: `cover`, `content`, `section`, `statement`, `closing`, or a source layout name.
- `<!-- notes: … -->` adds speaker notes.

## site-build

```sh
node scripts/site-build.mjs --deck deck.bento.html --out site [--tier launch|full] [--favicon file]
```

| Option | Effect |
| --- | --- |
| `--tier launch` | One-page launch site (default). |
| `--tier full` | Companion site with **Slides ↗** first in the top menu. |
| `--favicon file` | Use this image instead of the deck's own icon or a generated monogram. |

The script refuses to overwrite existing output. Delete the old files first.

## validate

```sh
node scripts/validate.mjs .                     # plugin manifests and skills
node scripts/validate.mjs deck.bento.html       # one bento document
node scripts/validate.mjs site --site           # a generated site and its deck
```

## create-demo

```sh
node scripts/create-demo.mjs [--engine auto|kokoro|say] [--voice 21] [--pace 1.15]
```

Renders the narrated project walkthrough in `media/` with the open Kokoro-82M voice through sherpa-onnx, or falls back to macOS `say`. It needs `ffmpeg` and macOS `sips`. See the [README](https://github.com/arilivigni/bento-deck-studio#project-demo-video) for setup.

## Website and release scripts

These maintain this project rather than your decks:

```sh
node scripts/website-build.mjs --out _site      # build this website
node scripts/release.mjs check 1.0.0            # verify versions, changelog, and tag readiness
node scripts/release.mjs notes 1.0.0            # print release notes from CHANGELOG.md
```

See the [release process](release-process.md).
