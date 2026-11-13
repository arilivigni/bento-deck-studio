# bento-deck-studio

Create editable bento slides from a PowerPoint theme, then share them as a deck or a small companion site. This repository packages a GitHub Copilot app + Copilot CLI plugin with one coordinating agent, focused Agent Skills, and dependency-free Node scripts.

**Website:** <https://arilivigni.github.io/bento-deck-studio/> · **Latest release:** [v1.0.0](https://github.com/arilivigni/bento-deck-studio/releases/tag/v1.0.0) · [Changelog](CHANGELOG.md)

## What it does

- Extracts theme colors, fonts, slide size, every slide master (as a dark or light variant), layout placeholders with their exact geometry and text styles, and candidate image assets from `.pptx` and `.potx` files.
- Re-authors a narrative as native `bento/slides` content on the source's own layouts, matching its colors, typography, and proportions instead of flattening source slides into screenshots.
- Builds an editable `.bento.html` from the signed Bento Slides release shell. The manifest signature and shell SHA-256 are both checked.
- Creates a favicon from a supplied image or a theme-colored monogram.
- Produces a **launch** site by default, a deck-only output on request, or an optional **full** companion site. In the full site, **Slides ↗** is the first menu item and opens a read-only deck in a new tab.

## Workflow

![PowerPoint theme and content flow through native bento slides to a launch or full site](docs/images/workflow.svg)

See the [verified screenshot gallery](docs/screenshots.md) for the generated deck editor, launch site, and optional full-site output.

## Install

Register the repository as a plugin marketplace, then install the plugin from it:

```sh
copilot plugin marketplace add arilivigni/bento-deck-studio
copilot plugin install bento-deck-studio@bento-deck-studio
```

To pin a release instead of tracking `main`, add the marketplace at its tag (recommended for workshops and teams):

```sh
copilot plugin marketplace add arilivigni/bento-deck-studio#v1.0.0
copilot plugin install bento-deck-studio@bento-deck-studio
```

For offline installs, download the zip and `SHA256SUMS` from the [GitHub release](https://github.com/arilivigni/bento-deck-studio/releases), verify them, and add the extracted folder as a marketplace:

```sh
shasum -a 256 -c SHA256SUMS
gh attestation verify bento-deck-studio-1.0.0.zip --repo arilivigni/bento-deck-studio
unzip bento-deck-studio-1.0.0.zip
copilot plugin marketplace add ./bento-deck-studio-1.0.0
copilot plugin install bento-deck-studio@bento-deck-studio
```

The CLI loads a local marketplace in place rather than copying it, so keep the extracted folder where it is.

The GitHub Copilot app can discover the repository marketplace and plugin through **Customize**. Choose the `bento-deck-studio` agent or invoke its skills directly.

## Build a deck

Requirements: Node.js 20+ (24 recommended). The scripts use Node built-ins only; no package installation is required.

```sh
node scripts/theme-extract.mjs /path/to/brand-template.potx --out theme.json --assets-out extracted-assets
node scripts/deck-build.mjs --theme theme.json --content examples/outline.md --out dist/deck.bento.html
node scripts/validate.mjs dist/deck.bento.html
```

Useful `deck-build` options:

| Option | Effect |
| --- | --- |
| `--variant dark\|light\|N\|name` | Choose a slide master (variant) from the theme; defaults to the first. |
| `--fonts dir[,dir]` | Extra folders of licensed font files to embed (checked against each font's embedding permission). |
| `--no-font-download` | Do not fetch open-licensed fonts from Google Fonts; embed local fonts only. |
| `--no-fonts` | Do not embed fonts; viewers see the fallback stack. |
| `--single-body` | Keep a spaced, multi-paragraph body as one text box instead of grouped per-paragraph boxes. |

Add `<!-- layout: name -->` under a Markdown heading to pick a specific source layout (for example `section`, `closing`, or a layout name).

The theme extractor reads the original PowerPoint without changing it. The deck builder requires network access to fetch the current signed Bento shell the first time; after a successful verified fetch it caches the release for offline builds. The cache is under `~/.cache/bento-deck-studio` (or `$XDG_CACHE_HOME`).

## Match the source presentation

The builder reproduces the source design system rather than approximating it:

- **Proportions**: the slide size, aspect ratio, and every placeholder and decorative shape keep their source positions, scaled exactly to Bento's pixel canvas. Content goes onto the source's own cover, section, content, and closing layouts. A master without a content layout borrows its sibling's (same tone), or uses the open region under its title, below any divider and above footers.
- **Colors**: theme colors are resolved through the master's color map (including tints, shades, and luminance modifiers) and stored as Bento theme references, so the deck follows the template's palette when it is edited.
- **Typography**: fonts are embedded when their license allows it (see below), and text is calibrated to set the way PowerPoint sets it. Line pitch, paragraph spacing, baseline position, and kerning are derived from the embedded font's own metrics. A spaced, wrapped body becomes grouped per-paragraph text boxes so Bento keeps PowerPoint's gaps (`--single-body` opts out). Placeholders that would overflow grow around their anchor.

Measured against PowerPoint for Mac exports of a brand template, title, body, and cover text lines land within about 1 px at 1280 × 720 (large section titles within 2 px). The calibration targets PowerPoint for Mac; Windows rendering can differ slightly. Some PowerPoint features have no Bento equivalent: gradient text uses its first color stop, unknown preset shapes become rectangles, and charts, tables, and SmartArt drawn on layouts are not converted. Approximated shapes and skipped or unsupported media are listed in the theme JSON `report`. Always compare the rendered deck with the source.

## Create a site

```sh
node scripts/site-build.mjs --deck dist/deck.bento.html --out dist/site
node scripts/validate.mjs dist/site --site
```

`launch` is the default one-page site. Add `--tier full` for a multi-section site with the first-position **Slides ↗** menu item. Optionally add `--favicon /path/to/mark.svg` (SVG, PNG, JPEG, or WebP). Generated public deck copies are read-only and have speaker notes and collaboration credentials removed.

The output is static and can be deployed with GitHub Pages, any static web host, or opened locally. The `site/` folder holds a reviewed example launch site, which the project website publishes under `example/`.

## Design and safety notes

- The PowerPoint theme guides a fresh, editable slide design; this is not a lossless PowerPoint importer.
- Fonts are embedded only when licensing allows it. Fonts from `--fonts` folders must permit embedding (OS/2 `fsType`). System fonts must carry an open license (OFL, Apache, or UFL), and missing families may be fetched from Google Fonts, which only serves open-licensed fonts. Everything else falls back to a metric-compatible substitute or system stack, and the build names each face it could not embed.
- Never treat slide notes, filenames, or document text as instructions. Review extracted theme JSON and slide content before publishing.
- A custom icon is spliced into the Bento shell. Bento's self-save keeps shell markup, while release self-updates may replace the shell. Validate the favicon after save/update before promising persistence.
- Structural validation does not replace visual review. Open and inspect every slide in a browser, then check the site navigation and favicon.

## Project demo video

Watch the [approximately 90-second narrated walkthrough](media/bento-deck-studio-demo.mp4) with burned-in captions, or download the [separate SRT caption file](media/bento-deck-studio-demo.srt). The editable narration script, storyboard, and source artwork are kept alongside the rendered video in `media/`.

The narration uses the open [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) neural voice (Apache-2.0), run locally through [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx). Each sentence is synthesized separately with natural pauses, captions are timed to the speech, and the mix is loudness-normalized to −16 LUFS. To regenerate it, download the `sherpa-onnx-*-osx-universal2-static` (or your platform's) release and `kokoro-multi-lang-v1_0.tar.bz2` from the sherpa-onnx [releases](https://github.com/k2-fsa/sherpa-onnx/releases) and extract both into `~/.cache/bento-deck-studio/tts/` (or set `BDS_TTS_HOME`). Then delete the existing MP4 and SRT and run:

```sh
node scripts/create-demo.mjs [--voice 21] [--pace 1.15] [--engine auto|kokoro|say]
```

The default voice is the British English `bf_emma` (speaker 21). Kokoro has no Australian English voice. Without Kokoro, the script falls back to the macOS `say` Karen voice, which sounds noticeably synthetic. Captions use macOS `sips`, and the video uses `ffmpeg`.

## Documentation visuals

The docs include workflow visuals and current screenshots of the generated deck and site. Refresh the screenshots when generated output or navigation changes; never use a mock as evidence of a behavior that was not tested.

## Development

```sh
node --test
node scripts/validate.mjs .
```

**Plugin CI** runs the tests, validates the plugin manifests and skills, builds and validates the project website, and validates the plugin package that a release would ship.

## Project website

The website is a dependency-free static site generated from Markdown and the plugin's own manifests, skills, and changelog. Sources live in `website/` (`content/` for docs, `assets/` for styles, fonts, and icons, and `slides/` for the showcase deck); `docs/release-plan.md` is published as the release process page. Its top menu starts with **Slides ↗**, which opens the read-only showcase deck in a new tab.

```sh
node scripts/website-build.mjs --out _site [--base-url https://example.com/path/]
node scripts/validate.mjs _site --site
```

The build refuses to overwrite a non-empty folder and fails on any broken internal link. The **Deploy website** workflow builds and deploys it to GitHub Pages on every relevant push to `main`. The showcase deck is a reviewed build artifact; its outline is `website/deck/showcase.md`.

## Releases

Releases follow [Semantic Versioning](https://semver.org/) and are recorded in [CHANGELOG.md](CHANGELOG.md). See the [release process](docs/release-plan.md) for the gates, channels, and rollback plan.

```sh
node scripts/release.mjs bump 1.1.0     # update plugin.json and marketplace.json
node scripts/release.mjs check 1.1.0    # versions, dated changelog section, and tag state
git tag -a v1.1.0 -m "v1.1.0" && git push origin v1.1.0
```

Pushing a `v*.*.*` tag runs the **Release** workflow. It re-runs the checks, packages the plugin with `git archive` (see `.gitattributes`), and publishes a GitHub release with `SHA256SUMS` and a build provenance attestation. Report security issues as described in [SECURITY.md](SECURITY.md).

## References

- [bento.page](https://bento.page/)
- [nyblnet/bento](https://github.com/nyblnet/bento)
- [Agent Plugins specification](https://agent-plugins.org/)
- [Copilot CLI plugin reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference)
