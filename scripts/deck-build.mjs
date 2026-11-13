#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadVerifiedShell, spliceDeck } from './lib/bento.mjs';
import { readFavicon } from './lib/favicon.mjs';

function escapeHtml(text) {
  return String(text).replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
}

export function parseMarkdown(markdown, fallbackTitle = 'Untitled presentation') {
  const sections = [];
  let title = fallbackTitle;
  let subtitle = '';
  let current = null;
  let preamble = [];
  const flush = () => {
    if (current) {
      current.items = current.items.filter((item) => item.trim());
      sections.push(current);
    }
  };
  for (const rawLine of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('# ') && !sections.length && !current) {
      title = line.slice(2).trim() || title;
    } else if (line.startsWith('## ')) {
      flush();
      current = { title: line.slice(3).trim(), items: [] };
    } else if (current) {
      if (line.startsWith('- ') || line.startsWith('* ')) current.items.push(line.slice(2).trim());
      else if (line && !line.startsWith('<!--')) current.items.push(line);
    } else if (line && !line.startsWith('<!--')) {
      preamble.push(line);
    }
  }
  flush();
  if (preamble.length) subtitle = preamble.join(' ');
  if (!sections.length && subtitle) sections.push({ title: 'Key message', items: [subtitle] });
  if (!sections.length) sections.push({ title: 'Key message', items: ['Add slide content beneath a level-two Markdown heading.'] });
  return { title, subtitle, sections };
}

function slideParts(section, size, theme, index) {
  const scale = size.width / 1280;
  const margin = Math.round(96 * scale);
  const contentWidth = size.width - 2 * margin;
  const titleFont = Math.round(42 * scale);
  const bodyFont = Math.round(27 * scale);
  const items = section.items.length ? section.items : [''];
  const slides = [];
  for (let offset = 0; offset < items.length; offset += 5) {
    const pageItems = items.slice(offset, offset + 5);
    const pageNo = Math.floor(offset / 5);
    const slideId = `slide-${String(index).padStart(2, '0')}-${String(pageNo + 1).padStart(2, '0')}`;
    const elements = [
      {
        id: `${slideId}-rail`, type: 'shape', shape: 'rect',
        x: margin, y: Math.round(84 * scale), w: Math.round(8 * scale), h: Math.round(70 * scale),
        rotation: 0, opacity: 1, fill: theme.accent, strokeWidth: 0, radius: Math.round(4 * scale)
      },
      {
        id: `${slideId}-kicker`, type: 'text',
        x: margin + Math.round(24 * scale), y: Math.round(82 * scale), w: contentWidth - Math.round(24 * scale), h: Math.round(32 * scale),
        rotation: 0, opacity: 1, html: `SECTION ${String(index).padStart(2, '0')}`,
        fontSize: Math.round(15 * scale), fontFamily: theme.fontFamily, fontWeight: 700,
        color: theme.accent, align: 'left', valign: 'top', lineHeight: 1.1, role: 'kicker'
      },
      {
        id: `${slideId}-title`, type: 'text',
        x: margin, y: Math.round(142 * scale), w: contentWidth, h: Math.round(104 * scale),
        rotation: 0, opacity: 1, html: escapeHtml(section.title),
        fontSize: titleFont, fontFamily: theme.fontFamily, fontWeight: 750,
        color: theme.color, align: 'left', valign: 'top', lineHeight: 1.08, role: 'title'
      }
    ];
    const itemTop = Math.round(286 * scale);
    const itemGap = Math.round(72 * scale);
    pageItems.forEach((text, itemIndex) => {
      const y = itemTop + itemIndex * itemGap;
      elements.push({
        id: `${slideId}-body-${itemIndex + 1}`, type: 'text',
        x: margin, y, w: Math.round(28 * scale), h: Math.round(48 * scale),
        rotation: 0, opacity: 1, html: '•',
        fontSize: Math.round(32 * scale), fontFamily: theme.fontFamily, fontWeight: 700,
        color: theme.accent, align: 'left', valign: 'top', lineHeight: 1.2, role: 'body'
      });
      elements.push({
        id: `${slideId}-copy-${itemIndex + 1}`, type: 'text',
        x: margin + Math.round(42 * scale), y, w: contentWidth - Math.round(42 * scale), h: Math.round(58 * scale),
        rotation: 0, opacity: 1, html: escapeHtml(text),
        fontSize: bodyFont, fontFamily: theme.fontFamily, fontWeight: 450,
        color: theme.color, align: 'left', valign: 'top', lineHeight: 1.28, role: 'body'
      });
    });
    slides.push({
      id: slideId, background: theme.background, transition: 'morph',
      notes: '', elements
    });
  }
  return slides;
}

export function createDocument(markdown, themeData, fallbackTitle = 'Untitled presentation') {
  const content = parseMarkdown(markdown, fallbackTitle);
  const size = themeData.size ?? { width: 1280, height: 720 };
  const theme = themeData.theme ?? {
    background: '#101418', color: '#F2F0EA', accent: '#FF9E8A',
    fontFamily: 'system-ui, sans-serif'
  };
  const scale = size.width / 1280;
  const margin = Math.round(96 * scale);
  const elements = [
    {
      id: 'title-accent', type: 'shape', shape: 'rect',
      x: margin, y: Math.round(194 * scale), w: Math.round(12 * scale), h: Math.round(232 * scale),
      rotation: 0, opacity: 1, fill: theme.accent, strokeWidth: 0, radius: Math.round(6 * scale)
    },
    {
      id: 'title-heading', type: 'text',
      x: margin + Math.round(40 * scale), y: Math.round(205 * scale),
      w: size.width - margin * 2 - Math.round(40 * scale), h: Math.round(132 * scale),
      rotation: 0, opacity: 1, html: escapeHtml(content.title),
      fontSize: Math.round(62 * scale), fontFamily: themeData.fonts?.heading ?? theme.fontFamily,
      fontWeight: 760, color: theme.color, align: 'left', valign: 'top',
      lineHeight: 1.08, role: 'title'
    }
  ];
  if (content.subtitle) {
    elements.push({
      id: 'title-subtitle', type: 'text',
      x: margin + Math.round(42 * scale), y: Math.round(365 * scale),
      w: size.width - margin * 2 - Math.round(60 * scale), h: Math.round(116 * scale),
      rotation: 0, opacity: 1, html: escapeHtml(content.subtitle),
      fontSize: Math.round(28 * scale), fontFamily: theme.fontFamily,
      fontWeight: 430, color: theme.color, align: 'left', valign: 'top',
      lineHeight: 1.25, role: 'subtitle'
    });
  }
  const slides = [{
    id: 'slide-title', background: theme.background, transition: 'fade',
    notes: '', elements
  }];
  content.sections.forEach((section, index) => {
    slides.push(...slideParts(section, size, theme, index + 1));
  });
  return {
    format: 'bento/slides',
    version: 1,
    title: content.title,
    size,
    theme,
    meta: { subject: 'PowerPoint-themed bento presentation' },
    slides,
    assets: {}
  };
}

function parseArgs(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${args[i]}.`);
      values[args[i].slice(2)] = args[++i];
    }
  }
  return values;
}

async function main(args) {
  const options = parseArgs(args);
  if (!options.theme || !options.content || !options.out) {
    console.error('Usage: node scripts/deck-build.mjs --theme theme.json --content outline.md --out deck.bento.html [--favicon favicon.svg]');
    process.exitCode = 2;
    return;
  }
  const theme = JSON.parse(await readFile(options.theme, 'utf8'));
  const markdown = await readFile(options.content, 'utf8');
  const doc = createDocument(markdown, theme, options.content);
  const favicon = options.favicon ? await readFavicon(options.favicon) : null;
  const faviconDataUri = favicon
    ? `data:${favicon.mime};base64,${favicon.data.toString('base64')}`
    : null;
  const { shell } = await loadVerifiedShell();
  const result = spliceDeck(shell, doc, faviconDataUri);
  await writeFile(options.out, result, { flag: 'wx' });
  console.log(`Built ${options.out} (${doc.slides.length} slides).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Deck build failed: ${error.message}`);
    process.exitCode = 1;
  });
}
