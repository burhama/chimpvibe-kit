#!/usr/bin/env node
// Refuse to commit or push anything that looks like a secret. Runs as the pre-commit / pre-push hook and by hand:
//   node scripts/check-secrets.mjs            (scans the working tree)
// A real ChimpVibe token is 43 base64url characters; a registry entry carries a 64-hex tokenHash. Neither belongs here.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SKIP = new Set(['.git', 'node_modules']);
const RULES = [
  { name: 'a bearer token', re: /Bearer\s+[A-Za-z0-9_-]{32,}/ },
  { name: 'a token hash', re: /"tokenHash"\s*:\s*"[0-9a-f]{64}"/ },
  { name: 'an invite registry', re: /"viewers"\s*:\s*\[\s*\{/ },
  { name: 'a private key', re: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/ },
  { name: 'an operator key', re: /CHIMPVIBE_OPERATOR_KEY\s*=\s*\S{16,}/ },
  { name: 'a raw 43-char token on its own line', re: /^[A-Za-z0-9_-]{43}$/m },
];
const ALLOW = /\$\{user_config\.token\}|<your token>|<token>|<TOKEN>/;

const hits = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) { walk(p); continue; }
    if (statSync(p).size > 2 * 1024 * 1024) continue;
    const text = readFileSync(p, 'utf8');
    for (const rule of RULES) {
      const m = rule.re.exec(text);
      if (m && !ALLOW.test(m[0])) hits.push(`${relative(ROOT, p)}: ${rule.name}`);
    }
  }
}
walk(ROOT);
if (hits.length) { console.error(`REFUSED — the tree carries what looks like ${hits.length} secret(s):\n  ${hits.join('\n  ')}`); process.exit(1); }
console.log('clean: no secret-shaped content in the tree');
