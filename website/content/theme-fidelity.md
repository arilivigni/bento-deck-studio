---
title: Match your template
description: How bento-deck-studio reproduces the colors, typography, and proportions of a PowerPoint template in editable bento slides.
order: 2
---

# Match your template

bento-deck-studio does not paste screenshots of your slides. It reads the template's design system and rebuilds each slide as native, editable bento content on the template's own layouts.

## What the extractor reads

`theme-extract` opens the `.pptx` or `.potx` read-only and writes a reviewable `theme.json`:

- **Colors:** the twelve theme colors, resolved through each master's color map, including tints, shades, and luminance modifiers.
- **Fonts:** the major (heading) and minor (body) faces, plus any typeface set directly on placeholders.
- **Slide size:** the exact aspect ratio and dimensions.
- **Variants:** every slide master, labelled as a dark or light variant.
- **Layouts:** placeholder geometry and text styles for cover, section, content, statement, and closing layouts, plus decorative shapes and pictures.
- **Assets:** candidate images (logos, backgrounds) with their sources, so you can choose what to reuse.

Anything it approximates or skips is listed in the `report` section of the theme JSON.

## Proportions

Every placeholder and decorative shape keeps its source position, scaled exactly to bento's pixel canvas. Your content goes onto the source's own cover, section, content, and closing layouts. A master without a content layout borrows a sibling's layout of the same tone. Failing that, it uses the open region under the title, below any divider and above footers.

Pick a layout for a slide with a hint under its heading:

```md
## Keep your brand. Skip the rebuild.
<!-- layout: statement -->
```

## Colors

Colors are stored as bento theme references, not hard-coded values, so the deck keeps following the template palette when you edit it in bento.

## Typography

- Fonts are embedded when their license allows it, so viewers see the real faces.
- Line pitch, paragraph spacing, baseline position, and kerning come from the embedded font's own metrics. Text sets the way PowerPoint sets it.
- A spaced, wrapped body becomes grouped per-paragraph text boxes so bento keeps PowerPoint's paragraph gaps. Use `--single-body` to keep one text box.
- Placeholders that would overflow grow around their anchor instead of clipping.

Measured against PowerPoint for Mac exports of a brand template, title, body, and cover text lines land within about 1 px at 1280 × 720. Large section titles land within 2 px. Windows rendering can differ slightly.

## Font licensing

| Source | Embedded when |
| --- | --- |
| `--fonts` folders | The font's OS/2 `fsType` permits embedding. |
| System fonts | The font carries an open license (OFL, Apache, or UFL). |
| Google Fonts | The family is missing locally; Google Fonts only serves open-licensed fonts. Disable with `--no-font-download`. |

Everything else falls back to a metric-compatible substitute or a system stack, and the build names each face it could not embed.

## Known limits

- This is not a lossless PowerPoint importer. The theme guides a fresh, editable design.
- Gradient text uses its first color stop.
- Unknown preset shapes become rectangles.
- Charts, tables, and SmartArt drawn on layouts are not converted.

Always compare the rendered deck with the source before you share it. The [showcase deck](../slides/deck.bento.html) on this site was built by the plugin from GitHub's 2026 presentation template.
