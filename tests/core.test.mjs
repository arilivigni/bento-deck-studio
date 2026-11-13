import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { createDocument, parseMarkdown } from '../scripts/deck-build.mjs';
import { buildSite, makeReadOnlyDeck } from '../scripts/site-build.mjs';
import { createFaviconSvg } from '../scripts/lib/favicon.mjs';
import { spliceDeck, validateDeckHtml, verifyManifest } from '../scripts/lib/bento.mjs';
import { readZip } from '../scripts/lib/zip.mjs';
import { extractTheme, extractThemeAssets } from '../scripts/theme-extract.mjs';

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(entries) {
  const localRecords = [];
  const centralRecords = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(content);
    const compressed = name.includes('slideLayout') ? deflateRawSync(data) : data;
    const method = compressed === data ? 0 : 8;
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    localRecords.push(local, compressed);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    centralRecords.push(central);
    offset += local.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralRecords);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localRecords, centralDirectory, end]);
}

const themeXml = `<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="Sample"><a:dk1><a:srgbClr val="101418"/></a:dk1><a:lt1><a:srgbClr val="F2F0EA"/></a:lt1><a:accent1><a:srgbClr val="5EEC83"/></a:accent1></a:clrScheme><a:fontScheme name="Sample"><a:majorFont><a:latin typeface="Display Face"/></a:majorFont><a:minorFont><a:latin typeface="Body Face"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;
const fixtureZip = makeZip({
  'ppt/theme/theme1.xml': themeXml,
  'ppt/presentation.xml': '<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>',
  'ppt/slideLayouts/slideLayout1.xml': '<p:sldLayout><p:cSld name="Title Slide"><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="300" cy="400"/></a:xfrm></p:spPr></p:sp><p:pic><p:blipFill><a:blip r:embed="rId1"/></p:blipFill></p:pic></p:spTree></p:cSld></p:sldLayout>',
  'ppt/slideLayouts/_rels/slideLayout1.xml.rels': '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.svg"/></Relationships>',
  'ppt/media/image1.svg': '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'
});

test('ZIP reader inflates and verifies entries, and theme extraction captures tokens and layouts', () => {
  const files = readZip(fixtureZip);
  assert.equal(files.get('ppt/theme/theme1.xml').toString(), themeXml);
  const extracted = extractTheme(fixtureZip, 'fixture.potx');
  assert.equal(extracted.size.width, 1280);
  assert.equal(extracted.theme.accent, '#5EEC83');
  assert.equal(extracted.fonts.heading, 'Display Face');
  assert.equal(extracted.fonts.body, 'Body Face');
  assert.equal(extracted.layouts[0].name, 'Title Slide');
  assert.equal(extracted.layouts[0].placeholders[0].type, 'title');
  assert.deepEqual(extracted.layoutImageCandidates, ['ppt/media/image1.svg']);
  assert.equal(extractThemeAssets(fixtureZip)[0].name, 'image1.svg');
});

test('Markdown parsing and document generation produce deterministic editable slides', () => {
  const content = parseMarkdown('# Test deck\nA short subtitle.\n\n## First idea\n- One point\n- Another point');
  assert.equal(content.title, 'Test deck');
  assert.equal(content.sections.length, 1);
  const doc = createDocument('# Test deck\nA short subtitle.\n\n## First idea\n- One point', {
    size: { width: 1280, height: 720 },
    theme: { background: '#101418', color: '#FFFFFF', accent: '#5EEC83', fontFamily: 'system-ui, sans-serif' }
  });
  assert.equal(doc.format, 'bento/slides');
  assert.equal(doc.slides[1].elements.find((element) => element.role === 'title').html, 'First idea');
  assert.ok(doc.slides[1].elements.every((element) => Number.isFinite(element.x)));
  assert.ok(doc.slides.flatMap((slide) => slide.elements)
    .filter((element) => element.type === 'shape')
    .every((element) => Number.isFinite(element.strokeWidth)));
});

test('shell splice round-trips valid JSON and read-only copies remove speaker notes', () => {
  const doc = createDocument('# Test\nSubtitle\n\n## Message\n- Detail', {
    size: { width: 1280, height: 720 },
    theme: { background: '#101418', color: '#FFFFFF', accent: '#5EEC83', fontFamily: 'system-ui, sans-serif' }
  });
  doc.slides[0].notes = 'Keep private';
  doc.collab = { key: 'secret', ownerPriv: 'secret' };
  const shell = '<html><head><title>Shell</title></head><body><script type="application/bento+json" id="bento-doc">{}</script></body></html>';
  const built = spliceDeck(shell, doc, 'data:image/svg+xml,test');
  assert.deepEqual(validateDeckHtml(built), doc);
  const publicCopy = makeReadOnlyDeck(built);
  const publicDoc = validateDeckHtml(publicCopy);
  assert.equal(publicDoc.readonly, true);
  assert.equal(publicDoc.slides[0].notes, '');
  assert.equal(publicDoc.collab, undefined);
  assert.match(publicCopy, /data:image\/svg\+xml/);
});

test('site builder creates launch and full tiers and refuses to overwrite an existing site', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'bento-site-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const doc = createDocument('# Test deck\nA short subtitle.\n\n## Story\n- One idea', {
    size: { width: 1280, height: 720 },
    theme: { background: '#101418', color: '#FFFFFF', accent: '#5EEC83', fontFamily: 'system-ui, sans-serif' }
  });
  doc.slides[1].notes = 'Internal notes';
  doc.collab = { key: 'secret' };
  const shell = '<html><head><title>Shell</title></head><body><script type="application/bento+json" id="bento-doc">{}</script></body></html>';
  const deckHtml = spliceDeck(shell, doc);

  const launch = path.join(temp, 'launch');
  await buildSite({ deckHtml, out: launch });
  const launchHtml = await readFile(path.join(launch, 'index.html'), 'utf8');
  assert.doesNotMatch(launchHtml, /<nav\b/);
  const published = validateDeckHtml(await readFile(path.join(launch, 'slides/deck.bento.html'), 'utf8'));
  assert.equal(published.readonly, true);
  assert.equal(published.collab, undefined);
  assert.ok(published.slides.every((slide) => !slide.notes));
  assert.match(await readFile(path.join(launch, 'favicon.svg'), 'utf8'), /<svg/);
  await assert.rejects(buildSite({ deckHtml, out: launch }), /Refusing to overwrite/);

  const full = path.join(temp, 'full');
  await buildSite({ deckHtml, out: full, tier: 'full' });
  const fullHtml = await readFile(path.join(full, 'index.html'), 'utf8');
  const firstItem = fullHtml.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i)?.[1]?.match(/<a\b[^>]*>[\s\S]*?<\/a>/i)?.[0];
  assert.match(firstItem ?? '', /Slides ↗/);
  assert.match(firstItem ?? '', /target="_blank"/);
  assert.match(firstItem ?? '', /rel="noopener"/);
});

test('favicon monogram is deterministic and manifest verifier rejects invalid signatures', () => {
  const first = createFaviconSvg('Bento deck', '#5EEC83', '#101418');
  assert.equal(first, createFaviconSvg('Bento deck', '#5EEC83', '#101418'));
  assert.match(first, /aria-label="Bento deck"/);
  assert.throws(() => verifyManifest({ payload: '{}', sig: Buffer.alloc(64).toString('base64') }), /signature verification failed/);
});
