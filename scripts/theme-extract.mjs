#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readZip } from './lib/zip.mjs';
import { attributes, firstTag } from './lib/xml.mjs';

const EMU_PER_PIXEL = 9525;

function colorValue(xml) {
  const srgb = xml.match(/<a:srgbClr\b[^>]*\bval=["']([0-9a-f]{6})["']/i)?.[1];
  if (srgb) return `#${srgb.toUpperCase()}`;
  const system = xml.match(/<a:sysClr\b[^>]*\blastClr=["']([0-9a-f]{6})["']/i)?.[1];
  return system ? `#${system.toUpperCase()}` : null;
}

function luminance(hex) {
  const rgb = hex.slice(1).match(/.{2}/g).map((part) => Number.parseInt(part, 16) / 255);
  const linear = rgb.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function extractColors(xml) {
  const scheme = firstTag(xml, 'a:clrScheme');
  const colors = {};
  for (const match of scheme.matchAll(/<a:(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink)\b[^>]*>([\s\S]*?)<\/a:\1>/gi)) {
    const value = colorValue(match[2]);
    if (value) colors[match[1]] = value;
  }
  if (!Object.keys(colors).length) throw new Error('The PowerPoint theme has no supported color scheme.');
  return colors;
}

function extractFonts(xml) {
  const fonts = {};
  for (const kind of ['majorFont', 'minorFont']) {
    const body = firstTag(xml, `a:${kind}`);
    const latin = body.match(/<a:latin\b[^>]*\/?>/i)?.[0];
    const typeface = latin ? attributes(latin).typeface : '';
    if (typeface) fonts[kind === 'majorFont' ? 'heading' : 'body'] = typeface;
  }
  return fonts;
}

function extractLayouts(files) {
  const names = [...files.keys()]
    .filter((name) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  return names.map((name) => {
    const xml = files.get(name).toString('utf8');
    const slide = firstTag(xml, 'p:cSld');
    const cSldTag = xml.match(/<p:cSld\b[^>]*>/i)?.[0] ?? '';
    const placeholders = [];
    for (const shape of slide.matchAll(/<p:sp\b[^>]*>([\s\S]*?)<\/p:sp>/gi)) {
      const phTag = shape[1].match(/<p:ph\b[^>]*\/?>/i)?.[0];
      if (!phTag) continue;
      const ph = attributes(phTag);
      const xfrm = shape[1].match(/<a:xfrm\b[^>]*>([\s\S]*?)<\/a:xfrm>/i)?.[1] ?? '';
      const off = xfrm.match(/<a:off\b[^>]*\/?>/i)?.[0];
      const ext = xfrm.match(/<a:ext\b[^>]*\/?>/i)?.[0];
      placeholders.push({
        type: ph.type ?? 'obj',
        ...(ph.idx ? { index: Number(ph.idx) } : {}),
        ...(off && ext ? {
          frame: {
            x: Number(attributes(off).x ?? 0),
            y: Number(attributes(off).y ?? 0),
            width: Number(attributes(ext).cx ?? 0),
            height: Number(attributes(ext).cy ?? 0)
          }
        } : {})
      });
    }
    return {
      name: attributes(cSldTag).name ?? path.basename(name, '.xml'),
      placeholders
    };
  });
}

function relationshipsFor(files, partName) {
  const relName = path.posix.join(
    path.posix.dirname(partName),
    '_rels',
    `${path.posix.basename(partName)}.rels`
  );
  const xml = files.get(relName)?.toString('utf8') ?? '';
  const relations = new Map();
  for (const match of xml.matchAll(/<Relationship\b[^>]*\/?>/gi)) {
    const attrs = attributes(match[0]);
    if (!attrs.Id || !attrs.Target || attrs.TargetMode === 'External' || !/\/image$/i.test(attrs.Type ?? '')) continue;
    const target = attrs.Target.startsWith('/')
      ? attrs.Target.slice(1)
      : path.posix.normalize(path.posix.join(path.posix.dirname(partName), attrs.Target));
    relations.set(attrs.Id, target);
  }
  return relations;
}

function layoutImages(files) {
  const candidates = new Set();
  const parts = [...files.keys()].filter((name) =>
    /^ppt\/(?:slideMasters\/slideMaster\d+|slideLayouts\/slideLayout\d+)\.xml$/.test(name));
  for (const part of parts) {
    const xml = files.get(part).toString('utf8');
    const relations = relationshipsFor(files, part);
    for (const match of xml.matchAll(/<a:blip\b[^>]*\/?>/gi)) {
      const relId = attributes(match[0])['r:embed'];
      const target = relId ? relations.get(relId) : null;
      if (target && files.has(target)) candidates.add(target);
    }
  }
  return [...candidates];
}

export function extractTheme(buffer, sourceName = 'presentation.pptx') {
  const files = readZip(buffer);
  const themeName = [...files.keys()].filter((name) => /^ppt\/theme\/theme\d+\.xml$/.test(name)).sort()[0];
  if (!themeName) throw new Error('No PowerPoint theme XML was found. Supply a PPTX or POTX with a theme.');
  const themeXml = files.get(themeName).toString('utf8');
  const colors = extractColors(themeXml);
  const presentation = files.get('ppt/presentation.xml')?.toString('utf8') ?? '';
  const slideTag = presentation.match(/<p:sldSz\b[^>]*\/?>/i)?.[0];
  const slideAttrs = slideTag ? attributes(slideTag) : {};
  const width = Math.round(Number(slideAttrs.cx ?? 12192000) / EMU_PER_PIXEL);
  const height = Math.round(Number(slideAttrs.cy ?? 6858000) / EMU_PER_PIXEL);
  if (width < 320 || width > 3840 || height < 240 || height > 3840) {
    throw new Error('The PowerPoint slide dimensions are outside the supported range.');
  }
  const isDark = luminance(colors.dk1 ?? '#000000') < 0.15 && luminance(colors.lt1 ?? '#FFFFFF') > 0.8;
  const background = isDark ? colors.dk1 : (colors.lt1 ?? '#FFFFFF');
  const foreground = isDark ? (colors.lt1 ?? '#FFFFFF') : (colors.dk1 ?? '#20262C');
  const fontTokens = extractFonts(themeXml);
  const media = [...files.keys()]
    .filter((name) => /^ppt\/media\/[^/]+\.(png|jpe?g|gif|webp|svg)$/i.test(name))
    .sort();
  const logoCandidates = media.filter((name) => /(?:logo|mark|brand|icon)/i.test(path.basename(name)));
  return {
    source: path.basename(sourceName),
    extractedAt: new Date().toISOString(),
    size: { width, height },
    theme: {
      background,
      color: foreground,
      accent: colors.accent1 ?? colors.accent2 ?? '#2563EB',
      fontFamily: fontTokens.body ? `${fontTokens.body}, system-ui, sans-serif` : 'system-ui, sans-serif'
    },
    colors,
    fonts: fontTokens,
    layouts: extractLayouts(files),
    media,
    layoutImageCandidates: layoutImages(files),
    logoCandidates
  };
}

export function extractThemeAssets(buffer) {
  return [...readZip(buffer).entries()]
    .filter(([name]) => /^ppt\/media\/[^/]+\.(png|jpe?g|gif|webp|svg)$/i.test(name))
    .map(([name, data]) => ({ name: path.basename(name), data }));
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
  const result = extractTheme(await readFile(input), input);
  const assetsIndex = args.indexOf('--assets-out');
  if (assetsIndex >= 0) {
    const assetsOut = args[assetsIndex + 1];
    if (!assetsOut || assetsOut.startsWith('--')) throw new Error('Missing value for --assets-out.');
    await mkdir(assetsOut, { recursive: true });
    for (const { name, data } of extractThemeAssets(await readFile(input))) {
      await writeFile(path.join(assetsOut, name), data, { flag: 'wx' });
    }
    console.log(`Extracted ${result.media.length} media assets to ${assetsOut}`);
  }
  await writeFile(args[outIndex + 1], `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(`Extracted theme from ${path.basename(input)} to ${args[outIndex + 1]}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Theme extraction failed: ${error.message}`);
    process.exitCode = 1;
  });
}
