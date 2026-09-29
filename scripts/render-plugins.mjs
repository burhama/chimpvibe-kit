#!/usr/bin/env node
// Write each client plugin's manifest, marketplace entry, and MCP config
// from shared/. Skills are not copied; they already live in plugin/skills/.
//
//   node scripts/render-plugins.mjs           write the client files
//   node scripts/render-plugins.mjs --check   exit 1 if a client file drifted

import { lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadShared, renderFiles, renderLinks } from './platforms.mjs';

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

if (drifted.length) {
  console.error(`plugin files drifted from shared/:\n  ${drifted.join('\n  ')}\nRun: node scripts/render-plugins.mjs`);
  process.exit(1);
}

console.log(check ? 'plugin files match shared/' : `wrote ${rendered.length} plugin files from shared/`);
