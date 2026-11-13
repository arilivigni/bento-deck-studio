import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MANIFEST_URL = 'https://bento.page/releases/slides/manifest.json';
const TRUSTED_KEY = {
  kty: 'EC',
  crv: 'P-256',
  x: 'GMHSKwWcAoJVq-Dz1ZxWZM6TXATWIKbaQBpjoTystH8',
  y: 'flFNzbdXCmJN8RQYCeG71rBZnnbN-MCEnp1EbCLFrj0'
};

function base64UrlToBuffer(value) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function rawEcdsaToDer(raw) {
  if (raw.length !== 64) throw new Error('Bento manifest signature has an invalid length.');
  const integer = (part) => {
    let bytes = part;
    while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
    if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0]), bytes]);
    return Buffer.concat([Buffer.from([0x02, bytes.length]), bytes]);
  };
  const r = integer(raw.subarray(0, 32));
  const s = integer(raw.subarray(32));
  const body = Buffer.concat([r, s]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

export function verifyManifest(manifest) {
  if (!manifest || typeof manifest.payload !== 'string' || typeof manifest.sig !== 'string') {
    throw new Error('Bento release manifest is missing its signed payload.');
  }
  const key = createPublicKey({ key: TRUSTED_KEY, format: 'jwk' });
  const signature = rawEcdsaToDer(Buffer.from(manifest.sig, 'base64'));
  if (!verifySignature('sha256', Buffer.from(manifest.payload), key, signature)) {
    throw new Error('Bento release manifest signature verification failed.');
  }
  let payload;
  try {
    payload = JSON.parse(manifest.payload);
  } catch {
    throw new Error('Bento release manifest payload is invalid JSON.');
  }
  if (payload.app !== 'bento-slides'
      || typeof payload.version !== 'string'
      || !/^https:\/\/bento\.page\/releases\/slides\/[^/]+\.bento\.html$/.test(payload.url)
      || !/^[a-f0-9]{64}$/i.test(payload.sha256)) {
    throw new Error('Bento release manifest contains unsupported fields or URLs.');
  }
  return payload;
}

export function spliceDeck(shell, doc, faviconDataUri) {
  const matches = [...shell.matchAll(/<script\b(?=[^>]*\bid=["']bento-doc["'])[^>]*>[\s\S]*?<\/script\s*>/gi)];
  if (matches.length !== 1) throw new Error('Bento shell must contain exactly one #bento-doc block.');
  const encoded = JSON.stringify(doc).replace(/</g, '\\u003c');
  const match = matches[0];
  let result = `${shell.slice(0, match.index)}${match[0].replace(/>[\s\S]*?<\/script\s*>/i, `>\n${encoded}\n</script>`)}${shell.slice(match.index + match[0].length)}`;
  const title = String(doc.title ?? 'Untitled deck').replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
  if (/<title\b[^>]*>[\s\S]*?<\/title\s*>/i.test(result)) {
    result = result.replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/i, `<title>${title} — bento/slides</title>`);
  }
  if (faviconDataUri) {
    const mime = faviconDataUri.match(/^data:([^;,]+)/)?.[1] ?? 'image/svg+xml';
    const link = `<link rel="icon" type="${mime}" href="${faviconDataUri}">`;
    if (/<link\b(?=[^>]*\brel=["'](?:shortcut\s+)?icon["'])[^>]*>/i.test(result)) {
      result = result.replace(/<link\b(?=[^>]*\brel=["'](?:shortcut\s+)?icon["'])[^>]*>/i, link);
    } else {
      result = result.replace(/<\/head\s*>/i, `${link}\n</head>`);
    }
  }
  const validated = validateDeckHtml(result);
  if (JSON.stringify(validated) !== JSON.stringify(doc)) {
    throw new Error('The deck document did not survive shell splicing.');
  }
  return result;
}

export function validateDeckHtml(html) {
  const blocks = [...html.matchAll(/<script\b(?=[^>]*\bid=["']bento-doc["'])[^>]*>([\s\S]*?)<\/script\s*>/gi)];
  if (blocks.length !== 1) throw new Error('Expected exactly one embedded #bento-doc block.');
  let doc;
  try {
    doc = JSON.parse(blocks[0][1].trim());
  } catch (error) {
    throw new Error(`Embedded bento document is not valid JSON: ${error.message}`);
  }
  if (doc.format !== 'bento/slides' || doc.version !== 1 || !doc.title) {
    throw new Error('Document must have format bento/slides, version 1, and a title.');
  }
  if (!Number.isFinite(doc.size?.width) || !Number.isFinite(doc.size?.height)
      || !doc.theme?.background || !doc.theme?.color || !doc.theme?.accent || !doc.theme?.fontFamily
      || !Array.isArray(doc.slides) || !doc.slides.length) {
    throw new Error('Document is missing a required canvas, theme, or slide.');
  }
  for (const [index, slide] of doc.slides.entries()) {
    if (!slide.id || !Array.isArray(slide.elements)) throw new Error(`Slide ${index + 1} is missing an id or elements.`);
    for (const element of slide.elements) {
      if (!element.id || !element.type || !['text', 'shape', 'image', 'chart', 'table', 'svg', 'media'].includes(element.type)) {
        throw new Error(`Slide ${index + 1} contains an unsupported or unidentified element.`);
      }
      if (element.type === 'shape'
          && (!['rect', 'ellipse', 'triangle', 'arrow', 'line', 'path'].includes(element.shape)
            || !Number.isFinite(element.strokeWidth))) {
        throw new Error(`Shape ${element.id} must have a supported shape and numeric strokeWidth.`);
      }
      for (const field of ['x', 'y', 'w', 'h']) {
        if (!Number.isFinite(element[field])) throw new Error(`Element ${element.id} is missing finite geometry (${field}).`);
      }
    }
  }
  return doc;
}

function cacheDirectory() {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(base, 'bento-deck-studio');
}

async function fetchVerified() {
  const response = await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Manifest request failed with HTTP ${response.status}.`);
  const manifest = await response.json();
  const payload = verifyManifest(manifest);
  const shellResponse = await fetch(payload.url, { signal: AbortSignal.timeout(30000) });
  if (!shellResponse.ok) throw new Error(`Bento shell request failed with HTTP ${shellResponse.status}.`);
  const shellBytes = Buffer.from(await shellResponse.arrayBuffer());
  const hash = createHash('sha256').update(shellBytes).digest('hex');
  if (hash.toLowerCase() !== payload.sha256.toLowerCase()) {
    throw new Error('Bento shell SHA-256 does not match the signed release manifest.');
  }
  return { manifest, payload, shell: shellBytes.toString('utf8') };
}

async function readVerifiedCache() {
  const directory = cacheDirectory();
  const [manifestText, shell] = await Promise.all([
    readFile(path.join(directory, 'manifest.json'), 'utf8'),
    readFile(path.join(directory, 'Bento_Slides.bento.html'), 'utf8')
  ]);
  const manifest = JSON.parse(manifestText);
  const payload = verifyManifest(manifest);
  const hash = createHash('sha256').update(shell).digest('hex');
  if (hash.toLowerCase() !== payload.sha256.toLowerCase()) {
    throw new Error('Cached Bento shell failed its signed SHA-256 check.');
  }
  return { manifest, payload, shell };
}

export async function loadVerifiedShell() {
  try {
    const result = await fetchVerified();
    const directory = cacheDirectory();
    await mkdir(directory, { recursive: true });
    const suffix = `${process.pid}.tmp`;
    await Promise.all([
      writeFile(path.join(directory, `manifest.${suffix}`), JSON.stringify(result.manifest)),
      writeFile(path.join(directory, `shell.${suffix}`), result.shell)
    ]);
    await Promise.all([
      rename(path.join(directory, `manifest.${suffix}`), path.join(directory, 'manifest.json')),
      rename(path.join(directory, `shell.${suffix}`), path.join(directory, 'Bento_Slides.bento.html'))
    ]);
    return result;
  } catch (error) {
    try {
      return await readVerifiedCache();
    } catch (cacheError) {
      throw new Error(`Could not load a verified Bento shell: ${error.message}; verified cache unavailable: ${cacheError.message}`);
    }
  }
}
