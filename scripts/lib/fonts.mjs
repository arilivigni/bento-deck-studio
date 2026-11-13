import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const WEIGHT_WORDS = [
  ['hairline', 100], ['thin', 100], ['extralight', 200], ['ultralight', 200], ['light', 300],
  ['regular', 400], ['normal', 400], ['book', 400], ['roman', 400], ['medium', 500],
  ['semibold', 600], ['demibold', 600], ['bold', 700], ['extrabold', 800], ['ultrabold', 800],
  ['heavy', 900], ['black', 900]
];
const WEIGHT_MAP = new Map(WEIGHT_WORDS);
const ITALIC_WORDS = new Set(['italic', 'oblique']);
const BUILTIN_FAMILIES = new Set(['arial', 'helvetica', 'system-ui', 'sans-serif', 'serif', 'monospace', 'ui-monospace', 'ui-sans-serif', 'ui-serif', 'georgia', 'times new roman', 'courier new', 'verdana', 'tahoma', 'segoe ui'].map(normalizeFamily));
const METRIC_SUBSTITUTES = {
  calibri: ['Carlito'],
  'calibri light': ['Carlito'],
  cambria: ['Caladea'],
  arial: ['Liberation Sans', 'Arimo'],
  'times new roman': ['Liberation Serif', 'Tinos'],
  'courier new': ['Liberation Mono', 'Cousine']
};
const FONT_EXTENSIONS = /\.(ttf|otf)$/i;
const OPEN_LICENSE = /open font license|\bOFL\b|openfontlicense|scripts\.sil\.org\/OFL|apache license|ubuntu font licen[cs]e/i;
const MIME = { ttf: 'font/ttf', otf: 'font/otf', woff2: 'font/woff2', woff: 'font/woff' };
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export function normalizeFamily(name) {
  return String(name ?? '').replace(/["']/g, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** "Mona-Sans SemiBold Italic" → { family: "Mona Sans", weight: 600, italic: true }. */
export function parseTypeface(typeface) {
  let text = String(typeface ?? '').trim();
  if (!text) return { family: '' };
  if (!text.includes(' ') && text.includes('-')) text = text.replace(/-/g, ' ');
  const tokens = text.split(/\s+/);
  let weight;
  let italic = false;
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1].toLowerCase();
    const pair = tokens.length > 2 ? `${tokens[tokens.length - 2]}${tokens[tokens.length - 1]}`.toLowerCase() : '';
    if (ITALIC_WORDS.has(last)) {
      italic = true;
      tokens.pop();
    } else if (pair && WEIGHT_MAP.has(pair)) {
      weight ??= WEIGHT_MAP.get(pair);
      tokens.splice(-2, 2);
    } else if (WEIGHT_MAP.has(last)) {
      weight ??= WEIGHT_MAP.get(last);
      tokens.pop();
    } else {
      break;
    }
  }
  let family = tokens.join(' ');
  if (!family.includes(' ') && family.includes('-')) family = family.replace(/-/g, ' ');
  return { family, ...(weight ? { weight } : {}), ...(italic ? { italic } : {}) };
}

function quoteFamily(family) {
  return /^[a-z-]+$/i.test(family) ? family : `"${family.replace(/"/g, '')}"`;
}

export function genericFor(family) {
  const name = normalizeFamily(family);
  if (/mono|code|courier|consol|menlo/.test(name)) return 'ui-monospace, monospace';
  if (/serif/.test(name) && !/sans/.test(name)) return 'serif';
  if (/times|georgia|cambria|garamond|caladea|tinos/.test(name)) return 'serif';
  return 'system-ui, sans-serif';
}

/** CSS font stack: face, metric-compatible substitutes, generic. Bento rejects <>{}; in stacks. */
export function fontStack(family) {
  const clean = String(family ?? '').replace(/[<>{};"]/g, '').trim();
  if (!clean) return 'system-ui, sans-serif';
  if (clean.includes(',')) return clean.slice(0, 300);
  const substitutes = METRIC_SUBSTITUTES[normalizeFamily(clean)] ?? [];
  return [quoteFamily(clean), ...substitutes.map(quoteFamily), genericFor(clean)].join(', ').slice(0, 300);
}

export function firstFamily(stack) {
  return String(stack ?? '').split(',')[0].trim().replace(/^["']|["']$/g, '');
}

export function isBuiltinFamily(family) {
  return BUILTIN_FAMILIES.has(normalizeFamily(family));
}

function utf16be(buffer) {
  let text = '';
  for (let i = 0; i + 1 < buffer.length; i += 2) text += String.fromCharCode(buffer.readUInt16BE(i));
  return text;
}

/** Minimal SFNT reader: names, weight class, italic flag, fsType and variation axes. */
export function readFontInfo(buffer) {
  if (buffer.length < 12) return null;
  const tag = buffer.toString('latin1', 0, 4);
  if (!['\0\x01\0\0', 'OTTO', 'true'].includes(tag)) return null;
  const tableCount = buffer.readUInt16BE(4);
  const tables = new Map();
  for (let i = 0; i < tableCount; i++) {
    const offset = 12 + i * 16;
    if (offset + 16 > buffer.length) return null;
    tables.set(buffer.toString('latin1', offset, offset + 4), { offset: buffer.readUInt32BE(offset + 8), length: buffer.readUInt32BE(offset + 12) });
  }
  const names = {};
  const name = tables.get('name');
  if (name && name.offset + 6 <= buffer.length) {
    const count = buffer.readUInt16BE(name.offset + 2);
    const storage = name.offset + buffer.readUInt16BE(name.offset + 4);
    for (let i = 0; i < count; i++) {
      const record = name.offset + 6 + i * 12;
      if (record + 12 > buffer.length) break;
      const platform = buffer.readUInt16BE(record);
      const language = buffer.readUInt16BE(record + 4);
      const id = buffer.readUInt16BE(record + 6);
      const length = buffer.readUInt16BE(record + 8);
      const start = storage + buffer.readUInt16BE(record + 10);
      if (![1, 2, 13, 14, 16, 17].includes(id) || start + length > buffer.length) continue;
      const isUnicode = platform === 0 || (platform === 3 && (language === 0x409 || !names[id]));
      if (isUnicode) names[id] = utf16be(buffer.subarray(start, start + length));
      else if (platform === 1 && !names[id]) names[id] = buffer.toString('latin1', start, start + length);
    }
  }
  const os2 = tables.get('OS/2');
  let weight = 400;
  let fsType = 0;
  let italic = /italic|oblique/i.test(names[17] ?? names[2] ?? '');
  if (os2 && os2.offset + 64 <= buffer.length) {
    weight = buffer.readUInt16BE(os2.offset + 4);
    fsType = buffer.readUInt16BE(os2.offset + 8);
    italic = italic || Boolean(buffer.readUInt16BE(os2.offset + 62) & 1);
  }
  const axes = {};
  const fvar = tables.get('fvar');
  if (fvar && fvar.offset + 16 <= buffer.length) {
    const axesOffset = fvar.offset + buffer.readUInt16BE(fvar.offset + 4);
    const axisCount = buffer.readUInt16BE(fvar.offset + 8);
    const axisSize = buffer.readUInt16BE(fvar.offset + 10);
    for (let i = 0; i < axisCount; i++) {
      const offset = axesOffset + i * axisSize;
      if (offset + 20 > buffer.length) break;
      axes[buffer.toString('latin1', offset, offset + 4)] = {
        min: buffer.readInt32BE(offset + 4) / 65536,
        max: buffer.readInt32BE(offset + 12) / 65536
      };
    }
  }
  const families = [...new Set([names[16], names[1], names[1] && parseTypeface(names[1]).family].filter(Boolean))];
  return {
    families,
    subfamily: names[17] ?? names[2] ?? '',
    weight,
    italic,
    fsType,
    restricted: (fsType & 0x000f) === 0x0002,
    license: `${names[13] ?? ''} ${names[14] ?? ''}`.trim(),
    variableWeight: axes.wght ? [Math.round(axes.wght.min), Math.round(axes.wght.max)] : null
  };
}

async function walk(directory, depth = 0, out = []) {
  if (depth > 4) return out;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, depth + 1, out);
    else if (FONT_EXTENSIONS.test(entry.name)) out.push(full);
  }
  return out;
}

export function systemFontDirectories() {
  const home = os.homedir();
  if (process.platform === 'darwin') return ['/Library/Fonts', path.join(home, 'Library/Fonts')];
  if (process.platform === 'win32') return [path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts'), path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft/Windows/Fonts')];
  return ['/usr/share/fonts', '/usr/local/share/fonts', path.join(home, '.fonts'), path.join(home, '.local/share/fonts')];
}

/** Index licence-permitted local font files: user dirs (fsType-checked) and system dirs (open licence required). */
export async function indexLocalFonts({ fontsDirs = [], systemDirs = true } = {}) {
  const index = [];
  const sources = [
    ...fontsDirs.map((dir) => ({ dir, trusted: true })),
    ...(systemDirs ? systemFontDirectories().map((dir) => ({ dir, trusted: false })) : [])
  ];
  const seen = new Set();
  for (const { dir, trusted } of sources) {
    for (const file of await walk(dir)) {
      if (seen.has(file)) continue;
      seen.add(file);
      try {
        if ((await stat(file)).size > 8 * 1024 * 1024) continue;
        const data = await readFile(file);
        const info = readFontInfo(data);
        if (!info || info.restricted) continue;
        if (!trusted && !OPEN_LICENSE.test(info.license)) continue;
        index.push({ file, ...info });
      } catch {
        // Unreadable font files are skipped.
      }
    }
  }
  return index;
}

function pickLocal(index, family, weight, italic) {
  const wanted = normalizeFamily(family);
  const candidates = index.filter((font) => font.families.some((name) => normalizeFamily(name) === wanted) && font.italic === Boolean(italic));
  if (!candidates.length) return null;
  const variable = candidates.find((font) => font.variableWeight && weight >= font.variableWeight[0] && weight <= font.variableWeight[1]);
  if (variable) return variable;
  return candidates
    .filter((font) => !font.variableWeight)
    .sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight))[0] ?? candidates[0];
}

function cacheDirectory() {
  return path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'bento-deck-studio', 'fonts');
}

/** Fetch the latin woff2 for one family/weight from Google Fonts (all OFL/Apache/UFL), cached on disk. */
export async function fetchGoogleFont(family, weight, italic, { fetchImpl = globalThis.fetch, cacheDir = cacheDirectory() } = {}) {
  if (!fetchImpl) return null;
  const axis = italic ? `ital,wght@1,${weight}` : `wght@${weight}`;
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:${axis}&display=swap`;
  const response = await fetchImpl(url, { headers: { 'user-agent': CHROME_UA } });
  if (!response.ok) return null;
  const css = await response.text();
  const blocks = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)];
  const latin = blocks.find((block) => block[1] === 'latin') ?? blocks[blocks.length - 1];
  const src = latin?.[2].match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/)?.[1];
  if (!src) return null;
  await mkdir(cacheDir, { recursive: true });
  const cached = path.join(cacheDir, `${createHash('sha256').update(src).digest('hex').slice(0, 24)}.woff2`);
  try {
    return { data: await readFile(cached), ext: 'woff2', url: src };
  } catch {
    const fontResponse = await fetchImpl(src, { headers: { 'user-agent': CHROME_UA } });
    if (!fontResponse.ok) return null;
    const data = Buffer.from(await fontResponse.arrayBuffer());
    if (data.length > 4 * 1024 * 1024) return null;
    await writeFile(cached, data);
    return { data, ext: 'woff2', url: src };
  }
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Faces (first family + weight + style) the document actually renders. */
export function usedFaces(doc) {
  const faces = new Map();
  const add = (stack, weight = 400, italic = false) => {
    const family = firstFamily(stack);
    if (!family || isBuiltinFamily(family)) return;
    const key = `${normalizeFamily(family)}|${weight}|${italic}`;
    if (!faces.has(key)) faces.set(key, { family, weight: Number(weight) || 400, italic });
  };
  const visit = (slides) => {
    for (const slide of slides ?? []) {
      for (const element of slide.elements ?? []) {
        if (element.type !== 'text') continue;
        const stack = element.fontFamily ?? doc.theme?.fontFamily;
        const weight = element.fontWeight ?? 400;
        const html = String(element.html ?? '');
        const bold = /<(b|strong)\b/i.test(html);
        const italic = /<(i|em)\b/i.test(html);
        const nested = /<(b|strong)\b[^>]*>(?:(?!<\/(?:b|strong)>)[\s\S])*<(i|em)\b|<(i|em)\b[^>]*>(?:(?!<\/(?:i|em)>)[\s\S])*<(b|strong)\b/i.test(html);
        add(stack, weight);
        if (bold) add(stack, 700);
        if (italic) add(stack, weight, true);
        if (nested) add(stack, 700, true);
      }
    }
  };
  visit(doc.slides);
  visit(doc.layouts);
  add(doc.theme?.fontFamily, 400);
  add(doc.theme?.fontFamily, 700);
  if (doc.theme?.headingFamily && ![...faces.values()].some((face) => normalizeFamily(face.family) === normalizeFamily(firstFamily(doc.theme.headingFamily)))) {
    add(doc.theme.headingFamily, 700);
  }
  return [...faces.values()];
}

/**
 * Embed licence-permitted font files for every face the deck uses. Returns a report
 * of embedded and missing faces; never embeds fonts whose fsType forbids it.
 */
export async function embedFonts(doc, { fontsDirs = [], systemDirs = true, download = true, fetchImpl, cacheDir, localIndex } = {}) {
  const faces = usedFaces(doc);
  const report = { embedded: [], missing: [] };
  if (!faces.length) return report;
  const index = localIndex ?? await indexLocalFonts({ fontsDirs, systemDirs });
  const fonts = [...(doc.fonts ?? [])];
  const assets = { ...(doc.assets ?? {}) };
  const assetByFile = new Map();
  for (const face of faces) {
    if (fonts.some((font) => normalizeFamily(font.family) === normalizeFamily(face.family) && fontCovers(font.weight, face.weight) && (font.style ?? 'normal') === (face.italic ? 'italic' : 'normal'))) continue;
    let source = null;
    const local = pickLocal(index, face.family, face.weight, face.italic);
    if (local) {
      source = { key: local.file, data: await readFile(local.file), ext: path.extname(local.file).slice(1).toLowerCase(), weight: local.variableWeight ? local.variableWeight.join(' ') : String(local.weight), origin: 'local' };
    } else if (download) {
      try {
        const remote = await fetchGoogleFont(face.family, face.weight, face.italic, { fetchImpl, cacheDir });
        if (remote) source = { key: remote.url, data: remote.data, ext: remote.ext, weight: String(face.weight), origin: 'google-fonts' };
      } catch {
        source = null;
      }
    }
    if (!source) {
      report.missing.push(face);
      continue;
    }
    let assetKey = assetByFile.get(source.key);
    if (!assetKey) {
      assetKey = `font-${slug(face.family)}-${slug(source.weight)}${face.italic ? '-italic' : ''}`;
      assets[assetKey] = `data:${MIME[source.ext] ?? 'application/octet-stream'};base64,${source.data.toString('base64')}`;
      assetByFile.set(source.key, assetKey);
    }
    const entry = { family: face.family, asset: assetKey, weight: source.weight, style: face.italic ? 'italic' : 'normal' };
    if (!fonts.some((font) => font.family === entry.family && font.asset === entry.asset && font.weight === entry.weight)) fonts.push(entry);
    report.embedded.push({ ...face, origin: source.origin });
  }
  if (fonts.length) doc.fonts = fonts;
  doc.assets = assets;
  return report;
}

function fontCovers(weightSpec, weight) {
  const [low, high = low] = String(weightSpec ?? '400').split(/\s+/).map(Number);
  return weight >= low && weight <= high;
}
