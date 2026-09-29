#!/usr/bin/env node
// Write each client plugin's manifest, marketplace entry, and MCP config
// from shared/. Skill text is authored in plugin/skills/. Gemini links to
// that directory; Copilot receives a copy because its install directory is separate.
//
//   node scripts/render-plugins.mjs           write the client files
//   node scripts/render-plugins.mjs --check   exit 1 if a client file drifted

import { cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { loadShared, renderCopies, renderFiles, renderLinks } from './platforms.mjs';

const root = resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check');
const rendered = renderFiles(loadShared(root));
const drifted = [];

for (const [rel, value] of rendered) {
  const path = resolve(root, rel);
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (check) {
    let current = '';
    try {
      current = readFileSync(path, 'utf8');
    } catch {
      current = '';
    }
    if (current !== text) drifted.push(rel);
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

for (const [from, to] of renderLinks()) {
  const path = resolve(root, from);
  let current = '';
  try {
    current = lstatSync(path).isSymbolicLink() ? readlinkSync(path) : `not a symlink: ${from}`;
  } catch {
    current = '';
  }
  if (current === to) continue;
  if (check || current) {
    drifted.push(current ? `${from} -> ${current}` : from);
    continue;
  }
  symlinkSync(to, path, 'dir');
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(path, base));
    else if (entry.isFile()) out.push(relative(base, path));
  }
  return out.sort();
}

for (const [from, to] of renderCopies()) {
  const src = resolve(root, from);
  const dest = resolve(root, to);
  const srcFiles = listFiles(src);
  let same = true;
  try {
    const destFiles = listFiles(dest);
    same = srcFiles.length === destFiles.length && srcFiles.every((rel, i) => rel === destFiles[i] && readFileSync(join(src, rel), 'utf8') === readFileSync(join(dest, rel), 'utf8'));
  } catch {
    same = false;
  }
  if (same) continue;
  if (check) {
    drifted.push(`${to} copy of ${from}`);
    continue;
  }
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
}

if (drifted.length) {
  console.error(`plugin files drifted from shared/:\n  ${drifted.join('\n  ')}\nRun: node scripts/render-plugins.mjs`);
  process.exit(1);
}

console.log(check ? 'plugin files match shared/' : `wrote ${rendered.length} plugin files from shared/`);
