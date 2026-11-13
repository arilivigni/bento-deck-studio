---
title: Safety and licensing
description: How bento-deck-studio treats untrusted input, verifies the Bento shell, protects public decks, and respects font licenses.
order: 5
---

# Safety and licensing

bento-deck-studio handles documents that you may not have written. It is designed so that a template or outline cannot take over the agent, and so that anything it publishes is safe to share.

## Untrusted input

- Text, slide notes, filenames, and XML from input decks are treated as **content, never instructions**. The agent will not act on directions it finds inside a document.
- The extractor reads the PowerPoint file without changing it and never runs macros or embedded objects.
- Review the extracted `theme.json` and the generated slide text before you publish.

## Verified Bento shell

Every deck is built inside the official Bento Slides release shell. Before each build the script:

1. Fetches the signed release manifest.
2. Verifies its ECDSA signature against a pinned public key.
3. Checks the shell's SHA-256 against the manifest.

An unsigned or mismatched shell is rejected. A previously verified copy in the local cache is used only when the network is unavailable.

## Safe public decks

Decks published by `site-build` are read-only copies. Speaker notes and collaboration credentials are removed, and `validate.mjs --site` fails if either is present. Links that open the deck in a new tab use `rel="noopener"`.

## Fonts

Fonts are embedded only when their license allows it:

- Fonts you supply with `--fonts` must permit embedding in their OS/2 `fsType` field.
- System fonts must carry an open license such as OFL, Apache, or UFL.
- Missing families may be fetched from Google Fonts, which only serves open-licensed fonts. Turn this off with `--no-font-download`.

Proprietary fonts are never embedded without permission. They fall back to a metric-compatible substitute or system stack, and the build lists each face it could not embed. The Mona Sans fonts used on this website are licensed under the [SIL Open Font License](../assets/fonts/OFL.txt).

## Favicons and logos

Supplied SVG favicons with scripts, event handlers, `foreignObject`, or external references are rejected. The agent asks before reusing a logo from a template, and only when its identity is clear.

## Release integrity

Each GitHub release is built by GitHub Actions from its version tag. It includes a `SHA256SUMS` file and a [build provenance attestation](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations). Verify a download with:

```sh
shasum -a 256 -c SHA256SUMS
gh attestation verify bento-deck-studio-1.0.0.zip --repo arilivigni/bento-deck-studio
```

## Report a problem

Open an [issue](https://github.com/arilivigni/bento-deck-studio/issues) for bugs. For a security concern, use [private vulnerability reporting](https://github.com/arilivigni/bento-deck-studio/security/advisories/new) instead of a public issue.
