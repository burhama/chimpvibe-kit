#!/usr/bin/env node
// The ONE server's source lives in the ChimpVibe repo (site/mcp.mjs) and is deployed from there; this repo publishes a
// verbatim copy so anyone can read exactly what chimpvibe.dev/mcp runs. Keep the two equal:
//   node scripts/sync-server.mjs            copies ChimpVibe/site/mcp.mjs → server/mcp.mjs
//   node scripts/sync-server.mjs --check    exits 1 when the two differ (the estate's regression sweep runs this)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const HERE = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SOURCE = process.env.CHIMPVIBE_SITE_MCP || resolve(HERE, '..', 'ChimpVibe', 'site', 'mcp.mjs');
const TARGET = resolve(HERE, 'server', 'mcp.mjs');
if (!existsSync(SOURCE)) { console.error(`source not found: ${SOURCE} (set CHIMPVIBE_SITE_MCP)`); process.exit(2); }
const source = readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n');
const target = existsSync(TARGET) ? readFileSync(TARGET, 'utf8').replace(/\r\n/g, '\n') : null;
if (process.argv.includes('--check')) {
  if (target === source) { console.log('server/mcp.mjs equals ChimpVibe/site/mcp.mjs'); process.exit(0); }
  console.error('server/mcp.mjs differs from ChimpVibe/site/mcp.mjs — run node scripts/sync-server.mjs'); process.exit(1);
}
mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, source);
console.log(`server/mcp.mjs ← ${SOURCE} (${source.length} bytes)`);
