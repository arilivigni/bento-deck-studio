#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadVerifiedShell, spliceDeck } from './lib/bento.mjs';
import { readFavicon } from './lib/favicon.mjs';
import { embedFonts, firstFamily, fontStack } from './lib/fonts.mjs';
import { applyOfficeTypography } from './lib/typography.mjs';

const DEFAULT_THEME = { background: '#101418', color: '#F2F0EA', accent: '#FF9E8A', fontFamily: 'system-ui, sans-serif' };
const CLOSING_TITLE = /^(thank\s*you|thanks|questions\??|q\s*&\s*a|the end)\b/i;
const ROLE_ORDER = ['cover', 'content', 'section', 'statement', 'closing', 'titleOnly', 'blank'];
const MAX_ITEMS_PER_SLIDE = 8;

const round = (value) => Math.round(value * 100) / 100;

function escapeHtml(text) {
  return String(text).replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
}

/** Inline Markdown (**bold**, *italic*, `code`) to Bento's sanitised HTML subset. */
function inlineHtml(text, caps = false) {
  const source = caps ? String(text).toUpperCase() : String(text);
  return escapeHtml(source)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])[*_](?!\s)(.+?)(?<!\s)[*_](?=$|[\s.,;:!?)])/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function plainText(text) {
  return String(text).replace(/\*\*|`|(^|\s)[*_]|[*_](?=\s|$)/g, '$1');
}

export function parseMarkdown(markdown, fallbackTitle = 'Untitled presentation') {
  const sections = [];
  const preamble = [];
  const cover = {};
  let title = fallbackTitle;
  let current = null;
  const flush = () => {
    if (!current) return;
    current.items = current.items.filter((item) => item.trim());
    sections.push(current);
  };
  for (const rawLine of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim();
    const hint = line.match(/^<!--\s*(layout|notes)\s*:\s*([\s\S]*?)\s*-->$/i);
    if (hint) {
      const target = current ?? cover;
      if (hint[1].toLowerCase() === 'layout') target.layout = hint[2];
      else target.notes = [target.notes, hint[2]].filter(Boolean).join('\n');
      continue;
    }
    if (line.startsWith('<!--')) continue;
    if (/^#\s/.test(line) && !sections.length && !current) {
      title = line.slice(2).trim() || title;
    } else if (/^##\s/.test(line)) {
      flush();
      current = { title: line.replace(/^##\s+/, '').trim(), items: [], bulleted: false, ordered: false };
    } else if (current) {
      const bullet = line.match(/^[-*+]\s+(.*)$/);
      const numbered = line.match(/^\d+[.)]\s+(.*)$/);
      if (bullet) {
        current.items.push(bullet[1].trim());
        current.bulleted = true;
      } else if (numbered) {
        current.items.push(numbered[1].trim());
        current.ordered = true;
      } else if (line) {
        current.items.push(line.replace(/^#{3,6}\s+/, ''));
      }
    } else if (line) {
      preamble.push(line);
    }
  }
  flush();
  const subtitle = preamble.join(' ');
  if (!sections.length && subtitle) sections.push({ title: 'Key message', items: [subtitle], bulleted: false, ordered: false });
  if (!sections.length) sections.push({ title: 'Key message', items: ['Add slide content beneath a level-two Markdown heading.'], bulleted: false, ordered: false });
  return { title, subtitle, sections, cover };
}

// ---------------------------------------------------------------------------
// Template specs: a v2 theme (extracted layouts) or a synthesised legacy spec.
// ---------------------------------------------------------------------------

export function pickVariant(themeData, option) {
  const variants = themeData.variants ?? [];
  if (!variants.length) return null;
  if (option === undefined || option === null || option === '') return variants[themeData.defaultVariant ?? 0] ?? variants[0];
  const text = String(option).trim().toLowerCase();
  if (/^\d+$/.test(text) && variants[Number(text)]) return variants[Number(text)];
  if (text === 'dark' || text === 'light') {
    const toned = variants.find((variant) => variant.tone === text);
    if (toned) return toned;
  }
  const named = variants.find((variant) => variant.name.toLowerCase() === text)
    ?? variants.find((variant) => variant.name.toLowerCase().includes(text));
  if (named) return named;
  throw new Error(`Unknown variant "${option}". Available: ${variants.map((variant) => `${variant.index} ${variant.name} (${variant.tone})`).join('; ')}.`);
}

function templateSpec(themeData, variantOption) {
  const variant = pickVariant(themeData, variantOption);
  const roles = {};
  for (const [role, index] of Object.entries(variant.roles ?? {})) {
    if (themeData.layouts[index]) roles[role] = themeData.layouts[index];
  }
  return {
    kind: 'template',
    size: themeData.size ?? { width: 1280, height: 720 },
    theme: variant.theme ?? themeData.theme,
    variant,
    layouts: themeData.layouts.filter((layout) => layout.variant === variant.index),
    roles,
    assets: themeData.assets ?? {}
  };
}

/** The look of schema-v1 themes, expressed as layouts so one renderer serves both. */
function legacySpec(themeData) {
  const size = themeData.size ?? { width: 1280, height: 720 };
  const theme = { ...DEFAULT_THEME, ...(themeData.theme ?? {}) };
  if (!theme.headingFamily && themeData.fonts?.heading) theme.headingFamily = fontStack(themeData.fonts.heading);
  if (themeData.fonts?.body && (!themeData.theme?.fontFamily)) theme.fontFamily = fontStack(themeData.fonts.body);
  const sx = size.width / 1280;
  const sy = size.height / 720;
  const fs = Math.min(sx, sy);
  const box = (x, y, w, h) => ({ x: round(x * sx), y: round(y * sy), w: round(w * sx), h: round(h * sy) });
  const heading = theme.headingFamily ?? theme.fontFamily;
  const style = (fontSize, extra = {}) => ({
    fontFamily: theme.fontFamily, fontSize: round(fontSize * fs), fontWeight: 400, color: theme.color, colorRef: 'tx1',
    align: 'left', valign: 'top', lineHeight: 1.2, autofit: 'shrink', ...extra
  });
  const rect = (id, x, y, w, h, radius) => ({
    id, type: 'shape', shape: 'rect', ...box(x, y, w, h), rotation: 0, opacity: 1, locked: true,
    fill: theme.accent, strokeWidth: 0, radius: round(radius * fs), themeRefs: { fill: 'accent1' }
  });
  const background = { kind: 'solid', color: theme.background, ref: 'bg1' };
  const titleStyle = (fontSize, valign = 'top') => style(fontSize, { fontFamily: heading, fontWeight: 700, lineHeight: 1.08, valign });
  const layouts = [
    {
      index: 0, name: 'Cover', background, furniture: [rect('f1', 96, 194, 12, 232, 6)],
      placeholders: [
        { role: 'title', prompt: 'Presentation title', box: box(136, 205, 1048, 132), style: titleStyle(62, 'bottom') },
        { role: 'subtitle', prompt: 'Subtitle', box: box(138, 365, 1028, 116), style: style(28, { lineHeight: 1.25 }) }
      ]
    },
    {
      index: 1, name: 'Content', background, furniture: [rect('f1', 96, 84, 8, 70, 4)],
      placeholders: [
        { role: 'eyebrow', prompt: 'Section', box: box(120, 82, 1064, 32), style: style(15, { fontWeight: 700, color: theme.accent, colorRef: 'accent1', lineHeight: 1.1, caps: true, letterSpacing: round(1.2 * fs) }) },
        { role: 'title', prompt: 'Slide title', box: box(96, 142, 1088, 104), style: titleStyle(42) },
        { role: 'body', prompt: 'Slide content', box: box(96, 280, 1088, 370), style: style(27, { lineHeight: 1.3 }), primary: true }
      ]
    },
    {
      index: 2, name: 'Section', background, furniture: [rect('f1', 96, 290, 12, 140, 6)],
      placeholders: [
        { role: 'eyebrow', prompt: 'Section', box: box(136, 250, 1048, 32), style: style(15, { fontWeight: 700, color: theme.accent, colorRef: 'accent1', caps: true, letterSpacing: round(1.2 * fs) }) },
        { role: 'title', prompt: 'Section title', box: box(136, 290, 1048, 140), style: titleStyle(64, 'middle') }
      ]
    }
  ];
  return {
    kind: 'legacy', size, theme, variant: null, layouts,
    roles: { cover: layouts[0], content: layouts[1], section: layouts[2], statement: layouts[2], closing: layouts[2] },
    assets: {}
  };
}

function resolveSpec(themeData, variantOption) {
  if ((themeData.schemaVersion ?? 1) >= 2 && themeData.layouts?.length && themeData.variants?.length) {
    return templateSpec(themeData, variantOption);
  }
  return legacySpec(themeData);
}

// ---------------------------------------------------------------------------
// Placeholder targeting and synthesis for layouts that lack a needed slot.
// ---------------------------------------------------------------------------

const area = (ph) => ph.box.w * ph.box.h;
const largest = (list) => list.reduce((best, ph) => (!best || area(ph) > area(best) ? ph : best), null);

const contentBodies = new WeakMap();

function bodyTarget(layout) {
  const phs = layout.placeholders ?? [];
  if (layout.contentBody) {
    if (!contentBodies.has(layout)) {
      contentBodies.set(layout, { role: 'body', prompt: 'Content', synthesized: true, ...layout.contentBody });
    }
    return contentBodies.get(layout);
  }
  return phs.find((ph) => ph.primary)
    ?? largest(phs.filter((ph) => ph.role === 'body'))
    ?? largest(phs.filter((ph) => ph.role === 'subtitle'));
}

function subtitleTarget(layout) {
  const phs = layout.placeholders ?? [];
  return largest(phs.filter((ph) => ph.role === 'subtitle')) ?? bodyTarget(layout);
}

function synthTitle(spec) {
  const { width, height } = spec.size;
  const fontSize = round(height * 0.062);
  return {
    role: 'title', prompt: 'Title', synthesized: true,
    box: { x: round(width * 0.06), y: round(height * 0.08), w: round(width * 0.88), h: round(fontSize * 1.1 * 2) },
    style: {
      fontFamily: spec.theme.headingFamily ?? spec.theme.fontFamily, fontSize, fontWeight: 700,
      color: spec.theme.color, colorRef: 'tx1', align: 'left', valign: 'top', lineHeight: 1.1, autofit: 'shrink'
    }
  };
}

function synthBody(spec, title) {
  const { width, height } = spec.size;
  const top = title ? title.box.y + title.box.h + height * 0.04 : height * 0.2;
  const left = title?.box.x ?? width * 0.06;
  return {
    role: 'body', prompt: 'Content', synthesized: true,
    box: { x: round(left), y: round(top), w: round(title?.box.w ?? width * 0.88), h: round(Math.max(height * 0.2, height * 0.88 - top)) },
    style: {
      fontFamily: spec.theme.fontFamily, fontSize: round(height * 0.039), fontWeight: 400,
      color: spec.theme.color, colorRef: 'tx1', align: 'left', valign: 'top', lineHeight: 1.25, autofit: 'shrink'
    }
  };
}

// ---------------------------------------------------------------------------
// Text fitting: a width-aware line estimate drives shrink-to-fit and pagination.
// ---------------------------------------------------------------------------

function charFactor(style) {
  const family = (style.family ?? firstFamily(style.fontFamily ?? '')).toLowerCase();
  if (/mono|code|courier|consol/.test(family)) return 0.6;
  if (/condensed|narrow|compressed/.test(family)) return 0.44;
  if (/display/.test(family)) return 0.5;
  return 0.53;
}

function wrappedLines(text, available, charWidth) {
  const words = plainText(text).split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  let lines = 1;
  let used = 0;
  for (const word of words) {
    const width = word.length * charWidth;
    const next = used ? used + charWidth + width : width;
    if (used && next > available) {
      lines += 1;
      used = width;
    } else {
      used = next;
    }
    while (used > available) {
      lines += 1;
      used -= available;
    }
  }
  return lines;
}

function textHeight(paragraphs, style, width, scale = 1, list = false) {
  const fontSize = style.fontSize * scale;
  const charWidth = fontSize * charFactor(style) * (style.caps ? 1.12 : 1) + (style.letterSpacing ?? 0);
  const available = Math.max(fontSize, width - (list ? 1.35 * fontSize : 0));
  const lines = paragraphs.reduce((sum, text) => sum + wrappedLines(text, available, charWidth), 0);
  const spacing = list ? paragraphs.length * 0.24 * fontSize : Math.max(0, paragraphs.length - 1) * (style.spaceBefore ?? 0) * scale;
  return lines * fontSize * (style.lineHeight ?? 1.2) + spacing;
}

function fitScale(paragraphs, style, box, list, minScale) {
  for (let scale = 1; scale >= minScale - 1e-9; scale -= 0.05) {
    if (textHeight(paragraphs, style, box.w, scale, list) <= box.h + 2) return round(scale);
  }
  return minScale;
}

function minScaleFor(style) {
  return style.autofit === 'shrink' ? 0.7 : 0.85;
}

function paginate(items, style, box, list) {
  const minScale = minScaleFor(style);
  const pages = [];
  let page = [];
  for (const item of items) {
    const candidate = [...page, item];
    if (page.length && (candidate.length > MAX_ITEMS_PER_SLIDE || textHeight(candidate, style, box.w, minScale, list) > box.h + 2)) {
      pages.push(page);
      page = [item];
    } else {
      page = candidate;
    }
  }
  if (page.length) pages.push(page);
  if (pages.length < 2) return pages.length ? pages : [[]];
  // Rebalance so continuation slides are evenly filled and share one font size.
  const perPage = Math.ceil(items.length / pages.length);
  const balanced = [];
  for (let i = 0; i < items.length; i += perPage) balanced.push(items.slice(i, i + perPage));
  const fits = balanced.every((chunk) => textHeight(chunk, style, box.w, minScale, list) <= box.h + 2);
  return fits ? balanced : pages;
}

// ---------------------------------------------------------------------------
// Element builders.
// ---------------------------------------------------------------------------

function textElement(id, morphId, ph, html, scale = 1) {
  const style = ph.style ?? {};
  const element = {
    id, morphId, type: 'text',
    x: round(ph.box.x), y: round(ph.box.y), w: round(ph.box.w), h: round(ph.box.h),
    rotation: 0, opacity: 1,
    html: style.italic ? `<i>${html}</i>` : html,
    fontSize: round((style.fontSize ?? 24) * scale),
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight ?? 400,
    color: style.color,
    align: style.align ?? 'left',
    valign: style.valign ?? 'top',
    lineHeight: style.lineHeight ?? 1.2,
    role: ph.role
  };
  if (style.letterSpacing) element.letterSpacing = round(style.letterSpacing * scale);
  if (style.colorRef) element.themeRefs = { color: style.colorRef };
  return element;
}

/** Lists follow the template: a placeholder with buNone renders bullet items as plain paragraphs. */
function listKind(section, style) {
  if (section.ordered && !section.bulleted) return 'ol';
  if (!section.bulleted && !section.ordered) return null;
  return style?.bullet === null ? null : 'ul';
}

function bodyHtml(items, style, section) {
  const rendered = items.map((item) => inlineHtml(item, style.caps));
  const tag = listKind(section, style);
  if (!tag) return rendered.map((item) => `<div>${item}</div>`).join('');
  return `<${tag}>${rendered.map((item) => `<li>${item}</li>`).join('')}</${tag}>`;
}

function layoutKey(layout) {
  return `tpl-${layout.variant ?? 'x'}-${layout.index}`;
}

function backgroundElements(background, slideId, key, size) {
  if (background?.kind === 'image' && background.asset) {
    return [{
      id: `${slideId}-bg`, morphId: `${key}-bg`, type: 'image', src: `asset:${background.asset}`,
      x: 0, y: 0, w: size.width, h: size.height, rotation: 0, opacity: 1, locked: true, fit: 'cover'
    }];
  }
  if (background?.kind === 'gradient' && background.gradient) {
    return [{
      id: `${slideId}-bg`, morphId: `${key}-bg`, type: 'shape', shape: 'rect',
      x: 0, y: 0, w: size.width, h: size.height, rotation: 0, opacity: 1, locked: true,
      fill: background.color, fillGradient: background.gradient, strokeWidth: 0
    }];
  }
  return [];
}

/** Snap sub-pixel bleed from EMU rounding so furniture sits exactly on the canvas edge. */
function snapToCanvas(element, size) {
  if (!size) return;
  for (const [pos, len, limit] of [['x', 'w', size.width], ['y', 'h', size.height]]) {
    if (!Number.isFinite(element[pos]) || !Number.isFinite(element[len])) continue;
    if (element[pos] < 0 && element[pos] > -0.5) {
      element[len] = round(element[len] + element[pos]);
      element[pos] = 0;
    }
    const overshoot = element[pos] + element[len] - limit;
    if (overshoot > 0 && overshoot < 0.5) element[len] = round(limit - element[pos]);
  }
}

function furnitureElements(layout, slideId, replaceText, size) {
  const key = layoutKey(layout);
  let replaced = false;
  return (layout.furniture ?? []).map((item) => {
    const element = structuredClone(item);
    element.id = `${slideId}-${item.id}`;
    element.morphId = `${key}-${item.id}`;
    element.locked = true;
    snapToCanvas(element, size);
    if (element.type === 'shape' && !Number.isFinite(element.strokeWidth)) element.strokeWidth = 0;
    if (replaceText && !replaced && element.type === 'text' && element.fontSize >= 40) {
      element.html = replaceText;
      replaced = true;
    }
    return element;
  });
}

function slideShell(spec, layout, slideId, name) {
  const background = layout.background ?? { kind: 'solid', color: spec.theme.background, ref: 'bg1' };
  const slide = {
    id: slideId,
    name,
    background: background.color ?? spec.theme.background,
    transition: 'fade',
    notes: '',
    elements: backgroundElements(background, slideId, layoutKey(layout), spec.size)
  };
  if (background.kind === 'solid' && background.ref) slide.themeRefs = { background: background.ref };
  return slide;
}

/**
 * Fill one layout. `fields` maps placeholder roles to raw text; `body` carries list items.
 * Placeholders without content are omitted, as PowerPoint hides empty placeholders in a show.
 */
function renderSlide(spec, layout, slideId, name, fields, report) {
  const slide = slideShell(spec, layout, slideId, name);
  let placeholders = [...(layout.placeholders ?? [])];
  let title = placeholders.find((ph) => ph.role === 'title');
  const furnitureText = (layout.furniture ?? []).some((item) => item.type === 'text' && item.fontSize >= 40);
  const replaceText = !title && furnitureText && fields.title ? inlineHtml(fields.title) : null;
  if (!title && fields.title && !replaceText) {
    title = synthTitle(spec);
    placeholders.push(title);
  }
  let body = fields.body ? (fields.bodyAsSubtitle ? subtitleTarget(layout) : bodyTarget(layout)) : null;
  if (fields.body && (!body || body === title)) {
    body = synthBody(spec, title);
    placeholders.push(body);
    report.synthesized.add(`${layout.name}: body`);
  } else if (body && !placeholders.includes(body)) {
    placeholders.push(body);
    report.synthesized.add(`${layout.name}: body below title`);
  }
  slide.elements.push(...furnitureElements(layout, slideId, replaceText, spec.size));
  const used = new Set();
  for (const ph of placeholders) {
    let element = null;
    if (ph === body) {
      const list = Boolean(listKind(fields.body.section, ph.style));
      const scale = fields.body.scale ?? fitScale(fields.body.items, ph.style, ph.box, list, minScaleFor(ph.style));
      element = textElement(`${slideId}-body`, 'ph-body', ph, bodyHtml(fields.body.items, ph.style, fields.body.section), scale);
      report.typography?.set(element, { lineHeight: element.lineHeight, spaceBefore: round((ph.style.spaceBefore ?? 0) * scale), list });
    } else if (ph.role === 'title' && fields.title && !used.has('title')) {
      const scale = fitScale([fields.title], ph.style, ph.box, false, 0.6);
      element = textElement(`${slideId}-title`, 'ph-title', ph, inlineHtml(fields.title, ph.style.caps), scale);
    } else if (['eyebrow', 'footer', 'slideNumber', 'date', 'subtitle'].includes(ph.role) && fields[ph.role] && !used.has(ph.role)) {
      const text = fields[ph.role];
      const html = /^\{\{\w+(:\w+)?\}\}$/.test(text) ? text : inlineHtml(text, ph.style.caps);
      const scale = ph.role === 'subtitle' ? fitScale([text], ph.style, ph.box, false, minScaleFor(ph.style)) : 1;
      element = textElement(`${slideId}-${ph.role}`, `ph-${ph.role}`, ph, html, scale);
    }
    if (element) {
      used.add(ph === body ? 'body' : ph.role);
      slide.elements.push(element);
    }
  }
  return slide;
}

function layoutElements(spec, layout, id) {
  const slide = slideShell(spec, layout, id, layout.name);
  slide.elements.push(...furnitureElements(layout, id, null, spec.size));
  for (const ph of layout.placeholders ?? []) {
    if (ph.role === 'media') continue;
    const element = textElement(`${id}-${ph.role}-${ph.index ?? 0}`, `ph-${ph.role}`, ph, '');
    element.placeholder = ph.prompt || ph.role;
    slide.elements.push(element);
  }
  delete slide.transition;
  delete slide.notes;
  return slide;
}

// ---------------------------------------------------------------------------
// Document assembly.
// ---------------------------------------------------------------------------

function findLayout(spec, hint, report) {
  if (!hint) return null;
  const wanted = hint.trim().toLowerCase();
  if (spec.roles[wanted] || spec.roles[ROLE_ORDER.find((role) => role.toLowerCase() === wanted)]) {
    return spec.roles[wanted] ?? spec.roles[ROLE_ORDER.find((role) => role.toLowerCase() === wanted)];
  }
  const match = spec.layouts.find((layout) => layout.name.trim().toLowerCase() === wanted)
    ?? spec.layouts.find((layout) => layout.name.trim().toLowerCase().includes(wanted));
  if (!match) report.warnings.push(`Layout hint "${hint}" did not match a layout in this variant; using the default.`);
  return match ?? null;
}

function footerText(ph, deckTitle) {
  return ph?.style?.caps ? deckTitle : '{{title}}';
}

function collectAssets(doc, available) {
  const keys = new Set();
  const visit = (slides) => {
    for (const slide of slides ?? []) {
      for (const element of slide.elements ?? []) {
        if (typeof element.src === 'string' && element.src.startsWith('asset:')) keys.add(element.src.slice(6));
      }
    }
  };
  visit(doc.slides);
  visit(doc.layouts);
  return Object.fromEntries([...keys].filter((key) => available[key]).map((key) => [key, available[key]]));
}

/** Build a Bento document plus a report of synthesised slots, pagination and warnings. */
export function buildDeck(markdown, themeData, fallbackTitle = 'Untitled presentation', options = {}) {
  const content = parseMarkdown(markdown, fallbackTitle);
  const spec = resolveSpec(themeData ?? {}, options.variant);
  const report = { variant: spec.variant ? `${spec.variant.index} ${spec.variant.name} (${spec.variant.tone})` : 'legacy', warnings: [], synthesized: new Set(), paginated: [] };
  const typography = new Map();
  if (spec.kind === 'template') report.typography = typography;
  const roles = spec.roles;
  const content0 = roles.content ?? roles.cover ?? spec.layouts[0];
  const coverLayout = findLayout(spec, content.cover.layout, report) ?? roles.cover ?? content0;
  const slides = [];

  const cover = renderSlide(spec, coverLayout, 'slide-title', 'Title', {
    title: content.title,
    ...(content.subtitle ? { body: { items: [content.subtitle], section: {} }, bodyAsSubtitle: true } : {})
  }, report);
  cover.notes = content.cover.notes ?? '';
  slides.push(cover);

  content.sections.forEach((section, sectionIndex) => {
    const number = String(sectionIndex + 1).padStart(2, '0');
    const isLast = sectionIndex === content.sections.length - 1;
    let layout = findLayout(spec, section.layout, report);
    if (!layout) {
      if (!section.items.length && isLast && CLOSING_TITLE.test(section.title)) layout = roles.closing ?? roles.section ?? content0;
      else if (!section.items.length) layout = roles.section ?? roles.statement ?? content0;
      else layout = content0;
    }
    const eyebrowPh = layout.placeholders?.find((ph) => ph.role === 'eyebrow');
    const footerPh = layout.placeholders?.find((ph) => ph.role === 'footer');
    const base = {
      title: section.title,
      eyebrow: `Section ${number}`,
      footer: footerText(footerPh, content.title),
      slideNumber: '{{page}}'
    };
    if (eyebrowPh?.style?.caps === false) base.eyebrow = `Section ${number}`;
    if (!section.items.length) {
      const slide = renderSlide(spec, layout, `slide-${number}`, section.title, base, report);
      slide.notes = section.notes ?? '';
      slides.push(slide);
      return;
    }
    const target = bodyTarget(layout) ?? synthBody(spec, layout.placeholders?.find((ph) => ph.role === 'title') ?? synthTitle(spec));
    const list = Boolean(listKind(section, target.style));
    const pages = paginate(section.items, target.style, target.box, list);
    if (pages.length > 1) report.paginated.push(`${section.title} → ${pages.length} slides`);
    const scale = pages.length > 1
      ? Math.min(...pages.map((items) => fitScale(items, target.style, target.box, list, minScaleFor(target.style))))
      : undefined;
    pages.forEach((items, pageIndex) => {
      const slideId = pages.length > 1 ? `slide-${number}-${pageIndex + 1}` : `slide-${number}`;
      const fields = {
        ...base,
        eyebrow: pageIndex ? `${base.eyebrow} · ${pageIndex + 1}/${pages.length}` : base.eyebrow,
        body: { items, section, scale }
      };
      const slide = renderSlide(spec, layout, slideId, pageIndex ? `${section.title} (${pageIndex + 1})` : section.title, fields, report);
      slide.transition = layout === content0 ? 'morph' : 'fade';
      slide.notes = pageIndex ? '' : section.notes ?? '';
      slides.push(slide);
    });
  });

  const layoutRoles = ROLE_ORDER.filter((role) => roles[role]);
  const seen = new Set();
  const layouts = [];
  for (const role of layoutRoles) {
    const layout = roles[role];
    if (seen.has(layout)) continue;
    seen.add(layout);
    layouts.push(layoutElements(spec, layout, `layout-${role}`));
  }

  const doc = {
    format: 'bento/slides',
    version: 1,
    title: content.title,
    size: spec.size,
    theme: spec.theme,
    meta: { subject: 'PowerPoint-themed bento presentation' },
    slides,
    layouts,
    assets: {}
  };
  doc.assets = collectAssets(doc, spec.assets);
  if (spec.kind === 'template') {
    // PowerPoint shows no counter or progress bar; template footers carry their own numbering.
    doc.present = { slideNumber: false, progress: false };
    for (const slide of [...slides, ...layouts]) {
      for (const element of slide.elements) {
        if (element.type === 'text' && !typography.has(element)) typography.set(element, { lineHeight: element.lineHeight, spaceBefore: 0 });
      }
    }
  }
  const { typography: _hints, ...publicReport } = report;
  return { doc, report: { ...publicReport, synthesized: [...report.synthesized] }, typography };
}

export function createDocument(markdown, themeData, fallbackTitle = 'Untitled presentation', options = {}) {
  return buildDeck(markdown, themeData, fallbackTitle, options).doc;
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

const BOOLEAN_FLAGS = new Set(['no-fonts', 'no-font-download', 'single-body']);

function parseArgs(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) continue;
    const key = args[i].slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      values[key] = true;
      continue;
    }
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${args[i]}.`);
    values[key] = args[++i];
  }
  return values;
}

async function main(args) {
  const options = parseArgs(args);
  if (!options.theme || !options.content || !options.out) {
    console.error('Usage: node scripts/deck-build.mjs --theme theme.json --content outline.md --out deck.bento.html [--variant dark|light|N|name] [--favicon favicon.svg] [--fonts dir[,dir]] [--no-font-download] [--no-fonts] [--single-body]');
    process.exitCode = 2;
    return;
  }
  const themeData = JSON.parse(await readFile(options.theme, 'utf8'));
  const markdown = await readFile(options.content, 'utf8');
  const { doc, report, typography } = buildDeck(markdown, themeData, options.content, { variant: options.variant });
  if (!options['no-fonts']) {
    const fontReport = await embedFonts(doc, {
      fontsDirs: options.fonts ? options.fonts.split(',').map((dir) => dir.trim()).filter(Boolean) : [],
      download: !options['no-font-download']
    });
    for (const face of fontReport.embedded) console.log(`Embedded font: ${face.family} ${face.weight}${face.italic ? ' italic' : ''} (${face.origin})`);
    for (const face of fontReport.missing) console.warn(`Font not embedded (not found or licence forbids it): ${face.family} ${face.weight} — viewers will see the fallback stack.`);
    if (typography.size) {
      const typo = applyOfficeTypography(doc, typography, { splitParagraphs: !options['single-body'] });
      console.log(`Calibrated ${typo.calibrated} text elements to PowerPoint line placement and kerning (${typo.spaced} with paragraph spacing, ${typo.split} split into grouped paragraph boxes, ${typo.grown} overflowing boxes grown around their anchor).`);
      if (typo.skipped.length) console.warn(`Typography not calibrated for: ${typo.skipped.join(', ')} (font not embedded as TTF/OTF).`);
    }
  }
  const favicon = options.favicon ? await readFavicon(options.favicon) : null;
  const faviconDataUri = favicon ? `data:${favicon.mime};base64,${favicon.data.toString('base64')}` : null;
  const { shell } = await loadVerifiedShell();
  const result = spliceDeck(shell, doc, faviconDataUri);
  await writeFile(options.out, result, { flag: 'wx' });
  console.log(`Built ${options.out}: ${doc.slides.length} slides, ${doc.layouts.length} layouts, variant ${report.variant}.`);
  for (const note of report.paginated) console.log(`Paginated: ${note}`);
  for (const note of report.synthesized) console.log(`Synthesised placeholder: ${note}`);
  for (const warning of report.warnings) console.warn(`Warning: ${warning}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Deck build failed: ${error.message}`);
    process.exitCode = 1;
  });
}
