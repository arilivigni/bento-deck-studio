import { descendants, kid, kids } from './xml.mjs';

export const SCHEME_SLOTS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
export const LOGICAL_SLOTS = ['bg1', 'tx1', 'bg2', 'tx2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
export const DEFAULT_CLR_MAP = {
  bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2',
  accent1: 'accent1', accent2: 'accent2', accent3: 'accent3',
  accent4: 'accent4', accent5: 'accent5', accent6: 'accent6',
  hlink: 'hlink', folHlink: 'folHlink'
};
const COLOR_TAGS = new Set(['a:srgbClr', 'a:schemeClr', 'a:sysClr', 'a:prstClr', 'a:scrgbClr', 'a:hslClr']);
const SYS_COLORS = { windowText: '000000', window: 'FFFFFF', btnFace: 'F0F0F0', highlight: '0078D7', grayText: '6D6D6D' };
const PRESET_COLORS = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00',
  gray: '808080', grey: '808080', silver: 'C0C0C0', orange: 'FFA500', purple: '800080', navy: '000080',
  ltGray: 'D3D3D3', dkGray: 'A9A9A9', darkGray: 'A9A9A9', lightGray: 'D3D3D3'
};

export const DEFAULT_INSETS = { l: 91440, t: 45720, r: 91440, b: 45720 };

export function hexToRgb(hex) {
  const clean = String(hex ?? '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  return [0, 2, 4].map((offset) => Number.parseInt(clean.slice(offset, offset + 2), 16));
}

export function rgbToHex(rgb) {
  return `#${rgb.map((value) => Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export function luminance(hex) {
  const rgb = hexToRgb(hex) ?? [0, 0, 0];
  const linear = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function pct(node, name = 'val') {
  const raw = node?.attrs?.[name];
  if (raw === undefined) return 0;
  return String(raw).endsWith('%') ? Number.parseFloat(raw) / 100 : Number(raw) / 100000;
}

const toLinear = (value) => (value / 255) ** 2.2;
const fromLinear = (value) => 255 * Math.max(0, value) ** (1 / 2.2);

function rgbToHsl([r, g, b]) {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

function hslToRgb({ h, s, l }) {
  const hue = (((h % 360) + 360) % 360) / 360;
  const sat = Math.min(1, Math.max(0, s));
  const lig = Math.min(1, Math.max(0, l));
  if (sat === 0) return [lig * 255, lig * 255, lig * 255];
  const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
  const p = 2 * lig - q;
  const channel = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255];
}

function hslOp(rgb, operation) {
  const hsl = rgbToHsl(rgb);
  operation(hsl);
  return hslToRgb(hsl);
}

/** Build the raw clrScheme slots (dk1..folHlink) from a theme part. */
export function schemeFromTheme(themeRoot) {
  const scheme = {};
  const clrScheme = descendants(themeRoot, 'a:clrScheme')[0];
  for (const slot of SCHEME_SLOTS) {
    const node = kid(clrScheme, `a:${slot}`);
    const srgb = kid(node, 'a:srgbClr')?.attrs.val;
    const sys = kid(node, 'a:sysClr');
    const value = srgb ?? sys?.attrs.lastClr ?? SYS_COLORS[sys?.attrs.val];
    if (value && /^[0-9a-f]{6}$/i.test(value)) scheme[slot] = `#${value.toUpperCase()}`;
  }
  return scheme;
}

export function clrMapFrom(node, base = DEFAULT_CLR_MAP) {
  const map = { ...base };
  for (const slot of LOGICAL_SLOTS) if (node?.attrs?.[slot]) map[slot] = node.attrs[slot];
  return map;
}

/** Colour context: raw scheme plus the logical names a clrMap produces. */
export function colorContext(rawScheme, clrMap = DEFAULT_CLR_MAP) {
  const scheme = { ...rawScheme };
  for (const [logical, target] of Object.entries(clrMap)) {
    if (rawScheme[target]) scheme[logical] = rawScheme[target];
  }
  return { raw: rawScheme, clrMap, scheme };
}

/** Logical theme slot for a raw/logical schemeClr value under the context's clrMap. */
function logicalSlot(value, ctx) {
  if (LOGICAL_SLOTS.includes(value)) return value;
  return Object.entries(ctx.clrMap).find(([, target]) => target === value)?.[0];
}

export function findColorNode(node) {
  if (!node) return null;
  if (COLOR_TAGS.has(node.name)) return node;
  return node.children.find((child) => COLOR_TAGS.has(child.name)) ?? null;
}

/** Resolve a DrawingML colour element (or a parent holding one) to { hex, alpha, css, ref }. */
export function resolveColor(node, ctx, phClr) {
  const color = findColorNode(node);
  if (!color) return null;
  let rgb;
  let ref;
  switch (color.name) {
    case 'a:srgbClr':
      rgb = hexToRgb(color.attrs.val);
      break;
    case 'a:schemeClr': {
      const value = color.attrs.val ?? '';
      if (value === 'phClr') {
        rgb = phClr ? hexToRgb(phClr.hex) : null;
        ref = phClr?.ref;
      } else {
        rgb = hexToRgb(ctx.scheme[value]);
        ref = logicalSlot(value, ctx);
      }
      break;
    }
    case 'a:sysClr':
      rgb = hexToRgb(color.attrs.lastClr ?? SYS_COLORS[color.attrs.val]);
      break;
    case 'a:prstClr':
      rgb = hexToRgb(PRESET_COLORS[color.attrs.val]);
      break;
    case 'a:scrgbClr':
      rgb = [fromLinear(pct(color, 'r')), fromLinear(pct(color, 'g')), fromLinear(pct(color, 'b'))];
      break;
    case 'a:hslClr':
      rgb = hslToRgb({ h: Number(color.attrs.hue ?? 0) / 60000, s: pct(color, 'sat'), l: pct(color, 'lum') });
      break;
    default:
      break;
  }
  if (!rgb) return null;
  let alpha = 1;
  let transformed = false;
  for (const transform of color.children) {
    const value = pct(transform);
    switch (transform.name) {
      case 'a:alpha': alpha = Math.min(1, Math.max(0, value)); break;
      case 'a:alphaMod': alpha = Math.min(1, Math.max(0, alpha * value)); break;
      case 'a:alphaOff': alpha = Math.min(1, Math.max(0, alpha + value)); break;
      case 'a:shade': rgb = rgb.map((v) => fromLinear(toLinear(v) * value)); transformed = true; break;
      case 'a:tint': rgb = rgb.map((v) => fromLinear(toLinear(v) * value + (1 - value))); transformed = true; break;
      case 'a:lumMod': rgb = hslOp(rgb, (hsl) => { hsl.l *= value; }); transformed = true; break;
      case 'a:lumOff': rgb = hslOp(rgb, (hsl) => { hsl.l += value; }); transformed = true; break;
      case 'a:satMod': rgb = hslOp(rgb, (hsl) => { hsl.s *= value; }); transformed = true; break;
      case 'a:satOff': rgb = hslOp(rgb, (hsl) => { hsl.s += value; }); transformed = true; break;
      case 'a:hueMod': rgb = hslOp(rgb, (hsl) => { hsl.h *= value; }); transformed = true; break;
      case 'a:hueOff': rgb = hslOp(rgb, (hsl) => { hsl.h += Number(transform.attrs.val ?? 0) / 60000; }); transformed = true; break;
      case 'a:comp': rgb = hslOp(rgb, (hsl) => { hsl.h += 180; }); transformed = true; break;
      case 'a:inv': rgb = rgb.map((v) => 255 - v); transformed = true; break;
      case 'a:gray': { const g = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]; rgb = [g, g, g]; transformed = true; break; }
      default: break;
    }
  }
  const hex = rgbToHex(rgb);
  const rounded = Math.round(alpha * 1000) / 1000;
  const [r, g, b] = hexToRgb(hex);
  return {
    hex,
    alpha: rounded,
    css: rounded >= 1 ? hex : `rgba(${r},${g},${b},${rounded})`,
    ...(ref && !transformed && rounded >= 1 ? { ref } : {})
  };
}

/** Theme format scheme lists used by p:style fillRef/lnRef and p:bgRef. */
export function formatScheme(themeRoot) {
  const fmt = descendants(themeRoot, 'a:fmtScheme')[0];
  return {
    fills: kids(kid(fmt, 'a:fillStyleLst')),
    lines: kids(kid(fmt, 'a:lnStyleLst')),
    backgrounds: kids(kid(fmt, 'a:bgFillStyleLst'))
  };
}

function gradientFrom(node, ctx, phClr) {
  const stops = kids(kid(node, 'a:gsLst'), 'a:gs')
    .map((stop) => ({ at: Math.min(1, Math.max(0, Number(stop.attrs.pos ?? 0) / 100000)), color: resolveColor(stop, ctx, phClr) }))
    .filter((stop) => stop.color)
    .sort((a, b) => a.at - b.at);
  if (!stops.length) return null;
  const linear = kid(node, 'a:lin');
  const angle = linear ? (Number(linear.attrs.ang ?? 0) / 60000 + 90) % 360 : 180;
  return { angle: Math.round(angle * 100) / 100, stops: stops.map((stop) => ({ at: stop.at, color: stop.color.css })) };
}

/** Resolve a fill holder (spPr, bgPr, a style-list entry) to a fill description. */
export function resolveFill(holder, ctx, phClr) {
  if (!holder) return null;
  for (const child of holder.children) {
    switch (child.name) {
      case 'a:noFill': return { kind: 'none' };
      case 'a:solidFill': {
        const color = resolveColor(child, ctx, phClr);
        return color ? { kind: 'solid', color } : null;
      }
      case 'a:gradFill': {
        const gradient = gradientFrom(child, ctx, phClr);
        return gradient ? { kind: 'gradient', gradient } : null;
      }
      case 'a:blipFill': {
        const blip = kid(child, 'a:blip');
        return blip ? { kind: 'image', blip, srcRect: kid(child, 'a:srcRect') } : null;
      }
      case 'a:pattFill': {
        const color = resolveColor(kid(child, 'a:fgClr'), ctx, phClr);
        return color ? { kind: 'solid', color } : null;
      }
      case 'a:grpFill': return { kind: 'group' };
      default: break;
    }
  }
  return null;
}

/** Fill from p:style fillRef (idx into the theme fill style list). */
export function styleFill(styleNode, ctx, fmt) {
  const ref = kid(styleNode, 'a:fillRef');
  const index = Number(ref?.attrs.idx ?? 0);
  if (!ref || index === 0) return null;
  const phClr = resolveColor(ref, ctx);
  const entry = index >= 1001 ? fmt.backgrounds[index - 1001] : fmt.fills[index - 1];
  if (!entry) return phClr ? { kind: 'solid', color: phClr } : null;
  return resolveFill({ children: [entry] }, ctx, phClr);
}

const DASHES = { dash: 'dashed', lgDash: 'dashed', sysDash: 'dashed', dashDot: 'dashed', lgDashDot: 'dashed', lgDashDotDot: 'dashed', sysDashDot: 'dashed', sysDashDotDot: 'dashed', sysDot: 'dotted', dot: 'dotted' };

/** Resolve a:ln (with optional p:style lnRef fallback) to { color, width(EMU), style } or null. */
export function resolveLine(lineNode, styleNode, ctx, fmt) {
  const ref = kid(styleNode, 'a:lnRef');
  const refIndex = Number(ref?.attrs.idx ?? 0);
  const refColor = ref ? resolveColor(ref, ctx) : null;
  const themeLine = refIndex > 0 ? fmt.lines[refIndex - 1] : null;
  const pick = (name) => (lineNode && kid(lineNode, name)) ?? (themeLine && kid(themeLine, name));
  if (lineNode && kid(lineNode, 'a:noFill')) return null;
  if (!lineNode && !themeLine) return null;
  if (!lineNode && themeLine && kid(themeLine, 'a:noFill')) return null;
  const fill = (lineNode && resolveFill(lineNode, ctx, refColor)) ?? (themeLine && resolveFill(themeLine, ctx, refColor));
  if (!fill || fill.kind === 'none') return null;
  const color = fill.kind === 'solid' ? fill.color : fill.kind === 'gradient' ? { css: fill.gradient.stops[0].color } : refColor;
  if (!color) return null;
  const width = Number(lineNode?.attrs.w ?? themeLine?.attrs.w ?? 9525);
  const dash = pick('a:prstDash')?.attrs.val;
  return { color, width, style: DASHES[dash] ?? 'solid' };
}

/** Geometry for p:spPr: preset name and adjust values, or custom path data. */
export function geometryOf(spPr) {
  const preset = kid(spPr, 'a:prstGeom');
  if (preset) {
    const adjust = {};
    for (const gd of kids(kid(preset, 'a:avLst'), 'a:gd')) {
      const match = String(gd.attrs.fmla ?? '').match(/^val\s+(-?\d+)/);
      if (match) adjust[gd.attrs.name] = Number(match[1]);
    }
    return { preset: preset.attrs.prst ?? 'rect', adjust };
  }
  const custom = kid(spPr, 'a:custGeom');
  return custom ? { custom } : { preset: 'rect', adjust: {} };
}

function ellipseParam(angleDeg, wR, hR) {
  const radians = (angleDeg * Math.PI) / 180;
  return Math.atan2(wR * Math.sin(radians), hR * Math.cos(radians));
}

/** Convert a:custGeom paths to an SVG path in pixel space (box w × h). */
export function customPath(custom, widthPx, heightPx) {
  const parts = [];
  const round = (value) => Math.round(value * 100) / 100;
  for (const pathNode of kids(kid(custom, 'a:pathLst'), 'a:path')) {
    const pw = Number(pathNode.attrs.w ?? 0) || 1;
    const ph = Number(pathNode.attrs.h ?? 0) || 1;
    const sx = widthPx / pw;
    const sy = heightPx / ph;
    let current = [0, 0];
    const point = (pt) => [Number(pt.attrs.x ?? 0) * sx, Number(pt.attrs.y ?? 0) * sy];
    for (const command of pathNode.children) {
      const pts = kids(command, 'a:pt').map(point);
      switch (command.name) {
        case 'a:moveTo': current = pts[0]; parts.push(`M${round(current[0])} ${round(current[1])}`); break;
        case 'a:lnTo': current = pts[0]; parts.push(`L${round(current[0])} ${round(current[1])}`); break;
        case 'a:cubicBezTo':
          if (pts.length === 3) {
            parts.push(`C${pts.map((p) => `${round(p[0])} ${round(p[1])}`).join(' ')}`);
            current = pts[2];
          }
          break;
        case 'a:quadBezTo':
          if (pts.length === 2) {
            parts.push(`Q${pts.map((p) => `${round(p[0])} ${round(p[1])}`).join(' ')}`);
            current = pts[1];
          }
          break;
        case 'a:arcTo': {
          const wR = Number(command.attrs.wR ?? 0) * sx;
          const hR = Number(command.attrs.hR ?? 0) * sy;
          const start = Number(command.attrs.stAng ?? 0) / 60000;
          const sweep = Number(command.attrs.swAng ?? 0) / 60000;
          if (!wR || !hR || !sweep) break;
          const t1 = ellipseParam(start, wR, hR);
          const t2 = ellipseParam(start + sweep, wR, hR);
          const cx = current[0] - wR * Math.cos(t1);
          const cy = current[1] - hR * Math.sin(t1);
          const end = [cx + wR * Math.cos(t2), cy + hR * Math.sin(t2)];
          parts.push(`A${round(wR)} ${round(hR)} 0 ${Math.abs(sweep) > 180 ? 1 : 0} ${sweep > 0 ? 1 : 0} ${round(end[0])} ${round(end[1])}`);
          current = end;
          break;
        }
        case 'a:close': parts.push('Z'); break;
        default: break;
      }
    }
  }
  return parts.join(' ');
}

const LEVEL_KEYS = ['algn', 'marL', 'indent'];

/** Read one a:lvlNpPr (or a:pPr) into a flat style fragment. */
export function paragraphStyle(node, ctx) {
  if (!node) return {};
  const style = {};
  for (const key of LEVEL_KEYS) if (node.attrs[key] !== undefined) style[key] = node.attrs[key];
  const lineSpacing = kid(node, 'a:lnSpc');
  if (kid(lineSpacing, 'a:spcPct')) style.lineSpacingPct = pct(kid(lineSpacing, 'a:spcPct'));
  if (kid(lineSpacing, 'a:spcPts')) style.lineSpacingPts = Number(kid(lineSpacing, 'a:spcPts').attrs.val ?? 0) / 100;
  const before = kid(kid(node, 'a:spcBef'), 'a:spcPts');
  if (before) style.spaceBeforePts = Number(before.attrs.val ?? 0) / 100;
  if (kid(node, 'a:buNone')) style.bullet = null;
  if (kid(node, 'a:buChar')) style.bullet = kid(node, 'a:buChar').attrs.char ?? '•';
  if (kid(node, 'a:buAutoNum')) style.bullet = 'number';
  Object.assign(style, runStyle(kid(node, 'a:defRPr'), ctx));
  return style;
}

/** Read a:rPr / a:defRPr / a:endParaRPr into a flat style fragment. */
export function runStyle(node, ctx) {
  if (!node) return {};
  const style = {};
  if (node.attrs.sz !== undefined) style.sizePt = Number(node.attrs.sz) / 100;
  if (node.attrs.b !== undefined) style.bold = node.attrs.b === '1' || node.attrs.b === 'true';
  if (node.attrs.i !== undefined) style.italic = node.attrs.i === '1' || node.attrs.i === 'true';
  if (node.attrs.cap !== undefined) style.cap = node.attrs.cap;
  if (node.attrs.spc !== undefined) style.spacingPt = Number(node.attrs.spc) / 100;
  const latin = kid(node, 'a:latin')?.attrs.typeface;
  if (latin) style.typeface = latin;
  const fill = kid(node, 'a:solidFill');
  if (fill) {
    const color = resolveColor(fill, ctx);
    if (color) style.color = color;
  }
  const gradient = kid(node, 'a:gradFill');
  if (gradient && !style.color) {
    const resolved = gradientFrom(gradient, ctx);
    if (resolved) style.color = { css: resolved.stops[0].color, hex: resolved.stops[0].color, alpha: 1 };
  }
  return style;
}

export function levelNode(lstStyle, level = 1) {
  return kid(lstStyle, `a:lvl${level}pPr`);
}

/** Merge body properties: insets, anchor, autofit, wrap. */
export function bodyProps(node, base = {}) {
  if (!node) return { ...base };
  const result = { ...base };
  for (const [attr, key] of [['lIns', 'l'], ['tIns', 't'], ['rIns', 'r'], ['bIns', 'b']]) {
    if (node.attrs[attr] !== undefined) result.insets = { ...(result.insets ?? DEFAULT_INSETS), [key]: Number(node.attrs[attr]) };
  }
  if (node.attrs.anchor) result.anchor = node.attrs.anchor;
  if (node.attrs.vert) result.vert = node.attrs.vert;
  if (node.attrs.wrap) result.wrap = node.attrs.wrap;
  if (kid(node, 'a:normAutofit')) result.autofit = 'shrink';
  if (kid(node, 'a:spAutoFit')) result.autofit = 'resize';
  if (kid(node, 'a:noAutofit')) result.autofit = 'none';
  return result;
}

/** Read an a:xfrm (or p:xfrm) node. */
export function xfrmOf(node) {
  if (!node) return null;
  const off = kid(node, 'a:off');
  const ext = kid(node, 'a:ext');
  if (!off || !ext) return null;
  const chOff = kid(node, 'a:chOff');
  const chExt = kid(node, 'a:chExt');
  return {
    x: Number(off.attrs.x ?? 0), y: Number(off.attrs.y ?? 0),
    cx: Number(ext.attrs.cx ?? 0), cy: Number(ext.attrs.cy ?? 0),
    rot: Number(node.attrs.rot ?? 0) / 60000,
    flipH: node.attrs.flipH === '1', flipV: node.attrs.flipV === '1',
    ...(chOff && chExt ? {
      chX: Number(chOff.attrs.x ?? 0), chY: Number(chOff.attrs.y ?? 0),
      chCx: Number(chExt.attrs.cx ?? 0), chCy: Number(chExt.attrs.cy ?? 0)
    } : {})
  };
}
