/**
 * Calibrate Bento text so it sets the way PowerPoint sets it, using the embedded font files.
 *
 * Model (measured against PowerPoint for Mac PDF exports of the source template):
 *  - Line pitch is `lineSpacing% × 1.2em`, plus space-before between paragraphs (never before
 *    the first paragraph). The theme extractor already stores that pitch as `lineHeight`.
 *  - Inside each line PowerPoint puts the baseline at `pitch × ascent / (ascent + descent)`;
 *    CSS centres the font's content area instead, so text is shifted vertically to match.
 *  - PowerPoint only kerns with a legacy `kern` table. Browsers apply the GPOS `kern` feature,
 *    so fonts without a legacy table get a compensating letter-spacing and x offset.
 */
import { readFontMetrics } from './font-metrics.mjs';
import { firstFamily, normalizeFamily } from './fonts.mjs';

const SAMPLE = 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs, 2025.';
const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', '#39': "'" };

/** Split sanitised Bento HTML into paragraphs of styled runs. */
export function textRuns(html) {
  const paragraphs = [[]];
  const state = { bold: 0, italic: 0, code: 0 };
  const breakParagraph = () => {
    if (paragraphs.at(-1).length) paragraphs.push([]);
  };
  for (const token of String(html ?? '').split(/(<[^>]+>)/)) {
    if (!token) continue;
    const tag = /^<\s*(\/?)\s*([a-z0-9]+)/i.exec(token);
    if (tag) {
      const closing = Boolean(tag[1]);
      const name = tag[2].toLowerCase();
      const step = closing ? -1 : 1;
      if (name === 'b' || name === 'strong' || name === 'h1' || name === 'h2') state.bold = Math.max(0, state.bold + step);
      else if (name === 'i' || name === 'em') state.italic = Math.max(0, state.italic + step);
      else if (name === 'code') state.code = Math.max(0, state.code + step);
      else if (name === 'br' || ['div', 'p', 'li', 'ul', 'ol'].includes(name)) breakParagraph();
      continue;
    }
    const text = token.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (match, entity) => {
      if (ENTITIES[entity.toLowerCase()]) return ENTITIES[entity.toLowerCase()];
      if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
      if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
      return match;
    });
    paragraphs.at(-1).push({ text, bold: state.bold > 0, italic: state.italic > 0, code: state.code > 0 });
  }
  return paragraphs.filter((runs) => runs.some((run) => run.text.trim()));
}

function covers(spec, weight) {
  const [low, high = low] = String(spec ?? '400').split(/\s+/).map(Number);
  return weight >= low && weight <= high;
}

function fontResolver(doc) {
  const parsed = new Map();
  const metricsFor = (asset) => {
    if (!parsed.has(asset)) {
      const uri = doc.assets?.[asset];
      const match = typeof uri === 'string' ? /^data:[^;,]*;base64,(.*)$/s.exec(uri) : null;
      parsed.set(asset, match ? readFontMetrics(Buffer.from(match[1], 'base64')) : null);
    }
    return parsed.get(asset);
  };
  return (stack, weight = 400, italic = false) => {
    const family = normalizeFamily(firstFamily(stack ?? ''));
    const faces = (doc.fonts ?? []).filter((font) => normalizeFamily(font.family) === family);
    if (!faces.length) return null;
    const style = italic ? 'italic' : 'normal';
    const rank = (font) => (covers(font.weight, weight) ? 0 : 1000 + Math.abs(Number(String(font.weight).split(/\s+/)[0]) - weight))
      + ((font.style ?? 'normal') === style ? 0 : 5000);
    for (const font of [...faces].sort((a, b) => rank(a) - rank(b))) {
      const metrics = metricsFor(font.asset);
      if (metrics) return metrics;
    }
    return null;
  };
}

/** Greedy word wrap with unkerned advances (what PowerPoint uses and calibrated Bento renders). */
function wrapCount(runs, faceOf, fontSize, width) {
  let lines = 1;
  let line = 0;
  for (const run of runs) {
    const face = faceOf(run);
    const scale = fontSize * (run.code ? 1.1 : 1);
    for (const word of run.text.split(/(?<=\s)/)) {
      const advance = face.measure(word).width * scale;
      const ink = face.measure(word.trimEnd()).width * scale;
      if (line > 0 && line + ink > width) {
        lines += 1;
        line = advance;
      } else {
        line += advance;
      }
    }
  }
  return lines;
}

/** Split HTML made only of top-level `<div>` paragraphs; returns null for any other shape. */
export function splitParagraphHtml(html) {
  const parts = [];
  let depth = 0;
  let start = -1;
  const re = /<\s*(\/?)\s*([a-z0-9]+)[^>]*>/gi;
  let last = 0;
  for (let match; (match = re.exec(html));) {
    const outside = html.slice(last, match.index);
    last = re.lastIndex;
    if (depth === 0 && outside.trim()) return null;
    if (match[2].toLowerCase() !== 'div') {
      if (depth === 0) return null;
      continue;
    }
    if (match[1]) {
      depth -= 1;
      if (depth < 0) return null;
      if (depth === 0) parts.push(html.slice(start, re.lastIndex));
    } else {
      if (depth === 0) start = match.index;
      depth += 1;
    }
  }
  if (depth !== 0 || html.slice(last).trim()) return null;
  return parts.length ? parts : null;
}

function containers(doc) {
  const owner = new Map();
  for (const slide of [...(doc.slides ?? []), ...(doc.layouts ?? [])]) {
    for (const element of slide.elements ?? []) owner.set(element, slide.elements);
  }
  return owner;
}

/**
 * Apply PowerPoint line placement, paragraph spacing and kerning behaviour to template text.
 * `hints` maps text elements to `{ lineHeight, spaceBefore, list }` recorded by deck-build.
 * Elements whose font is not embedded as TTF/OTF are left untouched and reported.
 * With `splitParagraphs` (default) a spaced body whose paragraphs wrap becomes one grouped text
 * box per paragraph, because a single Bento box cannot show PowerPoint's space-before.
 */
export function applyOfficeTypography(doc, hints, { splitParagraphs = true } = {}) {
  const resolve = fontResolver(doc);
  const report = { calibrated: 0, spaced: 0, split: 0, grown: 0, skipped: new Set() };
  const owners = splitParagraphs ? containers(doc) : null;
  for (const [element, hint] of hints ?? []) {
    if (element.type !== 'text' || !(element.fontSize > 0)) continue;
    const weight = Number(element.fontWeight) || 400;
    const primary = resolve(element.fontFamily, weight, false);
    if (!primary) {
      report.skipped.add(firstFamily(element.fontFamily ?? '') || 'unknown');
      continue;
    }
    const fontSize = element.fontSize;
    const paragraphs = textRuns(element.html);

    // Kerning: match PowerPoint's unkerned advances when it would not kern this font.
    if (!primary.legacyKern && primary.gposKern) {
      let kerning = 0;
      let chars = 0;
      for (const runs of paragraphs) {
        for (const run of runs) {
          chars += [...run.text].length;
          if (run.code) continue;
          const face = resolve(element.fontFamily, run.bold ? Math.max(700, weight) : weight, run.italic) ?? primary;
          kerning += face.measure(run.text).kerning;
        }
      }
      if (!chars) {
        const sample = primary.measure(SAMPLE);
        kerning = sample.kerning;
        chars = [...SAMPLE].length;
      }
      const delta = -(kerning * fontSize) / chars;
      const spacing = round((element.letterSpacing ?? 0) + delta);
      if (spacing) element.letterSpacing = spacing;
      else delete element.letterSpacing;
      // Some fonts also nudge every glyph sideways inside `kern`; PowerPoint never applies that.
      const first = paragraphs[0]?.find((run) => run.text.trim() && !run.code);
      const placement = first ? primary.measure(first.text.trimStart()).placement : primary.measure(SAMPLE).placement;
      if (placement) element.x = round(element.x - placement * fontSize);
    }

    // Vertical placement and paragraph spacing.
    const ascent = primary.ascent;
    const descent = primary.descent;
    const content = ascent + descent;
    const pitch = hint.lineHeight ?? element.lineHeight ?? 1.2;
    const gap = (hint.spaceBefore ?? 0) / fontSize;
    let cssPitch = pitch;
    const count = paragraphs.length;
    const faceOf = (run) => (run.code ? primary : resolve(element.fontFamily, run.bold ? Math.max(700, weight) : weight, run.italic) ?? primary);
    const perParagraph = hint.list ? null : paragraphs.map((runs) => wrapCount(runs, faceOf, fontSize, element.w));
    let lines = perParagraph ? perParagraph.reduce((total, n) => total + n, 0) : count;
    if (gap > 0 && count > 1 && !hint.list) {
      const parts = lines > count && owners?.has(element) ? splitParagraphHtml(element.html) : null;
      if (parts?.length === count) {
        splitElement(element, parts, perParagraph, { pitch, gap, ascent, descent, owner: owners.get(element) });
        report.spaced += 1;
        report.split += 1;
        report.calibrated += 1;
        continue;
      }
      // Bento has one line-height per box, so PowerPoint's space-before is spread over the line
      // gaps: first and last baselines match exactly, and fully when no paragraph wraps.
      cssPitch = pitch + (gap * (count - 1)) / (lines - 1);
    }
    let dy;
    if (cssPitch === pitch) {
      dy = ((ascent - descent) / 2) * (pitch / content - 1);
    } else {
      const boxHeight = element.h / fontSize;
      const pptHeight = lines * pitch + (count - 1) * gap;
      const cssHeight = lines * cssPitch;
      const offset = (height) => (element.valign === 'middle' ? (boxHeight - height) / 2 : element.valign === 'bottom' ? boxHeight - height : 0);
      dy = offset(pptHeight) + (pitch * ascent) / content - (offset(cssHeight) + (cssPitch - content) / 2 + ascent);
      element.lineHeight = round(cssPitch, 3);
      report.spaced += 1;
    }
    element.y = round(element.y + dy * fontSize);
    // PowerPoint lets text spill past its placeholder; grow the box around its anchor instead so
    // the text stays where PowerPoint draws it and Bento does not flag an overflow.
    const textHeight = perParagraph && count ? lines * cssPitch * fontSize : 0;
    if (textHeight > element.h + 0.5) {
      const needed = Math.ceil(textHeight) + 1;
      const extra = needed - element.h;
      if (element.valign === 'middle') element.y = round(element.y - extra / 2);
      else if (element.valign === 'bottom') element.y = round(element.y - extra);
      element.h = needed;
      report.grown += 1;
    }
    report.calibrated += 1;
  }
  return { ...report, skipped: [...report.skipped] };
}

/** Replace `element` with top-aligned boxes placed where PowerPoint sets each paragraph. */
function splitElement(element, parts, perParagraph, { pitch, gap, ascent, descent, owner }) {
  const fontSize = element.fontSize;
  const content = ascent + descent;
  const boxHeight = element.h / fontSize;
  const pptHeight = perParagraph.reduce((total, n) => total + n * pitch, 0) + (parts.length - 1) * gap;
  const top = element.valign === 'middle' ? (boxHeight - pptHeight) / 2 : element.valign === 'bottom' ? boxHeight - pptHeight : 0;
  const dy = ((ascent - descent) / 2) * (pitch / content - 1);
  const groupId = `${element.id}-group`;
  const base = { ...element };
  let offset = top;
  const pieces = parts.map((html, k) => {
    const piece = k === 0 ? element : { ...base, id: `${base.id}-p${k + 1}`, morphId: base.morphId ? `${base.morphId}-p${k + 1}` : undefined };
    if (piece.morphId === undefined) delete piece.morphId;
    Object.assign(piece, {
      html,
      groupId,
      valign: 'top',
      lineHeight: round(pitch, 3),
      y: round(base.y + (offset + dy) * fontSize),
      h: Math.ceil(perParagraph[k] * pitch * fontSize) + 1
    });
    offset += perParagraph[k] * pitch + gap;
    return piece;
  });
  owner.splice(owner.indexOf(element) + 1, 0, ...pieces.slice(1));
}
