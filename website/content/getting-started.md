---
title: Getting started
description: Install bento-deck-studio in the GitHub Copilot app or Copilot CLI and build your first themed bento deck.
order: 1
---

# Getting started

bento-deck-studio is a GitHub Copilot plugin. It adds one coordinating agent and six Agent Skills that turn a PowerPoint template or deck into editable [bento](https://bento.page/) slides, then share them as a launch page or a full companion site.

## Requirements

- GitHub Copilot CLI or the GitHub Copilot app with plugin support.
- Node.js 20 or later (24 recommended). The scripts use Node.js built-ins only, so there is nothing to `npm install`.
- Network access the first time you build a deck, to fetch and verify the signed Bento Slides shell. Later builds can reuse the verified cache offline.
- A `.pptx` or `.potx` file whose theme you want to reuse.

## Install the plugin

Register the repository as a plugin marketplace, then install the plugin from it:

```sh
copilot plugin marketplace add arilivigni/bento-deck-studio
copilot plugin install bento-deck-studio@bento-deck-studio
```

Check that it is installed:

```sh
copilot plugin list
```

You can also install straight from the repository without registering a marketplace:

```sh
copilot plugin install arilivigni/bento-deck-studio
```

In the GitHub Copilot app, find the marketplace and plugin under **Customize**, then choose the `bento-deck-studio` agent or invoke its skills directly.

### Pin a release

Every release is a Git tag such as `v1.0.0`. To install a specific release instead of the latest commit on `main`, add the marketplace at that tag:

```sh
copilot plugin marketplace add arilivigni/bento-deck-studio#v1.0.0
copilot plugin install bento-deck-studio@bento-deck-studio
```

If you already added the marketplace, run `copilot plugin marketplace remove bento-deck-studio` first.

Each [GitHub release](https://github.com/arilivigni/bento-deck-studio/releases) also attaches a plugin zip, a `SHA256SUMS` file, and a build provenance attestation for offline or air-gapped installs. See [Releases](../releases.html).

### Update or remove

```sh
copilot plugin update bento-deck-studio@bento-deck-studio
copilot plugin uninstall bento-deck-studio@bento-deck-studio
```

## Build your first deck

Ask the **bento-deck-studio** agent for what you want. For example:

```text
Use the bento-deck-studio agent to turn ~/Downloads/brand-template.potx
and notes.md into bento slides. Use the dark variant and create the
default launch site in ./talk.
```

The agent works in phases and loads a skill for each one:

1. **Extract** the palette, fonts, slide size, masters, and layouts to a reviewable `theme.json` (`/theme-extract`).
2. **Author** your story as a Markdown outline, one idea per slide (`/deck-author`).
3. **Build** an editable `.bento.html` on the source's own layouts (`/deck-build`).
4. **Choose** a favicon from your image or a theme-colored monogram (`/favicon`).
5. **Share** a launch page, a full companion site, or the deck alone (`/site-build`).
6. **Review** every slide and the site navigation (`/deck-qa`).

It asks before replacing existing output, using a proprietary font, or creating the optional full site.

## Run the scripts yourself

The same workflow runs without the agent:

```sh
node scripts/theme-extract.mjs brand-template.potx --out theme.json
node scripts/deck-build.mjs --theme theme.json --content outline.md --out dist/deck.bento.html
node scripts/site-build.mjs --deck dist/deck.bento.html --out dist/site
node scripts/validate.mjs dist/site --site
```

Open `dist/site/index.html` in a browser, then choose **Launch the slides**. See the [script reference](cli-reference.md) for every option.

## Next steps

- Learn how the plugin [matches your template](theme-fidelity.md).
- Choose between a [launch page and a full site](sites-and-favicons.md).
- Review the [safety and licensing notes](safety.md) before you publish.
