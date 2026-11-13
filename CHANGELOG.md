# Changelog

All notable changes to bento-deck-studio are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-11-13

The first public release of the bento-deck-studio plugin for the GitHub Copilot app and Copilot CLI.

### Added

- `bento-deck-studio` agent that coordinates theme extraction, authoring, building, favicon, site, and review phases with user approval at key decisions.
- Six Agent Skills: `theme-extract`, `deck-author`, `deck-build`, `favicon`, `site-build`, and `deck-qa`.
- Theme extraction from `.pptx` and `.potx` files: theme colors through each master's color map, fonts, slide size, dark and light master variants, layout placeholders with geometry and text styles, decorative shapes, and candidate image assets.
- Native, editable bento decks built on the source's own cover, content, section, statement, and closing layouts, with `<!-- layout: -->` and `<!-- notes: -->` outline hints.
- PowerPoint-calibrated typography from embedded font metrics, grouped per-paragraph bodies (`--single-body` to opt out), and overflow growth around the placeholder anchor.
- License-aware font embedding from `--fonts` folders, open-licensed system fonts, and Google Fonts, with fallback reporting.
- Signed Bento Slides shell verification (ECDSA manifest signature and SHA-256) with an offline cache.
- Launch (default) and full companion site tiers. Full sites put **Slides ↗** first in the top menu and open a read-only deck in a new tab.
- Favicons from a supplied SVG, PNG, JPEG, or WebP image, or a theme-colored monogram.
- `validate.mjs` checks for plugin manifests, bento documents, and generated sites.
- Narrated demo video with the open Kokoro-82M voice and timed captions.
- Project website at <https://arilivigni.github.io/bento-deck-studio/>, with a showcase deck built by the plugin, documentation, and release notes.
- Release automation: version checks, a plugin zip with `SHA256SUMS`, and build provenance attestations.
- A security policy with private vulnerability reporting.

[Unreleased]: https://github.com/arilivigni/bento-deck-studio/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/arilivigni/bento-deck-studio/releases/tag/v1.0.0
