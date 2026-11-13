---
name: deck-author
description: Transform a topic, outline, Markdown, or speaker notes into a narrative bento deck using an extracted PowerPoint theme.
---

# Author the slide narrative

Before creating slides, establish audience, purpose, key message, duration, and source material. For supplied Markdown, preserve its title and section order unless the user asks for a restructure.

Use one clear idea per slide. Prefer a strong headline, short explanation, concrete examples, and meaningful visual structures over bullet-heavy slides. Use charts only when source data supports them; never invent metrics. Put speaker notes on slides only when the user supplied or requested them.

Build from the reviewed theme JSON:

```sh
node scripts/deck-build.mjs --theme theme.json --content outline.md --out dist/deck.bento.html
```

Let the builder handle the theme's fonts: it embeds licence-permitted files and otherwise keeps a metric-compatible or system stack. Use `<!-- layout: section -->` (or another role or layout name) under a heading when a slide should use a specific source layout. Make slide IDs and element IDs deterministic, maintain accessible contrast, and leave reasonable margins.
