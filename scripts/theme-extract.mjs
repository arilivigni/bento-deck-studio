#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readZip } from './lib/zip.mjs';
import { descendants, kid, kids, parseXml } from './lib/xml.mjs';
import {
  DEFAULT_CLR_MAP, DEFAULT_INSETS, bodyProps, clrMapFrom, colorContext, customPath, formatScheme,
  geometryOf, levelNode, luminance, paragraphStyle, resolveColor, resolveFill, resolveLine, runStyle,
  schemeFromTheme, styleFill, xfrmOf
} from './lib/ooxml.mjs';
import { fontStack, parseTypeface } from './lib/fonts.mjs';

export const SCHEMA_VERSION = 2;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
const MAX_ASSET_BYTES = 1_500_000;
const MAX_TOTAL_ASSET_BYTES = 8_000_000;
const ALIGN = { l: 'left', ctr: 'center', r: 'right', just: 'left', dist: 'left', justLow: 'left', thaiDist: 'left' };
const VALIGN = { t: 'top', ctr: 'middle', b: 'bottom', just: 'top', dist: 'top' };
const MEDIA_TYPES = new Set(['pic', 'chart', 'tbl', 'dgm', 'media', 'clipArt']);
const BENTO_TOKENS = ['tx1', 'bg1', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'tx2', 'bg2', 'hlink', 'folHlink'];
const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

function openPackage(buffer) {
  const files = readZip(buffer);
  const parsed = new Map();
  const xml = (name) => {
    if (!parsed.has(name)) {
      const data = files.get(name);
      parsed.set(name, data ? parseXml(data.toString('utf8')) : null);
    }
    return parsed.get(name);
  };
  const rels = (name) => {
    const relName = path.posix.join(path.posix.dirname(name), '_rels', `${path.posix.basename(name)}.rels`);
    const map = new Map();
    for (const rel of kids(xml(relName), 'Relationship')) {
      const { Id, Target, Type = '', TargetMode } = rel.attrs;
      if (!Id || !Target) continue;
      const external = TargetMode === 'External';
      const target = external ? Target : Target.startsWith('/')
        ? Target.slice(1)
        : path.posix.normalize(path.posix.join(path.posix.dirname(name), Target));
      map.set(Id, { type: Type.split('/').pop(), target, external });
    }
    return map;
  };
  return { files, xml, rels };
}

const partNumber = (name) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);
const sortedParts = (files, pattern) => [...files.keys()].filter((name) => pattern.test(name)).sort((a, b) => partNumber(a) - partNumber(b));

function orderedTargets(pkg, partName, listNode, itemName, fallback) {
  const rels = pkg.rels(partName);
  const ordered = kids(listNode, itemName)
    .map((item) => rels.get(item.attrs['r:id'])?.target)
    .filter((target) => target && pkg.files.has(target));
  return ordered.length ? ordered : fallback;
}

function loadTheme(pkg, name) {
  const root = pkg.xml(name);
  if (!root) return null;
  const fontScheme = descendants(root, 'a:fontScheme')[0];
  const latin = (kind) => kid(kid(fontScheme, kind), 'a:latin')?.attrs.typeface ?? '';
  return {
    part: name,
    name: kid(root, 'a:themeElements') ? root.attrs.name ?? '' : '',
    scheme: schemeFromTheme(root),
    fonts: { major: latin('a:majorFont'), minor: latin('a:minorFont') },
    fmt: formatScheme(root)
  };
}

function textOf(txBody) {
  return kids(txBody, 'a:p')
    .map((paragraph) => descendants(paragraph, 'a:t').map((node) => node.text).join(''))
    .join('\n')
    .trim();
}

function resolveTypeface(typeface, theme, kind) {
  if (!typeface || typeface.startsWith('+mj')) return typeface ? theme.fonts.major : kind === 'title' ? theme.fonts.major : theme.fonts.minor;
  if (typeface.startsWith('+mn')) return theme.fonts.minor;
  return typeface;
}

function txStyleKind(type) {
  if (type === 'title' || type === 'ctrTitle') return 'title';
  if (type === 'dt' || type === 'ftr' || type === 'sldNum' || type === 'hdr') return 'other';
  return 'body';
}

function masterPlaceholderKey(type) {
  if (type === 'title' || type === 'ctrTitle') return 'title';
  if (['dt', 'ftr', 'sldNum', 'hdr'].includes(type)) return type;
  return 'body';
}

/** Collapse resolved paragraph/run/body fragments into Bento-ready text style values. */
function finishTextStyle(merged, body, ctx, theme, kind, geometry) {
  const face = parseTypeface(resolveTypeface(merged.typeface, theme, kind));
  const family = face.family || 'system-ui';
  const sizePt = merged.sizePt ?? 18;
  const baseWeight = face.weight ?? 400;
  const color = merged.color ?? resolveColor({ name: 'a:schemeClr', attrs: { val: 'tx1' }, children: [] }, ctx);
  let lineHeight = 1.2;
  if (merged.lineSpacingPct) lineHeight = merged.lineSpacingPct * 1.2;
  else if (merged.lineSpacingPts) lineHeight = merged.lineSpacingPts / sizePt;
  return {
    family,
    fontFamily: fontStack(family),
    fontSize: round(sizePt * geometry.ptToPx),
    fontWeight: merged.bold ? Math.max(700, baseWeight) : baseWeight,
    italic: Boolean(merged.italic || face.italic),
    color: color?.css ?? '#000000',
    ...(color?.ref ? { colorRef: color.ref } : {}),
    lineHeight: round(Math.min(4, Math.max(0.6, lineHeight)), 3),
    letterSpacing: merged.spacingPt ? round(merged.spacingPt * geometry.ptToPx) : 0,
    align: ALIGN[merged.algn] ?? 'left',
    valign: VALIGN[body.anchor] ?? 'top',
    caps: merged.cap === 'all',
    bullet: merged.bullet ?? null,
    ...(merged.marL ? { indent: round(Number(merged.marL) * geometry.sx) } : {}),
    ...(merged.spaceBeforePts ? { spaceBefore: round(merged.spaceBeforePts * geometry.ptToPx) } : {}),
    autofit: body.autofit ?? 'none',
    ...(body.vert && body.vert !== 'horz' ? { vert: body.vert } : {})
  };
}

function frameToBox(xfrm, insets, geometry) {
  const ins = insets ?? DEFAULT_INSETS;
  const x = (xfrm.x + ins.l) * geometry.sx;
  const y = (xfrm.y + ins.t) * geometry.sy;
  const w = Math.max(4, (xfrm.cx - ins.l - ins.r) * geometry.sx);
  const h = Math.max(4, (xfrm.cy - ins.t - ins.b) * geometry.sy);
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

function placeholderRole(type, prompt, style, box, geometry) {
  if (type === 'title' || type === 'ctrTitle') return 'title';
  if (type === 'subTitle') return 'subtitle';
  if (type === 'dt') return 'date';
  if (type === 'ftr') return 'footer';
  if (type === 'sldNum') return 'slideNumber';
  if (MEDIA_TYPES.has(type)) return 'media';
  const text = prompt.toLowerCase();
  if (/optional header|eyebrow|kicker|overline|section label|category/.test(text)) return 'eyebrow';
  if (/^optional$|footer|source/.test(text) || (box.y > geometry.height * 0.86 && style.fontSize <= 16 * geometry.ptToPx * 0.75)) return 'footer';
  if (/\bsub-?title\b|subhead|tagline/.test(text)) return 'subtitle';
  if (/\btitle\b|headline|heading/.test(text)) return 'title';
  if (box.y < geometry.height * 0.2 && box.h < geometry.height * 0.08 && style.fontSize <= 20 * geometry.ptToPx) return 'eyebrow';
  return 'body';
}

function normalizeRoles(placeholders) {
  const text = placeholders.filter((ph) => ph.role !== 'media');
  const titles = text.filter((ph) => ph.role === 'title');
  if (titles.length > 1) {
    titles.sort((a, b) => b.style.fontSize - a.style.fontSize || a.box.y - b.box.y);
    for (const extra of titles.slice(1)) extra.role = 'body';
  }
  if (!text.some((ph) => ph.role === 'title')) {
    const candidate = text
      .filter((ph) => ph.role === 'body' || ph.role === 'subtitle')
      .sort((a, b) => b.style.fontSize - a.style.fontSize || a.box.y - b.box.y)[0];
    if (candidate && candidate.style.fontSize >= 24) candidate.role = 'title';
  }
  const bodies = text.filter((ph) => ph.role === 'body');
  bodies.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
  if (bodies[0]) bodies[0].primary = true;
}

const DATA_FIELDS = { slidenum: '{{page}}' };

function escapeHtml(text) {
  return String(text).replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
}

/** Furniture converter: turns master/layout drawing trees into locked Bento elements. */
function createConverter(context) {
  const { pkg, geometry, assets, report } = context;
  let counter = 0;

  function addAsset(partName) {
    if (!partName || !pkg.files.has(partName)) return null;
    const ext = path.posix.extname(partName).slice(1).toLowerCase();
    const mime = MIME[ext];
    if (!mime) {
      report.unsupportedMedia.add(path.posix.basename(partName));
      return null;
    }
    const key = `tpl-${path.posix.basename(partName).toLowerCase().replace(/[^a-z0-9.-]+/g, '-')}`;
    if (assets.has(key)) return key;
    const data = pkg.files.get(partName);
    if (data.length > MAX_ASSET_BYTES || assets.bytes + data.length > MAX_TOTAL_ASSET_BYTES) {
      report.skippedMedia.add(path.posix.basename(partName));
      return null;
    }
    assets.set(key, `data:${mime};base64,${data.toString('base64')}`);
    assets.bytes += data.length;
    return key;
  }

  function blipTarget(blip, rels) {
    const svg = descendants(blip, 'asvg:svgBlip')[0]?.attrs['r:embed'];
    const raster = blip?.attrs['r:embed'];
    for (const id of [svg, raster]) {
      const rel = id ? rels.get(id) : null;
      if (rel && !rel.external && pkg.files.has(rel.target)) return rel.target;
    }
    return null;
  }

  function nextId() {
    counter += 1;
    return `f${counter}`;
  }

  function mapRect(map, xfrm) {
    return map({ x: xfrm.x, y: xfrm.y, w: xfrm.cx, h: xfrm.cy });
  }

  function pxRect(rect) {
    return { x: rect.x * geometry.sx, y: rect.y * geometry.sy, w: rect.w * geometry.sx, h: rect.h * geometry.sy };
  }

  function onSlide(px) {
    return px.x < geometry.width - 0.5 && px.y < geometry.height - 0.5 && px.x + px.w > 0.5 && px.y + px.h > 0.5;
  }

  function bentoColor(color, slots) {
    if (!color) return {};
    const ref = color.ref && (slots[color.ref] === color.hex ? color.ref : BENTO_TOKENS.find((token) => slots[token] === color.hex));
    return { css: color.css, ref: color.alpha >= 1 ? ref : undefined };
  }

  function flipPath(d, w, h, flipH, flipV) {
    if (!flipH && !flipV) return d;
    const fx = (x) => (flipH ? w - x : x);
    const fy = (y) => (flipV ? h - y : y);
    return d.replace(/([MLCQAZ])([^MLCQAZ]*)/g, (whole, command, args) => {
      const nums = args.trim() ? args.trim().split(/\s+/).map(Number) : [];
      if (command === 'Z') return 'Z ';
      if (command === 'A') {
        const [rx, ry, rot, large, sweep, x, y] = nums;
        return `A${rx} ${ry} ${rot} ${large} ${flipH !== flipV ? 1 - sweep : sweep} ${round(fx(x))} ${round(fy(y))} `;
      }
      const pairs = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pairs.push(`${round(fx(nums[i]))} ${round(fy(nums[i + 1]))}`);
      return `${command}${pairs.join(' ')} `;
    }).trim();
  }

  function presetPath(preset, adjust, w, h) {
    const min = Math.min(w, h);
    switch (preset) {
      case 'rtTriangle': return `M0 0 L0 ${h} L${w} ${h} Z`;
      case 'diamond': return `M${w / 2} 0 L${w} ${h / 2} L${w / 2} ${h} L0 ${h / 2} Z`;
      case 'parallelogram': {
        const o = min * (adjust.adj ?? 25000) / 100000;
        return `M${o} 0 L${w} 0 L${w - o} ${h} L0 ${h} Z`;
      }
      case 'triangle': {
        const apex = w * (adjust.adj ?? 50000) / 100000;
        return `M${apex} 0 L${w} ${h} L0 ${h} Z`;
      }
      case 'chevron': {
        const o = min * (adjust.adj ?? 50000) / 100000;
        return `M0 0 L${w - o} 0 L${w} ${h / 2} L${w - o} ${h} L0 ${h} L${o} ${h / 2} Z`;
      }
      case 'homePlate': {
        const o = min * (adjust.adj ?? 50000) / 100000;
        return `M0 0 L${w - o} 0 L${w} ${h / 2} L${w - o} ${h} L0 ${h} Z`;
      }
      default: return null;
    }
  }

  function shapeElement(spPr, style, ctx, slots, theme, px, xfrm, isConnector) {
    const geometryInfo = geometryOf(spPr);
    const fill = resolveFill(spPr, ctx) ?? styleFill(style, ctx, theme.fmt);
    const line = resolveLine(kid(spPr, 'a:ln'), style, ctx, theme.fmt);
    const preset = geometryInfo.preset;
    const lineLike = isConnector || /^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/.test(preset ?? '');
    const hasFill = fill && fill.kind !== 'none' && fill.kind !== 'group' && fill.kind !== 'image';
    if (!hasFill && !line && fill?.kind !== 'image') return null;
    const base = {
      id: nextId(), x: round(px.x), y: round(px.y), w: round(Math.max(px.w, 1)), h: round(Math.max(px.h, 1)),
      rotation: round(xfrm.rot ?? 0), opacity: 1, locked: true
    };
    if (fill?.kind === 'image') {
      const target = blipTarget(fill.blip, context.rels);
      const key = target ? addAsset(target) : null;
      return key ? { ...base, type: 'image', src: `asset:${key}`, fit: fill.srcRect && Object.keys(fill.srcRect.attrs).length ? 'cover' : 'fill' } : null;
    }
    const element = { ...base, type: 'shape' };
    const themeRefs = {};
    if (hasFill && fill.kind === 'solid') {
      const color = bentoColor(fill.color, slots);
      element.fill = color.css;
      if (color.ref) themeRefs.fill = color.ref;
    } else if (hasFill && fill.kind === 'gradient') {
      element.fill = fill.gradient.stops[0].color;
      element.fillGradient = fill.gradient;
    } else {
      element.fill = 'transparent';
    }
    if (line) {
      const color = bentoColor(line.color, slots);
      element.stroke = color.css;
      if (color.ref) themeRefs.stroke = color.ref;
      element.strokeWidth = round(Math.max(0.5, line.width * geometry.sx));
      if (line.style !== 'solid') element.strokeStyle = line.style;
    } else {
      element.strokeWidth = 0;
    }
    const w = element.w;
    const h = element.h;
    if (lineLike) {
      const stroke = element.strokeWidth || 1;
      const flatH = px.h < stroke;
      const flatW = px.w < stroke;
      if (flatH) { element.h = round(stroke); element.y = round(px.y - stroke / 2); }
      if (flatW) { element.w = round(stroke); element.x = round(px.x - stroke / 2); }
      const x1 = flatW ? element.w / 2 : 0;
      const y1 = flatH ? element.h / 2 : 0;
      const x2 = flatW ? element.w / 2 : element.w;
      const y2 = flatH ? element.h / 2 : element.h;
      element.shape = 'path';
      element.fill = 'transparent';
      delete element.fillGradient;
      delete themeRefs.fill;
      element.d = flipPath(`M${round(x1)} ${round(y1)} L${round(x2)} ${round(y2)}`, element.w, element.h, xfrm.flipH, xfrm.flipV);
      element.pathBox = [0, 0, element.w, element.h];
    } else if (geometryInfo.custom) {
      element.shape = 'path';
      element.d = flipPath(customPath(geometryInfo.custom, w, h), w, h, xfrm.flipH, xfrm.flipV);
      element.pathBox = [0, 0, w, h];
      if (!element.d) return null;
    } else if (preset === 'ellipse' || preset === 'flowChartConnector') {
      element.shape = 'ellipse';
    } else if (preset === 'rect' || preset === 'flowChartProcess') {
      element.shape = 'rect';
    } else if (preset === 'roundRect') {
      element.shape = 'rect';
      element.radius = round(Math.min(w, h) * (geometryInfo.adjust.adj ?? 16667) / 100000);
    } else {
      const d = presetPath(preset, geometryInfo.adjust, w, h);
      if (d) {
        element.shape = 'path';
        element.d = flipPath(d, w, h, xfrm.flipH, xfrm.flipV);
        element.pathBox = [0, 0, w, h];
      } else {
        element.shape = 'rect';
        report.approximatedShapes.add(preset);
      }
    }
    if (Object.keys(themeRefs).length) element.themeRefs = themeRefs;
    return element;
  }

  function runHtml(paragraph, base, ctx, slots) {
    const pieces = [];
    let firstColor = null;
    for (const child of paragraph.children) {
      let text = '';
      let rPr = null;
      if (child.name === 'a:r') {
        text = kid(child, 'a:t')?.text ?? '';
        rPr = kid(child, 'a:rPr');
      } else if (child.name === 'a:fld') {
        rPr = kid(child, 'a:rPr');
        const type = String(child.attrs.type ?? '').toLowerCase();
        text = DATA_FIELDS[type] ?? (type.startsWith('datetime') ? '{{date}}' : kid(child, 'a:t')?.text ?? '');
      } else if (child.name === 'a:br') {
        pieces.push('<br>');
        continue;
      } else {
        continue;
      }
      if (!text) continue;
      const run = runStyle(rPr, ctx);
      if (!firstColor && run.color) firstColor = run.color;
      const caps = (run.cap ?? base.cap) === 'all';
      let html = escapeHtml(caps ? text.toUpperCase() : text);
      if (run.bold === true && !base.bold) html = `<b>${html}</b>`;
      if (run.italic === true && !base.italic) html = `<i>${html}</i>`;
      pieces.push(html);
    }
    return { html: pieces.join(''), firstColor: firstColor ? bentoColor(firstColor, slots) : null };
  }

  function textElement(txBody, xfrmPx, xfrm, ctx, slots, theme, baseStyle) {
    const body = bodyProps(kid(txBody, 'a:bodyPr'), { insets: DEFAULT_INSETS, anchor: 't' });
    const paragraphs = kids(txBody, 'a:p');
    if (!paragraphs.some((paragraph) => descendants(paragraph, 'a:t').some((node) => node.text.trim()))) return null;
    const lst = kid(txBody, 'a:lstStyle');
    const firstPPr = kid(paragraphs[0], 'a:pPr');
    const level = Number(firstPPr?.attrs.lvl ?? 0) + 1;
    const firstRun = paragraphs.flatMap((paragraph) => kids(paragraph).filter((child) => child.name === 'a:r' || child.name === 'a:fld'))[0];
    const merged = {
      ...baseStyle,
      ...paragraphStyle(levelNode(lst, level), ctx),
      ...paragraphStyle(firstPPr, ctx),
      ...runStyle(kid(firstRun, 'a:rPr'), ctx)
    };
    const style = finishTextStyle(merged, body, ctx, theme, 'other', geometry);
    const parts = paragraphs.map((paragraph) => runHtml(paragraph, merged, ctx, slots));
    const html = parts.map((part) => part.html).join('<br>').replace(/(<br>)+$/, '');
    if (!html) return null;
    const insets = body.insets ?? DEFAULT_INSETS;
    const box = {
      x: xfrmPx.x + insets.l * geometry.sx,
      y: xfrmPx.y + insets.t * geometry.sy,
      w: Math.max(4, xfrmPx.w - (insets.l + insets.r) * geometry.sx),
      h: Math.max(4, xfrmPx.h - (insets.t + insets.b) * geometry.sy)
    };
    const color = merged.color ? bentoColor(merged.color, slots) : { css: style.color, ref: undefined };
    const element = {
      id: nextId(), type: 'text', x: round(box.x), y: round(box.y), w: round(box.w), h: round(box.h),
      rotation: round(xfrm.rot ?? 0), opacity: 1, locked: true,
      html: style.italic ? `<i>${html}</i>` : html,
      fontSize: style.fontSize, fontFamily: style.fontFamily, fontWeight: style.fontWeight,
      color: color.css, align: style.align, valign: style.valign, lineHeight: style.lineHeight
    };
    if (style.letterSpacing) element.letterSpacing = style.letterSpacing;
    if (color.ref) element.themeRefs = { color: color.ref };
    rotateVertical(element, style.vert);
    return element;
  }

  function rotateVertical(element, vert) {
    if (!vert || !/^(vert|vert270|eaVert|wordArtVert)$/.test(vert)) return;
    const cx = element.x + element.w / 2;
    const cy = element.y + element.h / 2;
    const w = element.h;
    const h = element.w;
    element.w = round(w);
    element.h = round(h);
    element.x = round(cx - w / 2);
    element.y = round(cy - h / 2);
    element.rotation = round((element.rotation ?? 0) + (vert === 'vert270' ? 270 : 90)) % 360;
  }

  function walk(nodes, map, scope, out) {
    for (const node of nodes) {
      if (node.name === 'mc:AlternateContent') {
        const branch = kid(node, 'mc:Fallback') ?? kid(node, 'mc:Choice');
        walk(kids(branch), map, scope, out);
        continue;
      }
      const nv = kid(node, 'p:nvSpPr') ?? kid(node, 'p:nvPicPr') ?? kid(node, 'p:nvCxnSpPr') ?? kid(node, 'p:nvGrpSpPr');
      if (!nv) continue;
      if (kid(nv, 'p:cNvPr')?.attrs.hidden === '1') continue;
      if (kid(kid(nv, 'p:nvPr'), 'p:ph')) continue;
      if (node.name === 'p:grpSp') {
        const xfrm = xfrmOf(kid(kid(node, 'p:grpSpPr'), 'a:xfrm'));
        if (!xfrm) continue;
        const outer = mapRect(map, xfrm);
        const chCx = xfrm.chCx || xfrm.cx || 1;
        const chCy = xfrm.chCy || xfrm.cy || 1;
        const chX = xfrm.chX ?? xfrm.x;
        const chY = xfrm.chY ?? xfrm.y;
        const inner = (rect) => ({
          x: outer.x + (rect.x - chX) * (outer.w / chCx),
          y: outer.y + (rect.y - chY) * (outer.h / chCy),
          w: rect.w * (outer.w / chCx),
          h: rect.h * (outer.h / chCy)
        });
        walk(kids(node), inner, scope, out);
        continue;
      }
      const spPr = kid(node, 'p:spPr');
      const xfrm = xfrmOf(kid(spPr, 'a:xfrm'));
      if (!xfrm) continue;
      const px = pxRect(mapRect(map, xfrm));
      if (!onSlide(px)) continue;
      const style = kid(node, 'p:style');
      if (node.name === 'p:pic') {
        const target = blipTarget(kid(kid(node, 'p:blipFill'), 'a:blip'), context.rels);
        const key = target ? addAsset(target) : null;
        if (!key) continue;
        const srcRect = kid(kid(node, 'p:blipFill'), 'a:srcRect');
        const alpha = descendants(kid(node, 'p:blipFill'), 'a:alphaModFix')[0]?.attrs.amt;
        out.push({
          id: nextId(), type: 'image', src: `asset:${key}`,
          x: round(px.x), y: round(px.y), w: round(Math.max(px.w, 1)), h: round(Math.max(px.h, 1)),
          rotation: round(xfrm.rot), opacity: alpha ? round(Number(alpha) / 100000, 3) : 1, locked: true,
          fit: srcRect && Object.keys(srcRect.attrs).length ? 'cover' : 'fill'
        });
        continue;
      }
      if (node.name === 'p:sp' || node.name === 'p:cxnSp') {
        const shape = shapeElement(spPr, style, scope.ctx, scope.slots, scope.theme, px, xfrm, node.name === 'p:cxnSp');
        if (shape) out.push(shape);
        const txBody = kid(node, 'p:txBody');
        if (txBody) {
          const fontRef = kid(style, 'a:fontRef');
          const base = { ...scope.otherStyle };
          if (fontRef) {
            const color = resolveColor(fontRef, scope.ctx);
            if (color) base.color = color;
            if (fontRef.attrs.idx === 'major') base.typeface = '+mj-lt';
          }
          const text = textElement(txBody, px, xfrm, scope.ctx, scope.slots, scope.theme, base);
          if (text) out.push(text);
        }
      }
    }
    return out;
  }

  return {
    furniture(spTree, scope) {
      return walk(kids(spTree), (rect) => rect, scope, []);
    },
    background(bg, scope, fallback) {
      if (!bg) return fallback;
      const bgPr = kid(bg, 'p:bgPr');
      const bgRef = kid(bg, 'p:bgRef');
      let fill = null;
      if (bgPr) fill = resolveFill(bgPr, scope.ctx);
      else if (bgRef) {
        const phClr = resolveColor(bgRef, scope.ctx);
        const index = Number(bgRef.attrs.idx ?? 0);
        const entry = index >= 1001 ? scope.theme.fmt.backgrounds[index - 1001] : scope.theme.fmt.fills[index - 1];
        fill = entry ? resolveFill({ children: [entry] }, scope.ctx, phClr) : phClr ? { kind: 'solid', color: phClr } : null;
      }
      if (!fill || fill.kind === 'none') return fallback;
      if (fill.kind === 'solid') return { kind: 'solid', color: fill.color.hex, ...(fill.color.ref ? { ref: fill.color.ref } : {}) };
      if (fill.kind === 'gradient') return { kind: 'gradient', color: fill.gradient.stops[0].color, gradient: fill.gradient };
      if (fill.kind === 'image') {
        const target = blipTarget(fill.blip, context.rels);
        const key = target ? addAsset(target) : null;
        return key ? { kind: 'image', color: fallback?.color ?? scope.ctx.scheme.bg1, asset: key } : fallback;
      }
      return fallback;
    }
  };
}

function safeBackgroundRef(background, slots) {
  if (!background || background.kind !== 'solid') return background;
  const hex = background.color?.toUpperCase();
  if (!background.ref) return slots.bg1?.toUpperCase() === hex ? { ...background, ref: 'bg1' } : background;
  const ref = slots[background.ref]?.toUpperCase() === hex ? background.ref : BENTO_TOKENS.find((token) => slots[token]?.toUpperCase() === hex);
  const { ref: _drop, ...rest } = background;
  return ref ? { ...rest, ref } : rest;
}

function bentoSlots(theme) {
  const palette = theme.palette ?? {};
  return {
    bg1: theme.background, tx1: theme.color, accent1: theme.accent,
    bg2: palette.bg2 ?? theme.color, tx2: palette.tx2 ?? theme.background,
    accent2: palette.accent2 ?? theme.accent, accent3: palette.accent3 ?? theme.accent,
    accent4: palette.accent4 ?? theme.accent, accent5: palette.accent5 ?? theme.accent,
    accent6: palette.accent6 ?? theme.accent, hlink: palette.hlink, folHlink: palette.folHlink
  };
}

const ROLE_RULES = {
  cover: [
    (l) => l.type === 'title',
    (l) => /^title\s*slide$/i.test(l.name),
    (l) => /\bcover\b|opening|title\s*card/i.test(l.name),
    (l) => /^title\s*(and|&|\+)\s*sub-?title$/i.test(l.name)
  ],
  content: [
    (l) => l.type === 'obj',
    (l) => /^title\s*(and|&|,|\+)\s*(content|body|text)$/i.test(l.name),
    (l) => /content|bullet|text/i.test(l.name)
  ],
  section: [
    (l) => l.type === 'secHead',
    (l) => /section|divider|chapter/i.test(l.name)
  ],
  statement: [(l) => /large statement|^statement|big idea/i.test(l.name)],
  closing: [(l) => /thank|closing|questions|q\s*&\s*a|^end\b/i.test(l.name)],
  titleOnly: [(l) => l.type === 'titleOnly', (l) => /title\s*only/i.test(l.name)],
  blank: [(l) => l.type === 'blank', (l) => /^blank$/i.test(l.name)]
};

function has(layout, role) {
  return layout.placeholders.some((ph) => ph.role === role);
}

function usableFor(role, layout) {
  const title = has(layout, 'title');
  const text = has(layout, 'body') || has(layout, 'subtitle');
  switch (role) {
    case 'cover': return title;
    case 'content': return title && text;
    case 'section': return title;
    case 'statement': return title || text;
    case 'titleOnly': return title;
    default: return true;
  }
}

/** Area of the largest text placeholder that can hold bullets. */
function bodyArea(layout) {
  return Math.max(0, ...layout.placeholders.filter((ph) => ph.role === 'body' || ph.role === 'subtitle').map((ph) => ph.box.w * ph.box.h));
}

/** Prefer one large text area with few competing placeholders (columns, pictures, captions). */
function contentScore(layout, size) {
  const others = layout.placeholders.filter((ph) => !['title', 'eyebrow', 'footer', 'slideNumber', 'date'].includes(ph.role)).length - 1;
  return bodyArea(layout) / (size.width * size.height) - 0.03 * Math.max(0, others);
}

/** Axis-aligned bounds of a furniture item, honouring quarter-turn rotations. */
function itemBounds(item) {
  const turn = (((item.rotation ?? 0) % 180) + 180) % 180;
  if (Math.abs(turn - 90) > 1) return { x: item.x, y: item.y, w: item.w, h: item.h };
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  return { x: cx - item.h / 2, y: cy - item.w / 2, w: item.h, h: item.w };
}

/**
 * Masters without a "Title and Content" layout still need bullet slides. Find the clear area
 * under a wide title, bounded by furniture and footer placeholders, and dress it in the
 * layout's own body text style so the result reads like the template.
 */
export function contentRegion(layout, furniture, size) {
  const title = layout.placeholders.find((ph) => ph.role === 'title');
  if (!title || title.box.w < size.width * 0.5 || title.box.y + title.box.h > size.height * 0.45) return null;
  const x = title.box.x;
  const w = Math.min(title.box.w, size.width - x);
  const margin = size.height * 0.04;
  let top = title.box.y + title.box.h + margin;
  let bottom = size.height * 0.9;
  const obstacles = [
    ...furniture.map(itemBounds).filter((b) => b.w * b.h < size.width * size.height * 0.5),
    ...layout.placeholders.filter((ph) => ['footer', 'slideNumber', 'date'].includes(ph.role)).map((ph) => ph.box)
  ];
  // A thin rule just under the title belongs to the header: start the text a margin below it.
  for (const b of obstacles) {
    const thin = b.h <= size.height * 0.01 && b.w >= w * 0.5;
    if (thin && b.y >= title.box.y + title.box.h - 2 && b.y + b.h <= top + 2) top = Math.max(top, b.y + b.h + margin);
  }
  for (const b of obstacles) {
    if (b.x + b.w <= x + 2 || b.x >= x + w - 2 || b.y + b.h <= top + 2) continue;
    if (b.y < top) return null;
    bottom = Math.min(bottom, b.y - size.height * 0.03);
  }
  if (bottom - top < size.height * 0.3) return null;
  const sizes = layout.placeholders.filter((ph) => ph.role === 'body' && ph.style.fontSize >= size.height * 0.025 && ph.style.fontSize <= size.height * 0.05);
  const source = sizes.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0];
  const style = {
    ...(source?.style ?? title.style),
    fontSize: source?.style.fontSize ?? Math.round(size.height * 0.036 * 100) / 100,
    fontWeight: source?.style.fontWeight ?? 400,
    align: title.style.align === 'center' ? 'center' : 'left',
    valign: 'top',
    autofit: 'shrink'
  };
  const box = { x: Math.round(x * 100) / 100, y: Math.round(top * 100) / 100, w: Math.round(w * 100) / 100, h: Math.round((bottom - top) * 100) / 100 };
  return { box, style };
}

function assignRoles(layouts, size, furnitureOf = () => []) {
  const roles = {};
  // A bullet slide needs a real text area: at least a third of the slide wide and a sixth tall.
  const roomy = (layout) => layout.placeholders.some((ph) => (ph.role === 'body' || ph.role === 'subtitle') && ph.box.w >= size.width / 3 && ph.box.h >= size.height / 6);
  for (const [role, rules] of Object.entries(ROLE_RULES)) {
    for (const rule of rules) {
      const match = layouts.find((layout) => rule(layout) && usableFor(role, layout) && (role !== 'content' || roomy(layout)));
      if (match) {
        roles[role] = match.index;
        break;
      }
    }
  }
  const matched = roles.content !== undefined;
  if (!matched) {
    const regions = layouts
      .filter((layout) => usableFor('titleOnly', layout))
      .map((layout) => ({ layout, region: contentRegion(layout, furnitureOf(layout.index), size) }))
      .filter((entry) => entry.region)
      .sort((a, b) => b.region.box.w * b.region.box.h - a.region.box.w * a.region.box.h);
    if (regions.length) {
      roles.content = regions[0].layout.index;
      regions[0].layout.contentBody = regions[0].region;
    }
  }
  if (roles.content === undefined) {
    const best = layouts
      .filter((layout) => usableFor('content', layout))
      .sort((a, b) => contentScore(b, size) - contentScore(a, size))[0];
    if (best) roles.content = best.index;
  }
  roles.cover ??= roles.content;
  roles.section ??= roles.titleOnly ?? roles.statement ?? roles.cover;
  return { roles, matched };
}

export function extractTheme(buffer, sourceName = 'presentation.pptx') {
  const pkg = openPackage(buffer);
  const themeParts = sortedParts(pkg.files, /^ppt\/theme\/theme\d+\.xml$/);
  if (!themeParts.length) throw new Error('No PowerPoint theme XML was found. Supply a PPTX or POTX with a theme.');
  const presentation = pkg.xml('ppt/presentation.xml');
  const sldSz = kid(presentation, 'p:sldSz');
  const cx = Number(sldSz?.attrs.cx ?? 12192000);
  const cy = Number(sldSz?.attrs.cy ?? 6858000);
  const width = Math.round(cx / 9525);
  const height = Math.round(cy / 9525);
  if (width < 320 || width > 3840 || height < 240 || height > 3840) {
    throw new Error('The PowerPoint slide dimensions are outside the supported range.');
  }
  const geometry = { width, height, sx: width / cx, sy: height / cy, ptToPx: 12700 * (width / cx) };
  const defaultText = paragraphStyle(levelNode(kid(presentation, 'p:defaultTextStyle'), 1), colorContext({}));
  const themeCache = new Map();
  const themeFor = (name) => {
    if (!themeCache.has(name)) themeCache.set(name, loadTheme(pkg, name));
    return themeCache.get(name);
  };
  const primaryTheme = themeFor(themeParts[0]);

  const masterParts = orderedTargets(pkg, 'ppt/presentation.xml', kid(presentation, 'p:sldMasterIdLst'), 'p:sldMasterId',
    sortedParts(pkg.files, /^ppt\/slideMasters\/slideMaster\d+\.xml$/));
  const allLayoutParts = sortedParts(pkg.files, /^ppt\/slideLayouts\/slideLayout\d+\.xml$/);
  const claimed = new Set();
  const masters = masterParts.map((part) => {
    const root = pkg.xml(part);
    const rels = pkg.rels(part);
    const layoutParts = orderedTargets(pkg, part, kid(root, 'p:sldLayoutIdLst'), 'p:sldLayoutId',
      [...rels.values()].filter((rel) => rel.type === 'slideLayout' && pkg.files.has(rel.target)).map((rel) => rel.target));
    layoutParts.forEach((layoutPart) => claimed.add(layoutPart));
    const themeRel = [...rels.values()].find((rel) => rel.type === 'theme');
    return { part, root, rels, theme: (themeRel && themeFor(themeRel.target)) || primaryTheme, layoutParts };
  });
  const orphans = allLayoutParts.filter((part) => !claimed.has(part));
  if (orphans.length) masters.push({ part: null, root: null, rels: new Map(), theme: primaryTheme, layoutParts: orphans });

  const assets = new Map();
  assets.bytes = 0;
  const report = { unsupportedMedia: new Set(), skippedMedia: new Set(), approximatedShapes: new Set() };
  const layouts = [];
  const variants = [];

  masters.forEach((master, masterIndex) => {
    const theme = master.theme;
    const cSld = kid(master.root, 'p:cSld');
    const clrMap = clrMapFrom(kid(master.root, 'p:clrMap'), DEFAULT_CLR_MAP);
    const masterCtx = colorContext(theme.scheme, clrMap);
    const txStyles = kid(master.root, 'p:txStyles');
    const styleLevel = (kind) => paragraphStyle(levelNode(kid(txStyles, kind === 'title' ? 'p:titleStyle' : kind === 'other' ? 'p:otherStyle' : 'p:bodyStyle'), 1), masterCtx);
    const masterPlaceholders = new Map();
    for (const sp of descendants(kid(cSld, 'p:spTree'), 'p:sp')) {
      const ph = kid(kid(kid(sp, 'p:nvSpPr'), 'p:nvPr'), 'p:ph');
      if (!ph) continue;
      const key = masterPlaceholderKey(ph.attrs.type);
      if (!masterPlaceholders.has(key)) masterPlaceholders.set(key, sp);
    }
    const masterConverter = createConverter({ pkg, geometry, assets, report, rels: master.rels });
    const masterFallbackBg = { kind: 'solid', color: masterCtx.scheme.bg1 ?? '#FFFFFF', ref: 'bg1' };
    const masterScope = { ctx: masterCtx, theme, slots: {}, otherStyle: { ...defaultText, ...styleLevel('other') } };
    const masterBackground = masterConverter.background(kid(cSld, 'p:bg'), masterScope, masterFallbackBg);
    // Templates may swap tx1/bg1 per master, so the text colour is what the master's styles actually resolve to.
    const masterTitleLst = levelNode(kid(kid(masterPlaceholders.get('title'), 'p:txBody'), 'a:lstStyle'), 1);
    const textCandidates = [
      paragraphStyle(masterTitleLst, masterCtx).color?.hex,
      styleLevel('title').color?.hex,
      styleLevel('body').color?.hex,
      masterCtx.scheme.tx1
    ].filter(Boolean);
    const background = masterBackground.color;
    const textColor = textCandidates.find((hex) => Math.abs(luminance(hex) - luminance(background)) > 0.3)
      ?? (luminance(background) < 0.5 ? '#FFFFFF' : '#000000');
    const variantTheme = {
      background,
      color: textColor,
      accent: masterCtx.scheme.accent1 ?? '#2563EB',
      fontFamily: fontStack(parseTypeface(theme.fonts.minor).family || 'system-ui'),
      headingFamily: fontStack(parseTypeface(theme.fonts.major || theme.fonts.minor).family || 'system-ui'),
      palette: Object.fromEntries(['accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'bg2', 'tx2', 'hlink', 'folHlink']
        .filter((slot) => masterCtx.scheme[slot])
        .map((slot) => [slot, masterCtx.scheme[slot]])),
      chartPalette: ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map((slot) => masterCtx.scheme[slot]).filter(Boolean)
    };
    const slots = bentoSlots(variantTheme);
    masterScope.slots = slots;
    let masterFurniture = null;
    const getMasterFurniture = () => {
      masterFurniture ??= master.root ? masterConverter.furniture(kid(cSld, 'p:spTree'), masterScope) : [];
      return masterFurniture;
    };
    const variantLayouts = [];
    const pending = new Map();

    for (const layoutPart of master.layoutParts) {
      const root = pkg.xml(layoutPart);
      const layoutCSld = kid(root, 'p:cSld');
      const override = kid(kid(root, 'p:clrMapOvr'), 'a:overrideClrMapping');
      const ctx = override ? colorContext(theme.scheme, clrMapFrom(override, DEFAULT_CLR_MAP)) : masterCtx;
      const scope = { ctx, theme, slots, otherStyle: masterScope.otherStyle };
      const converter = createConverter({ pkg, geometry, assets, report, rels: pkg.rels(layoutPart) });
      const background = converter.background(kid(layoutCSld, 'p:bg'), scope, masterBackground);
      const placeholders = [];
      for (const sp of [...kids(kid(layoutCSld, 'p:spTree')), ...descendants(kid(layoutCSld, 'p:spTree'), 'p:grpSp').flatMap((group) => kids(group))]) {
        if (sp.name !== 'p:sp' && sp.name !== 'p:pic' && sp.name !== 'p:graphicFrame') continue;
        const nv = kid(sp, 'p:nvSpPr') ?? kid(sp, 'p:nvPicPr') ?? kid(sp, 'p:nvGraphicFramePr');
        const ph = kid(kid(nv, 'p:nvPr'), 'p:ph');
        if (!ph) continue;
        const type = ph.attrs.type ?? (sp.name === 'p:pic' ? 'pic' : 'obj');
        const masterSp = masterPlaceholders.get(masterPlaceholderKey(type));
        const ownXfrm = xfrmOf(kid(kid(sp, 'p:spPr'), 'a:xfrm') ?? kid(sp, 'p:xfrm'));
        const xfrm = ownXfrm ?? xfrmOf(kid(kid(masterSp, 'p:spPr'), 'a:xfrm'));
        if (!xfrm) continue;
        const txBody = kid(sp, 'p:txBody');
        const kind = txStyleKind(type);
        const merged = {
          ...defaultText,
          ...styleLevel(kind),
          ...paragraphStyle(levelNode(kid(kid(masterSp, 'p:txBody'), 'a:lstStyle'), 1), ctx),
          ...paragraphStyle(levelNode(kid(txBody, 'a:lstStyle'), 1), ctx)
        };
        const body = bodyProps(kid(txBody, 'a:bodyPr'), bodyProps(kid(kid(masterSp, 'p:txBody'), 'a:bodyPr'), { insets: DEFAULT_INSETS, anchor: kind === 'title' ? 'ctr' : 't' }));
        const style = finishTextStyle(merged, body, ctx, theme, kind, geometry);
        const color = merged.color ?? resolveColor({ name: 'a:schemeClr', attrs: { val: 'tx1' }, children: [] }, ctx);
        const ref = color?.ref && (slots[color.ref] === color.hex ? color.ref : BENTO_TOKENS.find((token) => slots[token] === color.hex));
        if (ref) style.colorRef = ref;
        else delete style.colorRef;
        const box = frameToBox(xfrm, body.insets, geometry);
        const prompt = textOf(txBody);
        const name = kid(nv, 'p:cNvPr')?.attrs.name ?? '';
        placeholders.push({
          type,
          ...(ph.attrs.idx !== undefined ? { index: Number(ph.attrs.idx) } : {}),
          name,
          prompt,
          role: placeholderRole(type, prompt, style, box, geometry),
          frame: { x: xfrm.x, y: xfrm.y, width: xfrm.cx, height: xfrm.cy },
          box,
          style
        });
      }
      normalizeRoles(placeholders);
      const layout = {
        index: layouts.length,
        name: layoutCSld?.attrs.name ?? path.posix.basename(layoutPart, '.xml'),
        file: layoutPart,
        ...(root?.attrs.type ? { type: root.attrs.type } : {}),
        variant: variants.length,
        background: safeBackgroundRef(background, slots),
        placeholders,
        furniture: []
      };
      pending.set(layout.index, () => [
        ...(root?.attrs.showMasterSp !== '0' ? getMasterFurniture() : []),
        ...converter.furniture(kid(layoutCSld, 'p:spTree'), scope)
      ]);
      layouts.push(layout);
      variantLayouts.push(layout);
    }
    if (!variantLayouts.length && master.part === null) return;
    const furnitureCache = new Map();
    const furnitureOf = (index) => {
      if (!furnitureCache.has(index)) furnitureCache.set(index, pending.get(index)());
      return furnitureCache.get(index);
    };
    const { roles, matched } = assignRoles(variantLayouts, { width, height }, furnitureOf);
    for (const index of new Set(Object.values(roles))) layouts[index].furniture = furnitureOf(index);
    for (const layout of variantLayouts) {
      if (!layout.furniture.length) layout.furnitureDeferred = true;
    }
    variants.push({
      index: variants.length,
      name: kid(master.root, 'p:cSld')?.attrs.name || theme.name || `Master ${masterIndex + 1}`,
      file: master.part,
      tone: luminance(variantTheme.background) < 0.4 ? 'dark' : 'light',
      background: masterBackground,
      theme: variantTheme,
      fonts: { heading: theme.fonts.major || theme.fonts.minor, body: theme.fonts.minor || theme.fonts.major },
      roles,
      contentLayout: matched ? 'matched' : layouts[roles.content]?.contentBody ? 'region' : 'fallback'
    });
  });

  if (!variants.length) {
    const ctx = colorContext(primaryTheme.scheme, DEFAULT_CLR_MAP);
    variants.push({
      index: 0, name: primaryTheme.name || 'Theme', file: null, tone: luminance(ctx.scheme.bg1 ?? '#FFFFFF') < 0.4 ? 'dark' : 'light',
      background: { kind: 'solid', color: ctx.scheme.bg1 ?? '#FFFFFF', ref: 'bg1' },
      theme: {
        background: ctx.scheme.bg1 ?? '#FFFFFF', color: ctx.scheme.tx1 ?? '#000000', accent: ctx.scheme.accent1 ?? '#2563EB',
        fontFamily: fontStack(parseTypeface(primaryTheme.fonts.minor).family || 'system-ui'),
        headingFamily: fontStack(parseTypeface(primaryTheme.fonts.major || primaryTheme.fonts.minor).family || 'system-ui')
      },
      fonts: { heading: primaryTheme.fonts.major, body: primaryTheme.fonts.minor },
      roles: {}
    });
  }

  // A master with no bullet-friendly layout borrows a sibling master's "Title and Content",
  // as a PowerPoint author would; the same tone keeps backgrounds consistent.
  for (const variant of variants.filter((item) => item.contentLayout === 'fallback')) {
    const donors = variants.filter((item) => item.contentLayout === 'matched');
    const donor = donors.find((item) => item.tone === variant.tone) ?? donors[0];
    if (!donor) continue;
    const previous = variant.roles.content;
    variant.roles.content = donor.roles.content;
    for (const role of ['cover', 'section']) {
      if (variant.roles[role] === previous) variant.roles[role] = role === 'cover' ? donor.roles.cover ?? donor.roles.content : variant.roles.statement ?? donor.roles.section ?? variant.roles.cover;
    }
    variant.contentLayout = 'borrowed';
    variant.contentFrom = donor.index;
  }

  const usedLayouts = new Set(variants.flatMap((variant) => Object.values(variant.roles)));
  const faces = new Set();
  for (const layout of layouts) {
    for (const ph of layout.placeholders) if (ph.style.family) faces.add(ph.style.family);
  }
  const monoFamily = [...faces].find((family) => /mono|code|consol|courier/i.test(family));
  const media = sortedParts(pkg.files, /^ppt\/media\/[^/]+\.(png|jpe?g|gif|webp|svg)$/i);
  const imageTargets = new Set();
  for (const part of [...masterParts, ...allLayoutParts]) {
    for (const rel of pkg.rels(part).values()) {
      if (rel.type === 'image' && !rel.external && pkg.files.has(rel.target)) imageTargets.add(rel.target);
    }
  }
  const primary = variants[0];
  return pruneAssets({
    schemaVersion: SCHEMA_VERSION,
    source: path.basename(sourceName),
    extractedAt: new Date().toISOString(),
    size: { width, height },
    sizeEmu: { cx, cy },
    theme: primary.theme,
    colors: primaryTheme.scheme,
    fonts: {
      heading: primaryTheme.fonts.major || primaryTheme.fonts.minor,
      body: primaryTheme.fonts.minor || primaryTheme.fonts.major,
      ...(monoFamily ? { mono: monoFamily } : {}),
      faces: [...faces].sort()
    },
    defaultVariant: 0,
    variants,
    layouts: layouts.map((layout) => {
      if (usedLayouts.has(layout.index)) delete layout.furnitureDeferred;
      return layout;
    }),
    assets: Object.fromEntries(assets),
    report: {
      unsupportedMedia: [...report.unsupportedMedia],
      skippedMedia: [...report.skippedMedia],
      approximatedShapes: [...report.approximatedShapes]
    },
    media,
    layoutImageCandidates: [...imageTargets].sort(),
    logoCandidates: media.filter((name) => /(?:logo|mark|brand|icon)/i.test(path.basename(name)))
  });
}

export function extractThemeAssets(buffer) {
  return [...readZip(buffer).entries()]
    .filter(([name]) => /^ppt\/media\/[^/]+\.(png|jpe?g|gif|webp|svg)$/i.test(name))
    .map(([name, data]) => ({ name: path.basename(name), data }));
}

/** Drop asset data no longer referenced by kept furniture or backgrounds. */
export function pruneAssets(themeData) {
  const used = new Set();
  const visit = (value) => {
    if (typeof value === 'string') {
      const match = value.match(/^asset:(.+)$/);
      if (match) used.add(match[1]);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        if (key === 'asset' && typeof inner === 'string') used.add(inner);
        else visit(inner);
      }
    }
  };
  visit(themeData.layouts);
  visit(themeData.variants);
  themeData.assets = Object.fromEntries(Object.entries(themeData.assets ?? {}).filter(([key]) => used.has(key)));
  return themeData;
}

function usage() {
  console.error('Usage: node scripts/theme-extract.mjs <template.pptx|template.potx> --out <theme.json> [--assets-out <directory>]');
}

async function main(args) {
  const input = args[0];
  const outIndex = args.indexOf('--out');
  if (!input || outIndex < 0 || !args[outIndex + 1]) {
    usage();
    process.exitCode = 2;
    return;
  }
  const buffer = await readFile(input);
  const result = extractTheme(buffer, input);
  const assetsIndex = args.indexOf('--assets-out');
  if (assetsIndex >= 0) {
    const assetsOut = args[assetsIndex + 1];
    if (!assetsOut || assetsOut.startsWith('--')) throw new Error('Missing value for --assets-out.');
    await mkdir(assetsOut, { recursive: true });
    for (const { name, data } of extractThemeAssets(buffer)) {
      await writeFile(path.join(assetsOut, name), data, { flag: 'wx' });
    }
    console.log(`Extracted ${result.media.length} media assets to ${assetsOut}`);
  }
  await writeFile(args[outIndex + 1], `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  const summary = result.variants.map((variant) => `${variant.name} (${variant.tone})`).join(', ');
  console.log(`Extracted theme from ${path.basename(input)} to ${args[outIndex + 1]}: ${result.layouts.length} layouts, variants: ${summary}`);
  for (const [label, items] of Object.entries(result.report)) {
    if (items.length) console.warn(`Note — ${label}: ${items.join(', ')}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Theme extraction failed: ${error.message}`);
    process.exitCode = 1;
  });
}
