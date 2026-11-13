#!/usr/bin/env node
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateDeckHtml } from './lib/bento.mjs';

async function validatePlugin(root) {
  const plugin = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
  const marketplace = JSON.parse(await readFile(path.join(root, '.github/plugin/marketplace.json'), 'utf8'));
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(plugin.name) || plugin.name !== marketplace.plugins[0]?.name) {
    throw new Error('Plugin and marketplace names must match and use a valid lowercase plugin name.');
  }
  const dirs = await readdir(path.join(root, 'skills'), { withFileTypes: true });
  const skills = dirs.filter((entry) => entry.isDirectory());
  if (skills.length < 5) throw new Error('Expected the deck workflow skills to be installed in skills/.');
  for (const dir of skills) {
    const skill = await readFile(path.join(root, 'skills', dir.name, 'SKILL.md'), 'utf8');
    if (!skill.startsWith('---\n') || !/^name:\s*[a-z0-9-]+$/m.test(skill) || !/^description:\s*.+$/m.test(skill)) {
      throw new Error(`Skill ${dir.name} is missing required frontmatter.`);
    }
  }
  console.log(`Plugin manifests and ${skills.length} skill definitions are valid.`);
}

async function validateSite(root) {
  const siteIndex = path.join(root, 'index.html');
  const site = await readFile(siteIndex, 'utf8');
  if (!/<html\b/i.test(site) || !/<title>[\s\S]+<\/title>/i.test(site) || !/<link\b[^>]*rel=["']icon["']/i.test(site)) {
    throw new Error('Site is missing its document title or favicon.');
  }
  const deckPath = path.join(root, 'slides/deck.bento.html');
  const deckDoc = validateDeckHtml(await readFile(deckPath, 'utf8'));
  if (deckDoc.readonly !== true || deckDoc.collab || deckDoc.slides.some((slide) => slide.notes)) {
    throw new Error('Site deck must be read-only, contain no collaboration keys, and have no speaker notes.');
  }
  const fullMenu = site.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i)?.[1];
  if (fullMenu) {
    const firstItem = fullMenu.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
    if (!firstItem
        || !/Slides\s*↗/.test(firstItem[1])
        || !/\bhref=["']slides\/deck\.bento\.html["']/.test(firstItem[0])
        || !/\btarget=["']_blank["']/.test(firstItem[0])
        || !/\brel=["']noopener["']/.test(firstItem[0])) {
      throw new Error('Full-site first menu item must be Slides ↗ and open the deck in a new tab with noopener.');
    }
  }
  console.log(`Site and ${deckDoc.slides.length}-slide read-only deck are valid.`);
}

async function main(args) {
  const target = args[0] ?? '.';
  const resolved = path.resolve(target);
  if ((await stat(resolved)).isDirectory()) {
    if (args[1] === '--site') await validateSite(resolved);
    else await validatePlugin(resolved);
  } else {
    validateDeckHtml(await readFile(resolved, 'utf8'));
    console.log(`Bento document is valid: ${resolved}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
