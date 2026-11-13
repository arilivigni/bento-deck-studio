import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { createDocument, parseMarkdown } from '../scripts/deck-build.mjs';
import { buildSite, makeReadOnlyDeck } from '../scripts/site-build.mjs';
import { createFaviconSvg } from '../scripts/lib/favicon.mjs';
import { spliceDeck, validateDeckHtml, verifyManifest } from '../scripts/lib/bento.mjs';
import { readZip } from '../scripts/lib/zip.mjs';
import { contentRegion, extractTheme, extractThemeAssets } from '../scripts/theme-extract.mjs';
import { applyOfficeTypography, splitParagraphHtml } from '../scripts/lib/typography.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { fontStack, usedFaces } from '../scripts/lib/fonts.mjs';
import { renderMarkdown } from '../scripts/lib/markdown.mjs';
import { buildWebsite, checkLinks, parseChangelog } from '../scripts/website-build.mjs';
import { bumpVersion, checkRelease, releaseNotes } from '../scripts/release.mjs';

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

test('content region starts below a divider under the title and stops above the footer', () => {
  const size = { width: 1280, height: 720 };
  const layout = {
    placeholders: [
      { role: 'title', box: { x: 100, y: 60, w: 1000, h: 120 }, style: { fontSize: 48, align: 'left' } },
      { role: 'body', box: { x: 100, y: 200, w: 300, h: 40 }, style: { fontSize: 24 } },
      { role: 'footer', box: { x: 100, y: 660, w: 400, h: 30 }, style: { fontSize: 12 } }
    ]
  };
  const divider = { x: 0, y: 200, w: 1280, h: 2 };
  const region = contentRegion(layout, [divider], size);
  assert.equal(region.box.y, Math.round((202 + 720 * 0.04) * 100) / 100);
  assert.ok(region.box.y + region.box.h <= 660);
  assert.equal(region.style.fontSize, 24);
  assert.equal(contentRegion(layout, [{ x: 400, y: 150, w: 300, h: 300 }], size), null, 'an obstacle across the top rules the layout out');
});

const monaSans = '/Library/Fonts/MonaSans-Regular.ttf';
test('wrapped spaced paragraphs split into grouped boxes and overflowing text grows its box', { skip: !existsSync(monaSans) && 'Mona Sans is not installed' }, () => {
  assert.deepEqual(splitParagraphHtml('<div>One</div><div>Two <b>bold</b></div>'), ['<div>One</div>', '<div>Two <b>bold</b></div>']);
  assert.equal(splitParagraphHtml('<ul><li>One</li></ul>'), null);
  assert.equal(splitParagraphHtml('Loose <div>text</div>'), null);

  const long = 'A paragraph long enough that it certainly wraps across this narrow text box at least once.';
  const body = { id: 's1-body', morphId: 'ph-body', type: 'text', x: 100, y: 100, w: 400, h: 400, fontSize: 20, fontFamily: 'Mona Sans', lineHeight: 1.2, valign: 'top', html: `<div>${long}</div><div>Short</div>` };
  const subtitle = { id: 's1-sub', type: 'text', x: 100, y: 600, w: 200, h: 24, fontSize: 20, fontFamily: 'Mona Sans', lineHeight: 1.2, valign: 'bottom', html: long };
  const doc = {
    fonts: [{ family: 'Mona Sans', weight: '400', style: 'normal', asset: 'mona' }],
    assets: { mona: `data:font/ttf;base64,${readFileSync(monaSans).toString('base64')}` },
    slides: [{ id: 's1', elements: [body, subtitle] }],
    layouts: []
  };
  const hints = new Map([[body, { lineHeight: 1.2, spaceBefore: 12 }], [subtitle, { lineHeight: 1.2, spaceBefore: 0 }]]);
  const report = applyOfficeTypography(doc, hints);
  assert.equal(report.split, 1);
  const [first, second] = doc.slides[0].elements.filter((element) => element.groupId);
  assert.equal(second.id, 's1-body-p2');
  assert.equal(second.morphId, 'ph-body-p2');
  assert.equal(first.groupId, second.groupId);
  const firstLines = Math.round((first.h - 1) / (1.2 * 20));
  assert.ok(firstLines >= 2);
  assert.ok(Math.abs(second.y - first.y - (firstLines * 1.2 * 20 + 12)) < 0.02, 'second paragraph sits one space-before below the first');

  assert.equal(report.grown, 1);
  assert.ok(subtitle.h > 24);
  assert.ok(subtitle.y < 590 && Math.abs(subtitle.y + subtitle.h - 624) < 6, 'bottom-anchored text grows upwards');
});

test('CSS font stacks pass through and generic families are never embedded', () => {
  assert.equal(fontStack('system-ui, sans-serif'), 'system-ui, sans-serif');
  assert.match(fontStack('Calibri'), /^Calibri, Carlito, /);
  const doc = {
    theme: { fontFamily: 'system-ui, sans-serif', headingFamily: fontStack('ui-sans-serif, sans-serif') },
    slides: [{ elements: [{ type: 'text', html: '<b>Hi</b>', fontFamily: 'sans-serif' }, { type: 'text', html: 'x', fontFamily: fontStack('Mona Sans') }] }]
  };
  assert.deepEqual(usedFaces(doc).map((face) => `${face.family} ${face.weight}`), ['Mona Sans 400']);
});

test('website Markdown escapes HTML, drops unsafe URLs, and renders tables, task lists, and reference links', () => {
  const { html, headings } = renderMarkdown([
    '## Install <now>',
    '',
    'Run <script>alert(1)</script> or [click](javascript:alert(1)) and read the [guide][docs].',
    '',
    '| Name | Size |',
    '| --- | ---: |',
    '| deck | 2 |',
    '',
    '- [x] done',
    '- [ ] todo',
    '',
    '[docs]: https://example.com/docs'
  ].join('\n'));
  assert.doesNotMatch(html, /<script|javascript:/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<a href="https:\/\/example\.com\/docs" rel="noopener">guide<\/a>/);
  assert.doesNotMatch(html, /\[docs\]:/);
  assert.match(html, /<th class="align-right">Size<\/th>.*<td class="align-right">2<\/td>/);
  assert.match(html, /<ul class="tasks"><li class="task"><input type="checkbox" disabled checked aria-hidden="true"> done<\/li><li class="task"><input type="checkbox" disabled aria-hidden="true"> todo/);
  assert.deepEqual(headings, [{ level: 2, id: 'install-now', text: 'Install &lt;now&gt;' }]);
});

test('project website puts Slides first, opens it in a new tab, and fails on broken internal links', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bds-website-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const out = path.join(dir, 'site');
  const result = await buildWebsite({ out, baseUrl: 'https://example.test/bento' });
  assert.equal(result.baseUrl, 'https://example.test/bento/');
  assert.ok(result.docs > 0 && result.skills === 6);
  const index = await readFile(path.join(out, 'index.html'), 'utf8');
  const firstNavLink = index.match(/<nav\b[^>]*>[\s\S]*?(<a\b[^>]*>)/)[1];
  assert.match(firstNavLink, /href="slides\/deck\.bento\.html"/);
  assert.match(firstNavLink, /target="_blank"/);
  assert.match(firstNavLink, /rel="noopener"/);
  assert.match(index, /<link rel="canonical" href="https:\/\/example\.test\/bento\/">/);
  const deck = await readFile(path.join(out, 'slides/deck.bento.html'), 'utf8');
  assert.doesNotThrow(() => validateDeckHtml(deck));
  const notFound = await readFile(path.join(out, '404.html'), 'utf8');
  assert.doesNotMatch(notFound, /<base\b/);
  assert.match(notFound, /<a class="skip-link" href="#main">/);
  assert.match(notFound, /href="\/bento\/assets\/styles\.css"/);
  assert.match(notFound, /href="\/bento\/docs\/getting-started\.html"/);
  for (const name of await readdir(path.join(out, 'docs'))) {
    assert.doesNotMatch(await readFile(path.join(out, 'docs', name), 'utf8'), /&amp;(?:quot|lt|gt|amp);/, `double-escaped text in docs/${name}`);
  }
  assert.deepEqual(await checkLinks(out, { basePath: '/bento/' }), []);
  await writeFile(path.join(out, 'stray.html'), '<a href="docs/missing.html">x</a><a href="index.html#nowhere">y</a><a href="/bento/gone.html">z</a><a href="/elsewhere/">w</a>');
  assert.deepEqual(await checkLinks(out, { basePath: '/bento/' }), ['stray.html: docs/missing.html', 'stray.html: index.html#nowhere (missing #nowhere)', 'stray.html: /bento/gone.html']);
  await assert.rejects(buildWebsite({ out }), /Refusing to overwrite/);
});

test('changelog parsing and release checks keep versions, notes, and tags consistent', async (t) => {
  const changelog = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '## [1.2.0] - 2026-01-02',
    '',
    '### Added',
    '',
    '- A thing.',
    '',
    '[unreleased]: https://example.test/compare/v1.2.0...HEAD',
    '[1.2.0]: https://example.test/releases/tag/v1.2.0',
    ''
  ].join('\n');
  assert.deepEqual(parseChangelog(changelog).map(({ version, date, url }) => ({ version, date, url })), [
    { version: 'Unreleased', date: null, url: 'https://example.test/compare/v1.2.0...HEAD' },
    { version: '1.2.0', date: '2026-01-02', url: 'https://example.test/releases/tag/v1.2.0' }
  ]);
  assert.deepEqual(releaseNotes(changelog, '1.2.0'), { date: '2026-01-02', body: '### Added\n\n- A thing.' });
  assert.throws(() => releaseNotes(changelog, '9.9.9'), /no section for 9\.9\.9/);
  assert.throws(() => releaseNotes(changelog.replace(' - 2026-01-02', ''), '1.2.0'), /needs a release date/);

  const root = await mkdtemp(path.join(os.tmpdir(), 'bds-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '.github/plugin'), { recursive: true });
  await writeFile(path.join(root, 'plugin.json'), JSON.stringify({ name: 'demo', version: '1.1.0' }));
  await writeFile(path.join(root, '.github/plugin/marketplace.json'), JSON.stringify({ metadata: { version: '1.1.0' }, plugins: [{ name: 'demo', version: '1.1.0' }] }));
  await writeFile(path.join(root, 'CHANGELOG.md'), changelog);
  const before = await checkRelease({ root, version: '1.2.0' });
  assert.equal(before.problems.length, 3);
  assert.match(before.problems.join('\n'), /plugin\.json version is 1\.1\.0, expected 1\.2\.0/);
  assert.deepEqual(await bumpVersion({ root, version: '1.2.0' }), { previous: '1.1.0', version: '1.2.0' });
  assert.deepEqual((await checkRelease({ root, version: '1.2.0' })).problems, []);
  assert.deepEqual((await checkRelease({ root, version: '1.2.0', tagged: true })).problems, ['Tag v1.2.0 does not exist.']);
  await assert.rejects(checkRelease({ root, version: 'v1.2' }), /Not a valid semantic version/);
});
