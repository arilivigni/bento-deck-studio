#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateDeckHtml } from './lib/bento.mjs';
import { writeSiteFavicon } from './lib/favicon.mjs';

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

export function makeReadOnlyDeck(html) {
  const doc = structuredClone(validateDeckHtml(html));
  doc.readonly = true;
  delete doc.collab;
  for (const slide of doc.slides) slide.notes = '';
  const encoded = JSON.stringify(doc).replace(/</g, '\\u003c');
  return html.replace(/(<script\b(?=[^>]*\bid=["']bento-doc["'])[^>]*>)[\s\S]*?(<\/script\s*>)/i, `$1\n${encoded}\n$2`)
    .replace(/[ \t]+$/gm, '');
}

function pageHtml({ title, tier, faviconHref, deckTitle }) {
  const full = tier === 'full';
  const menu = full
    ? `<nav aria-label="Main navigation"><a class="slide-link" href="slides/deck.bento.html" target="_blank" rel="noopener">Slides ↗</a><a href="#about">About</a><a href="#approach">Approach</a><a href="#contact">Contact</a></nav>`
    : '';
  const hero = full
    ? `<p class="eyebrow">A better way to tell your story</p><h1>${escapeHtml(title)}</h1><p class="lede">Bring your PowerPoint theme. Leave with editable bento slides, ready to share.</p><a class="button" href="slides/deck.bento.html" target="_blank" rel="noopener">Launch the slides ↗</a>`
    : `<p class="eyebrow">Presentation</p><h1>${escapeHtml(deckTitle)}</h1><p class="lede">Open the presentation in a focused, full-screen player.</p><a class="button" href="slides/deck.bento.html">Launch the slides</a>`;
  const sections = full
    ? `<section id="about"><p class="eyebrow">About</p><h2>Built around your story.</h2><p>Slides are authored as editable bento documents, using the colors, typography, and proportions of the source presentation.</p></section><section id="approach"><p class="eyebrow">Approach</p><h2>Theme in. Story out.</h2><p>PowerPoint themes guide the visual system while clear structure and purposeful layouts keep the message in focus.</p></section><section id="contact"><p class="eyebrow">Explore</p><h2>Start with the slides.</h2><p>Open the deck from the top menu to present it in a new tab.</p></section>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="A presentation built with bento-deck-studio.">
  <meta name="theme-color" content="#101418">
  <title>${escapeHtml(title)}</title>
  <link rel="icon" href="${escapeHtml(faviconHref)}">
  <style>
    :root{color-scheme:dark;--bg:#101418;--panel:#172127;--text:#f2f0ea;--muted:#aab6bd;--accent:#5eec83;--line:#35434a;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(ellipse at 70% 8%,#173b2c 0,transparent 34%),var(--bg);color:var(--text);line-height:1.55}
    header{height:76px;padding:0 clamp(20px,6vw,88px);display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #ffffff16;background:#101418e8;position:sticky;top:0;z-index:2;backdrop-filter:blur(16px)}
    .brand{font-weight:750;letter-spacing:-.03em;color:var(--text);text-decoration:none}.brand span{color:var(--accent)}
    nav{display:flex;gap:clamp(14px,3vw,34px);align-items:center}nav a{font-size:.92rem;color:var(--muted);text-decoration:none}nav a:hover,nav .slide-link{color:var(--accent)}
    main{max-width:1120px;margin:0 auto;padding:clamp(72px,13vw,160px) 28px 80px}.hero{max-width:840px;min-height:${full ? '60vh' : '72vh'};display:flex;flex-direction:column;justify-content:center}
    .eyebrow{text-transform:uppercase;letter-spacing:.18em;color:var(--accent);font-size:.76rem;font-weight:750}h1{font-size:clamp(3rem,8vw,6.6rem);line-height:.98;letter-spacing:-.065em;margin:.35em 0;max-width:900px}h2{font-size:clamp(2rem,4vw,3.3rem);line-height:1.06;letter-spacing:-.045em;margin:.35em 0}
    .lede{font-size:clamp(1.1rem,2vw,1.42rem);color:var(--muted);max-width:650px}.button{display:inline-flex;align-items:center;justify-content:center;margin-top:22px;background:var(--accent);color:#082114;padding:14px 22px;border-radius:999px;text-decoration:none;font-weight:780;width:max-content;box-shadow:0 12px 40px #5eec8330}
    section{padding:80px 0;border-top:1px solid var(--line);max-width:750px}section p:not(.eyebrow){color:var(--muted);font-size:1.12rem}
    footer{border-top:1px solid var(--line);padding:24px clamp(20px,6vw,88px);color:var(--muted);font-size:.86rem}
    @media(max-width:620px){header{height:auto;min-height:70px;gap:12px;flex-wrap:wrap;padding-top:12px;padding-bottom:12px}nav{width:100%;justify-content:space-between}main{padding-top:76px}.hero{min-height:66vh}}
    @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{animation-duration:.01ms!important;transition-duration:.01ms!important}}
  </style>
</head>
<body>
  <header><a class="brand" href="./">${escapeHtml(title)}<span> .</span></a>${menu}</header>
  <main><div class="hero">${hero}</div>${sections}</main>
  <footer>Made with bento-deck-studio</footer>
</body>
</html>
`;
}

function parseArgs(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) throw new Error(`Unexpected argument: ${args[i]}`);
    const key = args[i].slice(2);
    if (key === 'tier') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing value for --tier.');
      values[key] = args[++i];
    } else {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for --${key}.`);
      values[key] = args[++i];
    }
  }
  return values;
}

export async function buildSite({ deckHtml, out, tier = 'launch', favicon }) {
  if (!['launch', 'full'].includes(tier)) throw new Error(`Unsupported site tier: ${tier}`);
  const deckDoc = validateDeckHtml(deckHtml);
  await mkdir(path.join(out, 'slides'), { recursive: true });
  for (const destination of [
    path.join(out, 'index.html'),
    path.join(out, 'slides', 'deck.bento.html'),
    path.join(out, 'favicon.svg'),
    path.join(out, 'favicon.png'),
    path.join(out, 'favicon.jpg'),
    path.join(out, 'favicon.webp')
  ]) {
    try {
      await access(destination);
      throw new Error(`Refusing to overwrite existing output: ${destination}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const icon = await writeSiteFavicon(out, deckDoc.title, deckDoc.theme, favicon);
  await writeFile(path.join(out, 'slides', 'deck.bento.html'), makeReadOnlyDeck(deckHtml), { flag: 'wx' });
  await writeFile(path.join(out, 'index.html'), pageHtml({
    title: tier === 'full' ? deckDoc.title : 'Your presentation',
    deckTitle: deckDoc.title,
    tier,
    faviconHref: icon.href
  }), { flag: 'wx' });
  console.log(`Built ${tier} site in ${out}.`);
}

async function main(args) {
  const options = parseArgs(args);
  if (!options.deck || !options.out || !['launch', 'full'].includes(options.tier ?? 'launch')) {
    console.error('Usage: node scripts/site-build.mjs --deck deck.bento.html --out site [--tier launch|full] [--favicon image]');
    process.exitCode = 2;
    return;
  }
  const tier = options.tier ?? 'launch';
  const deckHtml = await readFile(options.deck, 'utf8');
  await buildSite({ deckHtml, out: options.out, tier, favicon: options.favicon });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Site build failed: ${error.message}`);
    process.exitCode = 1;
  });
}
