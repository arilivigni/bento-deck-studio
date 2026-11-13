#!/usr/bin/env node
// Release helpers: keep manifest versions, CHANGELOG.md, and tags consistent.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const MARKETPLACE = path.join('.github', 'plugin', 'marketplace.json');

function assertVersion(version) {
  if (!SEMVER.test(String(version ?? ''))) throw new Error(`Not a valid semantic version: ${version ?? '(missing)'}`);
}

async function readJson(root, file) {
  return JSON.parse(await readFile(path.join(root, file), 'utf8'));
}

export function manifestVersions(plugin, marketplace) {
  return {
    'plugin.json version': plugin.version,
    'marketplace.json metadata.version': marketplace.metadata?.version,
    'marketplace.json plugin version': marketplace.plugins?.find((entry) => entry.name === plugin.name)?.version
  };
}

export function releaseNotes(changelog, version) {
  assertVersion(version);
  const lines = changelog.replace(/\r\n?/g, '\n').split('\n');
  const escaped = version.replace(/[.+]/g, '\\$&');
  const start = lines.findIndex((line) => new RegExp(`^## \\[${escaped}\\]`).test(line));
  if (start === -1) throw new Error(`CHANGELOG.md has no section for ${version}.`);
  const heading = lines[start].match(/^## \[[^\]]+\]\s+-\s+(\d{4}-\d{2}-\d{2})\s*$/);
  if (!heading) throw new Error(`CHANGELOG.md section for ${version} needs a release date: ## [${version}] - YYYY-MM-DD`);
  let end = lines.findIndex((line, index) => index > start && (/^## /.test(line) || /^\[[^\]]+\]:\s/.test(line)));
  if (end === -1) end = lines.length;
  const body = lines.slice(start + 1, end).join('\n').trim();
  if (!body) throw new Error(`CHANGELOG.md section for ${version} is empty.`);
  return { date: heading[1], body };
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export async function checkRelease({ root = ROOT, version, tagged = false } = {}) {
  assertVersion(version);
  const problems = [];
  const plugin = await readJson(root, 'plugin.json');
  const marketplace = await readJson(root, MARKETPLACE);
  for (const [field, value] of Object.entries(manifestVersions(plugin, marketplace))) {
    if (value !== version) problems.push(`${field} is ${value ?? 'missing'}, expected ${version}.`);
  }
  const changelog = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
  try {
    releaseNotes(changelog, version);
  } catch (error) {
    problems.push(error.message);
  }
  if (!new RegExp(`^\\[${version.replace(/[.+]/g, '\\$&')}\\]:\\s+https://`, 'm').test(changelog)) {
    problems.push(`CHANGELOG.md is missing the [${version}] link reference.`);
  }
  const tag = `v${version}`;
  const tagCommit = (() => {
    try {
      return git(root, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`]);
    } catch {
      return null;
    }
  })();
  if (tagged) {
    if (!tagCommit) problems.push(`Tag ${tag} does not exist.`);
    else if (tagCommit !== git(root, ['rev-parse', 'HEAD'])) problems.push(`Tag ${tag} does not point at HEAD.`);
  } else if (tagCommit) {
    problems.push(`Tag ${tag} already exists. Published tags are never moved; release a new version instead.`);
  }
  return { version, tag, problems };
}

export async function bumpVersion({ root = ROOT, version } = {}) {
  assertVersion(version);
  const plugin = await readJson(root, 'plugin.json');
  const marketplace = await readJson(root, MARKETPLACE);
  const entry = marketplace.plugins?.find((item) => item.name === plugin.name);
  if (!entry) throw new Error(`${MARKETPLACE} has no plugin entry named ${plugin.name}.`);
  const previous = plugin.version;
  plugin.version = version;
  marketplace.metadata = { ...marketplace.metadata, version };
  entry.version = version;
  await writeFile(path.join(root, 'plugin.json'), `${JSON.stringify(plugin, null, 2)}\n`);
  await writeFile(path.join(root, MARKETPLACE), `${JSON.stringify(marketplace, null, 2)}\n`);
  return { previous, version };
}

async function main([command, version, ...rest]) {
  const usage = 'Usage: node scripts/release.mjs check <version> [--tagged] | notes <version> | bump <version>';
  if (!['check', 'notes', 'bump'].includes(command) || !version || rest.some((arg) => arg !== '--tagged')) {
    console.error(usage);
    process.exitCode = 2;
    return;
  }
  const clean = version.replace(/^v/, '');
  if (command === 'notes') {
    process.stdout.write(`${releaseNotes(await readFile(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), clean).body}\n`);
  } else if (command === 'bump') {
    const result = await bumpVersion({ version: clean });
    console.log(`Bumped ${result.previous} → ${result.version} in plugin.json and ${MARKETPLACE}. Add a dated CHANGELOG.md section before tagging.`);
  } else {
    const result = await checkRelease({ version: clean, tagged: rest.includes('--tagged') });
    if (result.problems.length) {
      console.error(`Release ${result.tag} is not ready:\n  - ${result.problems.join('\n  - ')}`);
      process.exitCode = 1;
    } else {
      console.log(`Release ${result.tag} is ready: manifests, CHANGELOG.md, and tag state all check out.`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Release check failed: ${error.message}`);
    process.exitCode = 1;
  });
}
