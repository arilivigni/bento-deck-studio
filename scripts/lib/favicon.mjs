import { readFile, copyFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const MIME_TYPES = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

function escapeXml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[char]);
}

export function createFaviconSvg(title = 'Bento deck', accent = '#5EEC83', background = '#101418') {
  const monogram = [...String(title).trim()].find((char) => /[\p{L}\p{N}]/u.test(char))?.toLocaleUpperCase() ?? 'B';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="${escapeXml(title)}"><rect width="256" height="256" rx="56" fill="${escapeXml(background)}"/><path d="M56 52h78c45 0 69 21 69 54 0 19-9 34-27 43 23 8 34 24 34 47 0 36-28 58-76 58H56V52zm55 48v35h20c13 0 20-6 20-18 0-11-7-17-20-17h-20zm0 77v33h25c15 0 23-5 23-16 0-12-8-17-23-17h-25z" fill="${escapeXml(accent)}" transform="translate(0 -14) scale(.86) translate(20 30)"/><text x="128" y="181" text-anchor="middle" font-family="system-ui,sans-serif" font-size="94" font-weight="800" fill="#fff">${escapeXml(monogram)}</text></svg>\n`;
}

export function faviconMime(filePath) {
  const mime = MIME_TYPES[path.extname(filePath).toLowerCase()];
  if (!mime) throw new Error('Favicon must be SVG, PNG, JPEG, or WebP.');
  return mime;
}

export async function readFavicon(filePath) {
  const mime = faviconMime(filePath);
  const data = await readFile(filePath);
  if (mime === 'image/svg+xml') {
    const svg = data.toString('utf8');
    if (/<script\b|\bon[a-z]+\s*=|<foreignObject\b|(?:href|src)\s*=\s*["']\s*(?:https?:|javascript:|data:)/i.test(svg)) {
      throw new Error('SVG favicon contains active or external content.');
    }
    return { mime, data: Buffer.from(svg) };
  }
  return { mime, data };
}

export async function writeSiteFavicon(outDir, title, theme, sourcePath) {
  if (!sourcePath) {
    const file = path.join(outDir, 'favicon.svg');
    await writeFile(file, createFaviconSvg(title, theme.accent, theme.background), { flag: 'wx' });
    return { href: 'favicon.svg', ...await readFavicon(file) };
  }
  const mime = faviconMime(sourcePath);
  const extension = path.extname(sourcePath).toLowerCase();
  const name = extension === '.jpeg' ? 'favicon.jpg' : `favicon${extension}`;
  const destination = path.join(outDir, name);
  await copyFile(sourcePath, destination, constants.COPYFILE_EXCL);
  return { href: name, ...await readFavicon(destination) };
}
