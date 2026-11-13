#!/usr/bin/env node
// Builds the bento-deck-studio project website into a static folder for GitHub Pages.
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { escapeHtml, parseFrontmatter, renderInline, renderMarkdown } from './lib/markdown.mjs';
import { makeReadOnlyDeck } from './site-build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLIDES_HREF = 'slides/deck.bento.html';
const CSP = "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self'; script-src 'self'; font-src 'self'; base-uri 'self'; form-action 'none'";
const SKILL_ORDER = ['theme-extract', 'deck-author', 'deck-build', 'favicon', 'site-build', 'deck-qa'];

const skipJunk = (src) => !path.basename(src).startsWith('._') && path.basename(src) !== '.DS_Store';

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function write(out, rel, content) {
  const file = path.join(out, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, { flag: 'wx' });
}

function normalizeBaseUrl(url) {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`Base URL must use http or https: ${url}`);
  if (!parsed.pathname.endsWith('/')) parsed.pathname += '/';
  return parsed.href;
}

function githubBlob(repository, file) {
  return `${repository}/blob/main/${file.split(path.sep).join('/')}`;
}

function layout(site, page) {
  const r = page.root;
  const canonical = new URL(page.path === 'index.html' ? '' : page.path, site.baseUrl).href;
  const title = page.title === site.name ? `${site.name}: ${site.tagline}` : `${page.title} · ${site.name}`;
  const current = (key) => (page.nav === key ? ' aria-current="page"' : '');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${CSP}">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(page.description)}">
  <meta name="theme-color" content="#101411">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <link rel="icon" href="${r}assets/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="${r}assets/apple-touch-icon.png">
  <link rel="preload" href="${r}assets/fonts/MonaSans.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="${r}assets/styles.css">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${escapeHtml(site.name)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(page.description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${escapeHtml(new URL('assets/og.png', site.baseUrl).href)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="bento-deck-studio: your PowerPoint theme, as editable bento slides.">
  <meta name="twitter:card" content="summary_large_image">
  <script src="${r}assets/app.js"></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="wrap">
      <a class="brand" href="${r}index.html"><img src="${r}assets/favicon.svg" alt="" width="28" height="28">${escapeHtml(site.name)}<span class="version">v${escapeHtml(site.version)}</span></a>
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
      <nav id="site-nav" class="site-nav" aria-label="Main">
        <a class="slides-link" href="${r}${SLIDES_HREF}" target="_blank" rel="noopener">Slides ↗<span class="visually-hidden"> (opens in a new tab)</span></a>
        <a href="${r}docs/getting-started.html"${current('docs')}>Docs</a>
        <a href="${r}skills.html"${current('skills')}>Skills</a>
        <a href="${r}index.html#demo">Demo</a>
        <a href="${r}releases.html"${current('releases')}>Releases</a>
        <a href="${escapeHtml(site.repository)}" rel="noopener">GitHub</a>
      </nav>
    </div>
  </header>
  <main id="main">
${page.body}
  </main>
  <footer class="site-footer">
    <div class="wrap">
      <p>${escapeHtml(site.name)} v${escapeHtml(site.version)} · ${escapeHtml(site.license)} License · Built for <a href="https://bento.page/" rel="noopener">bento</a> slides.</p>
      <nav aria-label="Footer">
        <a href="${r}docs/getting-started.html">Get started</a>
        <a href="${r}docs/safety.html">Safety</a>
        <a href="${r}docs/release-process.html">Release process</a>
        <a href="${escapeHtml(site.repository)}/issues" rel="noopener">Issues</a>
      </nav>
    </div>
  </footer>
</body>
</html>
`;
}

function landingBody(site) {
  const pin = `copilot plugin marketplace add ${site.slug}#v${site.version}\ncopilot plugin install ${site.name}@${site.name}`;
  return `    <section class="hero">
      <div class="wrap">
        <div>
          <p class="eyebrow">GitHub Copilot plugin · v${escapeHtml(site.version)}</p>
          <h1>Your PowerPoint theme, as <em>editable bento slides</em>.</h1>
          <p class="lede">${escapeHtml(site.name)} reads a template's colors, fonts, proportions, and layouts, then builds native bento slides and an optional companion site, right from the Copilot app or Copilot CLI.</p>
          <div class="actions">
            <a class="button primary" href="docs/getting-started.html">Get started</a>
            <a class="button secondary" href="${SLIDES_HREF}" target="_blank" rel="noopener">Open the showcase deck ↗<span class="visually-hidden"> (opens in a new tab)</span></a>
          </div>
        </div>
        <figure class="hero-visual">
          <a href="${SLIDES_HREF}" target="_blank" rel="noopener"><img src="assets/showcase-cover.png" width="1280" height="720" alt="Cover slide of the showcase deck, titled bento-deck-studio, in GitHub's dark presentation theme."></a>
          <figcaption>The showcase deck, built by the plugin from GitHub's 2026 presentation template.</figcaption>
        </figure>
      </div>
    </section>

    <section class="section" id="how-it-works">
      <div class="wrap">
        <div class="section-head">
          <p class="eyebrow">How it works</p>
          <h2>Theme in. Story out.</h2>
          <p>One agent coordinates six Agent Skills, and checks with you at each decision that matters.</p>
        </div>
        <ol class="steps">
          <li><h3>Extract</h3><p>Read colors, fonts, slide size, masters, and layouts from a <code>.pptx</code> or <code>.potx</code>.</p></li>
          <li><h3>Author</h3><p>Shape your topic, notes, or Markdown into a clear narrative on the template's own layouts.</p></li>
          <li><h3>Build</h3><p>Create an editable <code>.bento.html</code> from the signed bento shell, with a favicon.</p></li>
          <li><h3>Share</h3><p>Publish a launch page or a full companion site, with a read-only copy of the deck.</p></li>
        </ol>
        <figure class="workflow">
          <img src="images/workflow.svg" width="1200" height="360" alt="A PowerPoint theme and story become an editable bento deck, then a launch site or optional companion website.">
        </figure>
      </div>
    </section>

    <section class="section" id="features">
      <div class="wrap">
        <div class="section-head">
          <p class="eyebrow">Built to match the source</p>
          <h2>Keep your brand. Skip the rebuild.</h2>
          <p>Slides stay native and editable, while the look comes straight from the template you already trust.</p>
        </div>
        <div class="bento">
          <article class="tile wide accent">
            <span class="tag">Colors</span>
            <div class="swatches" aria-hidden="true"><span class="sw-1"></span><span class="sw-2"></span><span class="sw-3"></span><span class="sw-4"></span><span class="sw-5"></span><span class="sw-6"></span><span class="sw-7"></span><span class="sw-8"></span></div>
            <h3>Every theme color, mapped</h3>
            <p>All 12 theme colors resolve through each slide master's color map, so dark and light variants stay true to the source.</p>
          </article>
          <article class="tile tall">
            <span class="tag">Typography</span>
            <p class="type-sample" aria-hidden="true">Aa<small>Mona Sans, from the template</small></p>
            <h3>Type calibrated to PowerPoint</h3>
            <p>Font metrics set sizes and line heights to match PowerPoint, and fonts are embedded only when their license allows it.</p>
          </article>
          <article class="tile">
            <span class="tag">Proportions</span>
            <p class="big-stat">16:9</p>
            <h3>Same size and geometry</h3>
            <p>Slide size and placeholder positions carry over from each layout.</p>
          </article>
          <article class="tile purple">
            <span class="tag">Layouts</span>
            <p class="big-stat">6</p>
            <h3>Layout roles</h3>
            <p>Cover, content, section, statement, closing, and blank.</p>
          </article>
          <article class="tile half blue">
            <span class="tag">Sharing</span>
            <h3>Launch page or full site</h3>
            <p>Public decks are read-only, with speaker notes and collaboration keys removed. Favicons come from your image or a theme-colored monogram.</p>
          </article>
          <article class="tile half">
            <span class="tag">Safety</span>
            <h3>Verified shell, no dependencies</h3>
            <p>Every build checks the bento shell's ECDSA signature and SHA-256. The scripts use Node.js built-ins only.</p>
          </article>
        </div>
      </div>
    </section>

    <section class="section" id="demo">
      <div class="wrap">
        <div class="section-head">
          <p class="eyebrow">Demo</p>
          <h2>See it in action.</h2>
          <p>A narrated tour from PowerPoint template to published slides.</p>
        </div>
        <div class="video-frame">
          <video controls preload="metadata" playsinline poster="assets/demo-poster.jpg" width="1280" height="720" aria-label="bento-deck-studio demo video">
            <source src="media/bento-deck-studio-demo.mp4" type="video/mp4">
            <a href="media/bento-deck-studio-demo.mp4">Download the demo video</a>.
          </video>
        </div>
        <p class="media-note">Narrated with the open Kokoro-82M voice. Captions are burned in, and a <a href="media/bento-deck-studio-demo.srt">caption file</a> is available.</p>
        <div class="gallery">
          <figure>
            <img src="images/deck-editor.png" width="1200" height="863" loading="lazy" alt="A generated bento deck open in the bento editor.">
            <figcaption><strong>Editable deck</strong>Every slide stays native and editable in bento.</figcaption>
          </figure>
          <figure>
            <a href="example/index.html"><img src="images/launch-site.png" width="1185" height="1004" loading="lazy" alt="The default launch site with a single button that opens the slides."></a>
            <figcaption><strong>Launch page</strong>The default: one page that opens the deck. <a href="example/index.html">View the example</a>.</figcaption>
          </figure>
          <figure>
            <img src="images/full-site.png" width="1185" height="1925" loading="lazy" alt="A full companion site with Slides first in its top menu.">
            <figcaption><strong>Full companion site</strong>Optional sections, with <strong>Slides ↗</strong> first in the menu.</figcaption>
          </figure>
        </div>
      </div>
    </section>

    <section class="section" id="install">
      <div class="wrap install-grid">
        <div>
          <p class="eyebrow">Install</p>
          <h2>Add it to Copilot in two commands.</h2>
          <p>Pin the release in the Copilot CLI:</p>
          <pre><code data-lang="sh">${escapeHtml(pin)}</code></pre>
          <p>In the Copilot app, add the same marketplace under <strong>Customize</strong>, then install <strong>${escapeHtml(site.name)}</strong>.</p>
        </div>
        <div>
          <h3>Then ask for a deck</h3>
          <pre><code data-lang="text">Use the bento-deck-studio agent to turn brand-template.potx
and notes.md into bento slides, then create a launch site.</code></pre>
          <div class="actions">
            <a class="button primary" href="docs/getting-started.html">Read the guide</a>
            <a class="button secondary" href="releases.html">Release notes</a>
          </div>
        </div>
      </div>
    </section>`;
}

function docsBody(site, docs, index, rendered) {
  const doc = docs[index];
  const nav = docs.map((item) => `<li><a href="${item.slug}.html"${item === doc ? ' aria-current="page"' : ''}>${escapeHtml(item.title)}</a></li>`).join('');
  const toc = rendered.headings.filter((h) => h.level === 2)
    .map((h) => `<li><a href="#${h.id}">${h.text}</a></li>`).join('');
  const prev = docs[index - 1];
  const next = docs[index + 1];
  const pager = [
    prev ? `<a class="prev" href="${prev.slug}.html"><small>Previous</small>${escapeHtml(prev.title)}</a>` : '',
    next ? `<a class="next" href="${next.slug}.html"><small>Next</small>${escapeHtml(next.title)}</a>` : ''
  ].join('');
  const source = `<p class="media-note"><a href="${escapeHtml(githubBlob(site.repository, doc.source))}" rel="noopener">View this page's source on GitHub</a></p>`;
  return `    <div class="wrap docs">
      <nav class="docs-nav" aria-label="Documentation"><h2>Docs</h2><ul>${nav}</ul></nav>
      <article class="prose">
${rendered.html}
${source}
        <nav class="pager" aria-label="Pagination">${pager}</nav>
      </article>
      ${toc ? `<nav class="toc" aria-label="On this page"><h2>On this page</h2><ul>${toc}</ul></nav>` : ''}
    </div>`;
}

function skillsBody(site, agent, skills) {
  const repoLink = (file) => (url) => {
    if (/^(https?:|mailto:|#)/i.test(url)) return url;
    return githubBlob(site.repository, path.join(path.dirname(file), url));
  };
  const card = (entry, tag, extraClass = '') => {
    const body = renderMarkdown(entry.body, { rewriteUrl: repoLink(entry.file) }).html
      .replace(/<(\/?)h([1-5])\b/g, (_, slash, level) => `<${slash}h${Math.min(Number(level) + 2, 6)}`)
      .replace(/ id="[^"]*"/g, '');
    return `<article class="card${extraClass}" id="${escapeHtml(entry.name)}">
          <h2><code>${escapeHtml(tag)}</code></h2>
          <p>${renderInline(entry.description)}</p>
          <details><summary>Show instructions</summary><div class="prose">${body}</div></details>
          <p class="media-note"><a href="${escapeHtml(githubBlob(site.repository, entry.file))}" rel="noopener">View on GitHub</a></p>
        </article>`;
  };
  return `    <div class="wrap prose-page">
      <div class="section-head page-head">
        <p class="eyebrow">Agent and skills</p>
        <h1>One agent. Six focused skills.</h1>
        <p>Ask the <strong>${escapeHtml(agent.name)}</strong> agent for a complete deck, or call one skill directly when you need just one step.</p>
      </div>
      <div class="cards">
        ${card(agent, `@${agent.name}`, ' agent')}
        ${skills.map((skill) => card(skill, `/${skill.name}`)).join('\n        ')}
      </div>
    </div>`;
}

export function parseChangelog(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const refs = {};
  for (const line of lines) {
    const def = line.match(/^\[([^\]]+)\]:\s+(\S+)\s*$/);
    if (def) refs[def[1].toLowerCase()] = def[2];
  }
  const releases = [];
  let current = null;
  for (const line of lines) {
    const heading = line.match(/^## \[([^\]]+)\](?:\s+-\s+(\d{4}-\d{2}-\d{2}))?\s*$/);
    if (heading) {
      current = { version: heading[1], date: heading[2] ?? null, lines: [] };
      releases.push(current);
    } else if (current && !/^\[[^\]]+\]:\s/.test(line)) {
      current.lines.push(line);
    }
  }
  return releases.map((release) => ({
    version: release.version,
    date: release.date,
    url: refs[release.version.toLowerCase()] ?? null,
    body: release.lines.join('\n').trim()
  }));
}

function releasesBody(site, releases) {
  const published = releases.filter((release) => release.date);
  const sections = published.map((release, index) => {
    const tag = `v${release.version}`;
    const zip = `${site.repository}/releases/download/${tag}/${site.name}-${release.version}.zip`;
    const body = renderMarkdown(release.body).html.replace(/ id="([^"]*)"/g, ` id="${tag}-$1"`);
    return `<section class="release" id="${escapeHtml(tag)}">
          <h2>${escapeHtml(tag)}</h2>
          <div class="release-meta">${index === 0 ? '<span class="pill latest">Latest</span>' : ''}<span class="pill">${escapeHtml(release.date)}</span></div>
${body}
          <p><a href="${escapeHtml(release.url ?? `${site.repository}/releases/tag/${tag}`)}" rel="noopener">GitHub release</a> · <a href="${escapeHtml(zip)}" rel="noopener">Download the zip</a></p>
          <pre><code data-lang="sh">copilot plugin marketplace add ${escapeHtml(site.slug)}#${escapeHtml(tag)}
copilot plugin install ${escapeHtml(site.name)}@${escapeHtml(site.name)}</code></pre>
        </section>`;
  }).join('\n');
  return `    <div class="wrap prose-page">
      <article class="prose">
        <p class="eyebrow">Releases</p>
        <h1>Release notes</h1>
        <p class="lead">Every release is a Git tag you can pin, with a plugin zip, a <code>SHA256SUMS</code> file, and a build provenance attestation. See the <a href="docs/release-process.html">release process</a> for how releases are made and verified.</p>
        ${sections || '<p>No releases yet.</p>'}
        <h2 id="verify">Verify and install a download</h2>
        <p>Download the zip and <code>SHA256SUMS</code> from the GitHub release, then run:</p>
        <pre><code data-lang="sh">shasum -a 256 -c SHA256SUMS
gh attestation verify ${escapeHtml(site.name)}-${escapeHtml(site.version)}.zip --repo ${escapeHtml(site.slug)}</code></pre>
        <p>To install offline, extract the zip and add the folder as a marketplace. The CLI loads it in place, so keep the folder where it is.</p>
        <pre><code data-lang="sh">unzip ${escapeHtml(site.name)}-${escapeHtml(site.version)}.zip
copilot plugin marketplace add ./${escapeHtml(site.name)}-${escapeHtml(site.version)}
copilot plugin install ${escapeHtml(site.name)}@${escapeHtml(site.name)}</code></pre>
      </article>
    </div>`;
}

function notFoundBody(r) {
  return `    <div class="wrap not-found">
      <div>
        <p class="eyebrow">404</p>
        <h1>Page not found</h1>
        <p class="lede">That page isn't here. Try the docs, or open the showcase deck.</p>
        <div class="actions">
          <a class="button primary" href="${r}index.html">Go home</a>
          <a class="button secondary" href="${r}docs/getting-started.html">Read the docs</a>
        </div>
      </div>
    </div>`;
}

async function readDocs(root) {
  const contentDir = path.join(root, 'website', 'content');
  const files = (await readdir(contentDir)).filter((name) => name.endsWith('.md') && !name.startsWith('._'));
  const docs = [];
  for (const name of files) {
    docs.push({ source: path.join('website', 'content', name), slug: name.replace(/\.md$/, '') });
  }
  docs.push({ source: path.join('docs', 'release-plan.md'), slug: 'release-process' });
  for (const doc of docs) {
    const { data, body } = parseFrontmatter(await readFile(path.join(root, doc.source), 'utf8'));
    if (!data.title || !data.description || !data.order) throw new Error(`${doc.source} needs title, description, and order frontmatter.`);
    Object.assign(doc, { title: data.title, description: data.description, order: Number(data.order), body });
  }
  return docs.sort((a, b) => a.order - b.order);
}

async function readSkills(root) {
  const read = async (file) => {
    const { data, body } = parseFrontmatter(await readFile(path.join(root, file), 'utf8'));
    if (!data.name || !data.description) throw new Error(`${file} needs name and description frontmatter.`);
    return { file, name: data.name, description: data.description, body };
  };
  const names = (await readdir(path.join(root, 'skills'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((a, b) => (SKILL_ORDER.indexOf(a) + 1 || 99) - (SKILL_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
  const skills = [];
  for (const name of names) skills.push(await read(path.join('skills', name, 'SKILL.md')));
  const agentDir = path.join('com.github.copilot', 'agents');
  const agentFile = (await readdir(path.join(root, agentDir))).find((name) => name.endsWith('.agent.md') && !name.startsWith('._'));
  if (!agentFile) throw new Error('No agent definition found in com.github.copilot/agents.');
  return { agent: await read(path.join(agentDir, agentFile)), skills };
}

function rewriteDocUrl(url) {
  if (/^(https?:|mailto:|#)/i.test(url)) return url;
  return url.replace(/^release-plan\.md/, 'release-process.md').replace(/\.md(?=$|#)/, '.html');
}

async function listHtml(dir, base = dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listHtml(full, base));
    else if (entry.name.endsWith('.html') && !entry.name.endsWith('.bento.html')) files.push(path.relative(base, full));
  }
  return files;
}

export async function checkLinks(out, { basePath } = {}) {
  const broken = [];
  const idCache = new Map();
  const ids = async (file) => {
    if (!idCache.has(file)) {
      const html = await readFile(file, 'utf8');
      idCache.set(file, new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])));
    }
    return idCache.get(file);
  };
  for (const rel of await listHtml(out)) {
    const file = path.join(out, rel);
    const html = await readFile(file, 'utf8');
    const refs = [...html.matchAll(/\s(?:href|src|poster)="([^"]*)"/g)].map((match) => match[1].replace(/&amp;/g, '&'));
    for (const ref of refs) {
      if (/^(https?:|mailto:|data:)/i.test(ref) || ref.startsWith('//')) continue;
      const sitePath = ref.startsWith('/');
      if (sitePath && !(basePath && ref.startsWith(basePath))) continue;
      const baseDir = sitePath ? out : path.dirname(file);
      const [target, fragment] = (sitePath ? ref.slice(basePath.length) : ref).split('#');
      let resolved = target ? path.resolve(baseDir, decodeURIComponent(target.split('?')[0])) : (sitePath ? path.join(out, 'index.html') : file);
      if (target && (target.endsWith('/') || (await exists(resolved) && (await stat(resolved)).isDirectory()))) {
        resolved = path.join(resolved, 'index.html');
      }
      if (!resolved.startsWith(path.resolve(out)) || !await exists(resolved)) {
        broken.push(`${rel}: ${ref}`);
        continue;
      }
      if (fragment && resolved.endsWith('.html') && !resolved.endsWith('.bento.html') && !(await ids(resolved)).has(fragment)) {
        broken.push(`${rel}: ${ref} (missing #${fragment})`);
      }
    }
  }
  const cssDir = path.join(out, 'assets');
  if (await exists(path.join(cssDir, 'styles.css'))) {
    const css = await readFile(path.join(cssDir, 'styles.css'), 'utf8');
    for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      if (!/^(https?:|data:)/.test(match[1]) && !await exists(path.resolve(cssDir, match[1]))) broken.push(`assets/styles.css: ${match[1]}`);
    }
  }
  return broken;
}

export async function buildWebsite({ root = ROOT, out, baseUrl } = {}) {
  if (!out) throw new Error('An output folder is required.');
  if (await exists(out) && (await readdir(out)).length) throw new Error(`Refusing to overwrite a non-empty output folder: ${out}`);
  const plugin = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  const repository = String(plugin.repository).replace(/\/$/, '');
  const site = {
    name: plugin.name,
    version: plugin.version,
    license: plugin.license ?? 'MIT',
    repository,
    slug: new URL(repository).pathname.replace(/^\/|\.git$/g, ''),
    tagline: 'PowerPoint themes as editable bento slides',
    baseUrl: normalizeBaseUrl(baseUrl ?? plugin.homepage ?? 'http://localhost/')
  };
  await mkdir(out, { recursive: true });

  const copy = (from, to) => cp(path.join(root, from), path.join(out, to), { recursive: true, filter: skipJunk, errorOnExist: true, force: false });
  await copy('website/assets', 'assets');
  await copy('docs/images', 'images');
  await copy('site', 'example');
  await mkdir(path.join(out, 'media'));
  for (const name of ['bento-deck-studio-demo.mp4', 'bento-deck-studio-demo.srt']) await copy(path.join('media', name), path.join('media', name));
  await write(out, SLIDES_HREF, makeReadOnlyDeck(await readFile(path.join(root, 'website', SLIDES_HREF), 'utf8')));

  const pages = [];
  const addPage = async (page) => {
    pages.push(page);
    await write(out, page.path, layout(site, page));
  };
  await addPage({
    path: 'index.html',
    root: '',
    title: site.name,
    description: `${plugin.description} A GitHub Copilot plugin for the Copilot app and Copilot CLI.`,
    body: landingBody(site)
  });

  const docs = await readDocs(root);
  for (let i = 0; i < docs.length; i++) {
    const rendered = renderMarkdown(docs[i].body, { rewriteUrl: rewriteDocUrl });
    await addPage({
      path: `docs/${docs[i].slug}.html`,
      root: '../',
      nav: 'docs',
      title: docs[i].title,
      description: docs[i].description,
      body: docsBody(site, docs, i, rendered)
    });
  }

  const { agent, skills } = await readSkills(root);
  await addPage({
    path: 'skills.html',
    root: '',
    nav: 'skills',
    title: 'Agent and skills',
    description: `The ${agent.name} agent and its ${skills.length} Agent Skills for themed bento decks and companion sites.`,
    body: skillsBody(site, agent, skills)
  });

  const releases = parseChangelog(await readFile(path.join(root, 'CHANGELOG.md'), 'utf8'));
  await addPage({
    path: 'releases.html',
    root: '',
    nav: 'releases',
    title: 'Release notes',
    description: `Release notes, pinned install commands, and download verification for ${site.name}.`,
    body: releasesBody(site, releases)
  });

  // Pages serves 404.html at any missing URL depth, so it links by absolute site path.
  // A <base> element would also redirect the "#main" skip link to the home page.
  const basePath = new URL(site.baseUrl).pathname;
  const absoluteRoot = escapeHtml(basePath);
  await write(out, '404.html', layout(site, {
    path: '404.html', root: absoluteRoot, title: 'Page not found', description: 'This page does not exist.', body: notFoundBody(absoluteRoot)
  }));
  const urls = pages.map((page) => `  <url><loc>${escapeHtml(new URL(page.path === 'index.html' ? '' : page.path, site.baseUrl).href)}</loc></url>`);
  await write(out, 'sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
  await write(out, 'robots.txt', `User-agent: *\nAllow: /\nSitemap: ${new URL('sitemap.xml', site.baseUrl).href}\n`);
  await write(out, '.nojekyll', '');

  const broken = await checkLinks(out, { basePath });
  if (broken.length) throw new Error(`Broken internal links:\n  ${broken.join('\n  ')}`);
  return { pages: pages.length + 1, docs: docs.length, skills: skills.length, releases: releases.filter((r) => r.date).length, baseUrl: site.baseUrl };
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key !== '--out' && key !== '--base-url') throw new Error(`Unexpected argument: ${key}`);
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${key}.`);
    options[key === '--out' ? 'out' : 'baseUrl'] = args[++i];
  }
  return options;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.out) {
      console.error('Usage: node scripts/website-build.mjs --out _site [--base-url https://example.com/path/]');
      process.exitCode = 2;
    } else {
      const result = await buildWebsite({ out: path.resolve(options.out), baseUrl: options.baseUrl });
      console.log(`Built ${result.pages} pages (${result.docs} docs, ${result.skills} skills, ${result.releases} releases) for ${result.baseUrl} in ${options.out}. No broken internal links.`);
    }
  } catch (error) {
    console.error(`Website build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
