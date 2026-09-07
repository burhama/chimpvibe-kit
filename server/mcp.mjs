// site/mcp.mjs — the ChimpVibe MCP server (BEV-4 P4, AUDIT-P4 §(a)(b)). Zero-dep JSON-RPC 2.0 over Streamable HTTP
// with plain JSON responses. Mounted at POST /mcp by site/server.mjs. Bearer token → sha-256 → the member registry on
// the data volume (hashes only; the app mints the tokens). Never logs a token.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MEMBER_ID = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const SHA = /^[0-9a-f]{40}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,30}$/;
// BEV-10 — THE TAG: `chimpvibe:<slug>#<n>`, one copyable name per accepted node (the site's cards show it; a member
// pastes it to their AI; chimpvibe_resolve turns it back into the exact node + host + install recipe). A tag is a NAME,
// never a sha. Mirrors shared/tag.mjs (kept inline here so the kit's verbatim copy of this file stands alone).
const TAG_RE = /\bchimpvibe:([a-z0-9][a-z0-9-]{1,30})#(\d{1,6})\b/i;
const tagOfRef = (ref) => { const m = /^([a-z0-9][a-z0-9-]{1,30})#(\d{1,6})$/i.exec(String(ref || '').trim()); return m && !/^slot-/i.test(m[1]) ? `chimpvibe:${m[1].toLowerCase()}#${Number(m[2])}` : null; };
const parseTag = (text) => { const m = TAG_RE.exec(String(text || '')); if (!m || /^slot-/i.test(m[1])) return null; const slug = m[1].toLowerCase(); const n = Number(m[2]); return { tag: `chimpvibe:${slug}#${n}`, slug, n, ref: `${slug}#${n}` }; };
// The door the pasted message names (the same words the kit's tag skill reads): install · ask · modify · null (= show the menu)
export const doorOf = (text) => {
  const t = String(text || '').toLowerCase();
  if (/\b(install|run it|run this|run locally|play locally|set (it )?up|start it|spin (it )?up|host it locally)\b/.test(t)) return 'install';
  if (/\b(modify|change|add|fix|fork|patch|make it|branch|improve|tweak|implement|remove)\b/.test(t)) return 'modify';
  if (/\b(ask|what|how|why|explain|which file|tell me|describe|where)\b/.test(t) || /\?/.test(t)) return 'ask';
  return null;
};
export const TAG_MENU = 'Offer exactly three choices, in these words, and wait for ONE: 1. Install <game> — run this exact node on the user\'s machine (fetch artifact.zip, verify sha256, unzip, npm install, PORT=<free port> node server/server.js, open the url; no Docker, no git). 2. Ask about <game> — answer from the node\'s own code and this record, never invent. 3. Modify <game> — the contribute wizard, already pinned to host.sessionId + host.baseRef (the begin call is actions.modify.call with actions.modify.args verbatim), then patch → validate → submit → STOP. If you have the ChimpVibe skill, /chimpvibe:tag does all three.';
const ART_LIMIT = 2 * 1024 * 1024;
const PENDING_LIMIT = 20;

const err = (code, message) => ({ code, message });
const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (message) => ({ content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message }) }], isError: true });
const str = (v, max, name) => { if (typeof v !== 'string') throw new Error(`${name} must be a string`); const s = v.trim(); if (!s || s.length > max) throw new Error(`${name} must be 1–${max} characters`); return s; };
// BEV-9 (#4.1): a public https URL — no credentials in it, no loopback / private / link-local host (nothing fetches these
// URLs today; the day DEPLOY captures a screenshot of `host`, this is what keeps it off the box's own network).
const PRIVATE_HOST = /^(localhost|.*\.(localhost|local|internal))$/i;
const PRIVATE_IPV4 = /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const PRIVATE_IPV6 = /^\[(::1?|fe[89ab][0-9a-f]:.*|f[cd][0-9a-f]{2}:.*|::ffff:.*)\]$/i;
const isPrivateHost = (h) => PRIVATE_HOST.test(h) || PRIVATE_IPV4.test(h) || PRIVATE_IPV6.test(h);
const httpsUrl = (v, name) => { const s = str(v, 200, name); let u; try { u = new URL(s); } catch { throw new Error(`${name} must be a URL`); } if (u.protocol !== 'https:' || !u.hostname.includes('.')) throw new Error(`${name} must be an https URL with a real host`); if (u.username || u.password) throw new Error(`${name} must not carry credentials`); if (isPrivateHost(u.hostname)) throw new Error(`${name} must be a public host`); return u.toString(); };

// BEV-6: what a member's AI does next for each refusal a game can raise — appended as `remedy` to every forwarded error,
// and the source of the skill's ERROR → REMEDY table (plugin/skills/contribute/SKILL.md).
export const REMEDIES = {
  SESSION_NOT_FOUND: 'copy args.sessionId verbatim from chimpvibe_fork_from — never invent one, never omit one it gave you (each game has its own session)',
  REVISION_ID_REUSED: 'your revision file still carries the running revision id: change its id: line to a NEW kebab-case id, then validate again',
  CONTRACT_INVALID: 'a contract field is invalid (a presentation label must be 1–40 characters; a death cause a lowercase token): fix the named field, then validate again',
  SOURCE_POLICY_VIOLATION: 'only files under game/ with .js .json .md, no network, no eval, no imports outside game/: undo the violation, then validate again',
  SOURCE_LIMIT_EXCEEDED: 'the workspace is over a size limit (files / bytes): trim it, then validate again',
  CANDIDATE_EXECUTION_FAILED: 'the game crashed in its smoke run: read the message, fix the code, validate again',
  VALIDATOR_FAILED: 'the validator refused the build: read the message, fix, validate again',
  CANDIDATE_CONTRACT_UNSUPPORTED: 'use runtimeVersion 1 or 2 and clientVersion 1–3 in the manifest',
  VALIDATION_STALE: 'you patched after validating: run snake_evolve_validate again, then submit',
  WORKSPACE_LIMIT_EXCEEDED: 'you hold 3 open workspaces (or 100 patches in one): submit one, or let it expire (1 h idle), then begin again',
  PROPOSAL_QUOTA_EXCEEDED: 'the retained-proposal quota is full: ask the owner to clear old ones',
  PROPOSAL_NOT_FOUND: 'no such workspace for your token: begin a new one (snake_evolve_begin_proposal)',
  PROPOSAL_STATE_INVALID: 'this workspace is past that step (already submitted?): begin a new one for a new change',
  PROPOSAL_BASE_MISMATCH: 'the head moved while you worked — that is fine: keep going; the owner\'s deploy replays your change onto the head',
  BASE_REF_INVALID: 'baseRef must be the 40-hex commit chimpvibe_fork_from gave you — copy its args verbatim',
  BASE_REF_UNKNOWN: 'that node is not on the live lineage: pick a ref from chimpvibe_tree and call chimpvibe_fork_from again',
  PATCH_MATCH_NOT_FOUND: 'the match text must occur exactly once in the file: read the file (snake_evolve_read_source) and copy the exact text',
  PATCH_MATCH_AMBIGUOUS: 'the match text occurs more than once: include more surrounding lines so it is unique',
  BRANCH_NOT_ACTIVE: 'begin from the active branch: omit branchId',
  UNAUTHORIZED: 'your token was refused by the game: ask the owner for a fresh kit (PATCH)',
  INTERNAL_ERROR: 'the game server hit an internal error: wait a minute and try the same call once more; if it repeats, tell the owner',
};

const GAME_TIMEOUT_MS = 120_000;
// BEV-9 (#3.2): whoami's per-call budgets and its overall deadline (a healthy host answers each call in well under 1 s)
const WHOAMI_INIT_MS = 4_000, WHOAMI_TOOLS_MS = 4_000, WHOAMI_SESSION_MS = 6_000, WHOAMI_TOTAL_MS = 8_000;
// BEV-8: `auth` is the member's own bearer (a string) or, when this server holds the proxy credential, an object
// { authorization: 'Bearer <proxy>', viewerHeaders: { 'x-evolve-viewer-id', 'x-evolve-viewer-name' } } — the host trusts the
// site's word for who the member is, so a self-served member needs no token on any game registry.
const authHeaders = (auth) => (typeof auth === 'string' ? { authorization: auth } : { authorization: auth.authorization, ...(auth.viewerHeaders || {}) });
const GAME_REPLY_LIMIT = 2 * 1024 * 1024; // BEV-9 (#3.4): a game host's reply is read up to this many bytes, then refused
async function readCapped(r, limit) {
  const declared = Number(r.headers.get('content-length') || 0);
  if (declared > limit) { try { await r.body?.cancel(); } catch {} throw new Error(`reply over ${limit} bytes`); }
  const chunks = []; let size = 0;
  for await (const chunk of r.body || []) { size += chunk.length; if (size > limit) { try { await r.body.cancel(); } catch {} throw new Error(`reply over ${limit} bytes`); } chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}
async function postRpc(url, auth, message, timeoutMs = GAME_TIMEOUT_MS) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...authHeaders(auth) }, body: JSON.stringify(message), signal: AbortSignal.timeout(timeoutMs) });
  const text = await readCapped(r, GAME_REPLY_LIMIT);
  if (r.status === 401 || r.status === 403) return { status: r.status, message: null };
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  let parsed = null;
  try { parsed = JSON.parse(line ? line.slice(5) : text); } catch { parsed = null; }
  return { status: r.status, message: parsed };
}

// BEV-7 P2: a node's diff score as the tree document carries it — { added, removed } or null (never a guess)
// The approval system, in the words every AI reads right after it submits: a submission is the END of the AI's job. The
// owner alone reviews and deploys (ONE press in his app); nothing is public before that. Other AIs kept trying to publish
// or host the work after submitting — this sentence, on every submit reply, is what stops them.
export const SUBMITTED_NEXT = 'Submission complete — there is nothing more for you to do. The owner reviews it and presses DEPLOY in his app; until then it is pending and not public. Do NOT publish, host, deploy, build a page, push anywhere, open a PR or ask where to host it — the owner does all of that. Tell your user, in these words: "Submission complete, there\'s no more for me to do."';
const diffOf = (node) => (node?.diff && Number.isInteger(node.diff.added) && Number.isInteger(node.diff.removed) ? { added: node.diff.added, removed: node.diff.removed } : null);

export function createMcp({ dataRoot, catalogNow, readTree, guideText, version = '1.0', gameMcpUrl = (p) => p.fork?.mcp || null }) {
  // the games this server fronts: every catalog project with a fork route that names an MCP url
  const games = () => catalogNow().filter((p) => p.fork && gameMcpUrl(p)).map((p) => ({ slug: p.slug, server: p.fork.server, url: gameMcpUrl(p), name: p.name || p.slug, sessionId: p.fork.sessionId || null }));
  const gameToolCache = new Map(); // url → { at, tools }
  // BEV-7 P6: several games serve the SAME tool names (one Snake Evolve host per game). A forwarded call goes to the game
  // its arguments name: `sessionId` (chimpvibe_fork_from puts the game's session id in the begin call) → that game;
  // `proposalId` → the game that answered for that proposal before (remembered here from every reply); otherwise every
  // game that has the tool is asked in catalog order and a PROPOSAL_NOT_FOUND moves on to the next. One game = as before.
  const proposalHome = new Map(); // proposalId → game url (BEV-9 #3.1: capped — the oldest entry goes when it is full)
  const PROPOSAL_HOME_LIMIT = 5000;
  const PROPOSAL_ID = /proposal-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
  const remember = (game, result) => { try { for (const item of result?.content || []) if (item?.type === 'text') for (const m of String(item.text).match(PROPOSAL_ID) || []) { proposalHome.delete(m); proposalHome.set(m, game.url); while (proposalHome.size > PROPOSAL_HOME_LIMIT) proposalHome.delete(proposalHome.keys().next().value); } } catch {} };
  const errorCodeOf = (result) => { try { const body = JSON.parse(result?.content?.[0]?.text || ''); return body?.error?.code || body?.code || null; } catch { return null; } };
  async function gameTools(game, authorization, timeoutMs = 15_000) {
    const cached = gameToolCache.get(game.url);
    if (cached && Date.now() - cached.at < 60_000) return cached.tools;
    try {
      const { status, message } = await postRpc(game.url, authorization, { jsonrpc: '2.0', id: 'tools', method: 'tools/list' }, timeoutMs);
      const tools = status === 200 && Array.isArray(message?.result?.tools) ? message.result.tools : null;
      if (tools) { gameToolCache.set(game.url, { at: Date.now(), tools }); return tools; }
      return cached?.tools || [];
    } catch { return cached?.tools || []; }
  }
  // after a successful snake_evolve_submit_proposal the game's reply gains `done: true` + `next` = SUBMITTED_NEXT
  const withDone = (name, result) => {
    if (name !== 'snake_evolve_submit_proposal' || result?.isError) return result;
    try {
      const item = result?.content?.[0];
      if (!item || item.type !== 'text') return result;
      const body = JSON.parse(item.text);
      if (!body || typeof body !== 'object' || body.ok === false || body.error) return result;
      return { ...result, content: [{ type: 'text', text: JSON.stringify({ ...body, done: true, next: SUBMITTED_NEXT }, null, 2) }, ...result.content.slice(1)] };
    } catch { return result; }
  };
  const withRemedy = (result) => {
    // a game's error envelope is JSON text {ok:false, error:{code,message}} (or {code,message}); add what to do next
    try {
      const item = result?.content?.[0];
      if (!item || item.type !== 'text') return result;
      const body = JSON.parse(item.text);
      const code = body?.error?.code || body?.code;
      if (!code || !REMEDIES[code]) return result;
      const next = { ...body, remedy: REMEDIES[code] };
      return { ...result, content: [{ type: 'text', text: JSON.stringify(next, null, 2) }, ...result.content.slice(1)] };
    } catch { return result; }
  };
  const registryFile = resolve(dataRoot, 'invites.json');
  const submissionsDir = resolve(dataRoot, 'submissions');

  function members() {
    try {
      const doc = JSON.parse(readFileSync(registryFile, 'utf8'));
      if (doc?.version !== 1 || !Array.isArray(doc.members)) return [];
      return doc.members.filter((m) => m && MEMBER_ID.test(String(m.id)) && /^[0-9a-f]{64}$/.test(String(m.tokenHash)));
    } catch { return []; }
  }

  function identify(req) {
    const header = String(req.headers.authorization || '');
    if (!header.startsWith('Bearer ')) return null;
    const token = header.slice(7).trim();
    if (token.length < 8 || token.length > 256) return null;
    const hash = createHash('sha256').update(token).digest('hex');
    const member = members().find((m) => m.tokenHash === hash);
    if (!member || member.enabled === false) return null;
    const name = String(member.name || member.id).slice(0, 80);
    const proxy = String(process.env.CHIMPVIBE_PROXY_TOKEN || '');
    const authorization = proxy.length >= 32 ? { authorization: `Bearer ${proxy}`, viewerHeaders: { 'x-evolve-viewer-id': member.id, 'x-evolve-viewer-name': name } } : header;
    return { id: member.id, name, authorization, self: member.self === true };
  }

  function submissions() {
    if (!existsSync(submissionsDir)) return [];
    return readdirSync(submissionsDir).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(readFileSync(resolve(submissionsDir, f), 'utf8')); } catch { return null; } }).filter(Boolean);
  }

  const tools = [
    { name: 'chimpvibe_whoami', description: 'Call this FIRST. Who you are on ChimpVibe, which games this one token opens (each checked live), how many tools each game offers, your open workspaces and submissions, and the next call to make.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'chimpvibe_guide', description: 'What ChimpVibe is, how its trees work, and exactly how to contribute a fork or a new game. Read this first.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'chimpvibe_games', description: 'Every project slot on chimpvibe.dev: slug, name, status, host, and how many nodes its public tree has.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'chimpvibe_tree', description: 'The public tree of one project, newest first: every approved node with its identifier (ref, e.g. ssnake#9), id, parent, branch, author, title, blurb, diff (lines {added, removed} vs its parent), download, and which one the game runs (running). Pick a ref here before you fork.', inputSchema: { type: 'object', properties: { slug: { type: 'string', description: 'project slug, e.g. ssnake' } }, required: ['slug'], additionalProperties: false } },
    { name: 'chimpvibe_resolve', description: 'A member pasted a TAG like "chimpvibe:ssnake#9" (a node\'s copyable name from a card on chimpvibe.dev): call this FIRST with the text that holds it. Returns the exact game + node + host session + base commit + the node\'s zip (url, bytes, sha256) + three ready actions — install (run it locally), ask (answer from its code), modify (the pinned begin call). Then offer exactly those three choices and wait for one.', inputSchema: { type: 'object', properties: { tag: { type: 'string', description: 'the user\'s WHOLE message, verbatim — the tag plus what they want with it (e.g. "install chimpvibe:ssnake#9", "what does chimpvibe:ssnake#9 change?"); the server finds the tag and the door inside it' }, door: { type: 'string', enum: ['install', 'ask', 'modify'], description: 'optional — the door when you already know it; otherwise the server reads it from the message (none → the three-way menu)' } }, required: ['tag'], additionalProperties: false } },
    { name: 'chimpvibe_fork_from', description: 'Fork a project from one node: give its ref (e.g. "ssnake#9", from chimpvibe_tree) and get back the EXACT snake_evolve_begin_proposal call to make next — copy its args verbatim (baseRef is that node\'s commit).', inputSchema: { type: 'object', properties: { slug: { type: 'string' }, ref: { type: 'string', description: 'node identifier from chimpvibe_tree, e.g. ssnake#9' }, node: { type: 'string', description: 'alternatively the 40-hex node id' } }, required: ['slug'], additionalProperties: false } },
    { name: 'chimpvibe_submit_game', description: 'Submit a NEW game to ChimpVibe (pending until the owner deploys it). Needs a title, a short blurb, and a reachable https host where the game is playable; optionally a repo URL and a PNG capture (base64, ≤ 2 MB, 16:9 looks best).', inputSchema: { type: 'object', properties: { title: { type: 'string', maxLength: 80 }, blurb: { type: 'string', maxLength: 400 }, host: { type: 'string', description: 'https URL of the playable game' }, repo: { type: 'string', description: 'optional https URL of the source' }, art_png_base64: { type: 'string', description: 'optional PNG capture, base64' } }, required: ['title', 'blurb', 'host'], additionalProperties: false } },
    { name: 'chimpvibe_my_submissions', description: 'Your own game submissions and their state (pending · deployed · rejected).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  ];

  // BEV-10: tag → the whole record an AI needs for Install / Ask / Modify. `who` may be null (the site's public
  // GET /api/tag/<tag> door — the tree is public; a member-less caller is pointed at /join for Modify).
  function resolveTag(text, who, forcedDoor = null) {
    const parsed = parseTag(text);
    if (!parsed) return { ok: false, error: 'no tag found — a tag looks like chimpvibe:<slug>#<n> (e.g. chimpvibe:ssnake#9); copy it from a node\'s card on chimpvibe.dev' };
    const { tag, slug, ref } = parsed;
    const project = catalogNow().find((p) => p.slug === slug);
    if (!project) return { ok: false, tag, error: `unknown game "${slug}" — chimpvibe_games lists every slug` };
    const tree = readTree(slug);
    const found = tree.nodes.find((n) => n.ref === ref);
    if (!found) return { ok: false, tag, error: `no node ${ref} on the public tree of ${project.name || slug} — valid tags: ${tree.nodes.map((n) => tagOfRef(n.ref)).filter(Boolean).join(', ') || 'none yet'}` };
    const running = tree.running || null;
    const head = tree.nodes.find((n) => running && n.id === running) || null;
    const parent = found.parent ? tree.nodes.find((n) => n.id === found.parent) || null : null;
    const zipPath = typeof found.download === 'string' && found.download.startsWith('/') && !found.download.startsWith('//') ? found.download : null;
    let artifact = null;
    if (zipPath) {
      const m = /^\/([a-z0-9][a-z0-9-]{1,30})\/node\/([0-9a-f]{40})\.zip$/.exec(zipPath);
      const file = m ? resolve(dataRoot, 'nodes', m[1], `${m[2]}.zip`) : null;
      if (file && existsSync(file)) { const bytes = readFileSync(file); artifact = { zip: `https://chimpvibe.dev${zipPath}`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), layout: 'a git archive of the node: game/ (the member-editable part) + server/ + client/ (the engine); package.json at the root' }; }
      else artifact = { zip: `https://chimpvibe.dev${zipPath}`, bytes: null, sha256: null, layout: 'a git archive of the node' };
    }
    const sessionId = project.fork?.sessionId || null;
    const name = project.name || slug;
    const play = `https://chimpvibe.dev/${slug}`;
    const game = { slug, name, blurb: project.blurb || null, status: project.status, play, tree: `https://chimpvibe.dev/${slug}/tree`, host: project.host || null };
    const node = { ref, id: found.id, parent: found.parent || null, parentRef: parent?.ref || null, title: found.label, blurb: found.blurb || found.label, author: found.author, at: found.at, branch: found.branch, diff: diffOf(found), running: Boolean(running && found.id === running), head: head?.ref || null };
    const install = artifact
      ? { title: `Install ${name} (${ref})`, recipe: [`fetch ${artifact.zip} and verify sha256 = ${artifact.sha256 || '<see artifact.sha256>'}`, `unzip into ./chimpvibe/${slug}-${parsed.n}/`, 'npm install --no-audit --no-fund', 'pick a free port; PORT=<port> BOTS=1 node server/server.js — started detached, no Docker, no git, no MCP token needed (do not print the operator token the log shows)', 'poll http://127.0.0.1:<port>/healthz until 200 (≤ 20 s), then tell the user the url http://127.0.0.1:<port>/ and stop'] }
      : { title: `Install ${name}`, recipe: [`this game lives on its own host — open ${game.host || play} in the browser; there is nothing to install`] };
    const ask = { title: `Ask about ${name} (${ref})`, how: artifact ? 'answer from the unpacked node (fetch + unzip it if not installed yet): game/ holds the game itself, server/ + client/ the engine; cite files; never invent' : 'answer from this record and the game\'s own page; never invent' };
    const modify = project.fork
      ? { title: `Modify ${name} (${ref})`, server: project.fork.server, call: project.fork.tool, mcp: gameMcpUrl(project), args: { ...(sessionId ? { sessionId } : {}), baseRef: found.id, intent: '<A short title for your change (one sentence, ≤ 80 characters). Then explain the change plainly.>' }, then: 'list/read/search_source → apply_patch (new revision id first) → validate until "validated" → submit_proposal (each with the proposalId the begin call returns) — then STOP: the owner alone deploys', ...(who ? {} : { needs: 'a member token — mint one at https://chimpvibe.dev/join, then add the kit' }) }
      : { title: `Modify ${name}`, note: `${name} has no fork route — it lives on its own host; ask its author` };
    const door = ['install', 'ask', 'modify'].includes(forcedDoor) ? forcedDoor : doorOf(text);
    const gate = `✔ tag: ${tag} = ${name} node ${ref} "${node.title}" by ${node.author}${node.running ? ' · running now' : node.head ? ` · the game runs ${node.head}` : ''}`;
    const menu = `1. Install ${name} (${ref}) — run this exact build on your machine\n2. Ask about ${name} (${ref}) — what this node is, how it works, what it changed\n3. Modify ${name} (${ref}) — start your own branch from here (the contribute wizard)\nWhich one?`;
    const dir = `./chimpvibe/${slug}-${parsed.n}/`;
    const NEXT = {
      menu: `The user named no door. Reply with EXACTLY these lines and nothing else — first the gate line "${gate}", then the four menu lines in \`menu\` verbatim — and STOP: end your turn and wait for the user's choice. Do not describe the game, do not fetch anything, do not open a door on your own.`,
      install: artifact
        ? `The user asked to INSTALL. Do it now, headlessly, with your shell tool — no menu, no questions: (1) mkdir -p ${dir} (skip to 4 if it already holds package.json); (2) curl -sL -o node.zip "${artifact.zip}" there and verify its SHA-256 equals ${artifact.sha256} (sha256sum / shasum -a 256 / certutil -hashfile node.zip SHA256 / node crypto) — on a mismatch delete it, tell the user, STOP; (3) tar -xf node.zip (or unzip -q), then delete node.zip; (4) npm install --no-audit --no-fund (Node >= 22.13); (5) pick a free port (3000, else random 3001–3999) and start the server DETACHED so it outlives your turn — PORT=<port> BOTS=1 node server/server.js in the background (run_in_background / nohup … & / Start-Process) — and write its pid to .chimpvibe.pid in that directory; (6) poll http://127.0.0.1:<port>/healthz once a second up to 20 s until 200; (7) reply with the gate line "${gate}" then exactly: ✔ installed: ${name} ${ref} → http://127.0.0.1:<port>/  (stop it: kill the pid in ${dir}.chimpvibe.pid). Never print the operator token the server logs. No Docker, no git, no token, nothing to publish or deploy — then stop.`
        : `The user asked to INSTALL, but ${name} lives on its own host — there is nothing to install: reply with the gate line "${gate}" and tell them to open ${game.host || play}; stop.`,
      ask: artifact
        ? `The user is ASKING about this node. Answer from its own code, never from memory: (1) if ${dir} does not exist yet, mkdir -p it, curl -sL -o node.zip "${artifact.zip}", verify sha256 = ${artifact.sha256}, tar -xf node.zip, delete node.zip (no npm install needed); (2) read what the question needs — game/ first (game/create-snake-game.js, game/revisions/*.js), README.md, then server/ + client/ for the engine — with your Read/Grep tools on those files; (3) answer plainly, citing files as path:line, and begin your reply with the gate line "${gate}"; end with: ✔ asked: ${name} ${ref} — answered from <n> files. Do not begin a proposal; do not use snake_evolve_* source tools for this (they need an open workspace).`
        : `The user is ASKING about ${name}, which lives on its own host (no archive): answer from this record and the game's page ${game.host || play}, begin with the gate line "${gate}", never invent.`,
      modify: project.fork
        ? `The user wants to MODIFY this node. Begin your reply with the gate line "${gate}". Then the contribute wizard, ALREADY PINNED to this node — if you have the ChimpVibe skill, invoke /chimpvibe:contribute with the argument line: PINNED tag=${tag} slug=${slug} ref=${ref} title="${String(node.title).replace(/"/g, "'")}" author="${node.author}" sessionId=${sessionId || '-'} baseRef=${found.id} then: <the user's change in their words>. Without the skill: call chimpvibe_whoami {} (a 401 means no token: mint one at https://chimpvibe.dev/join), then ${project.fork.tool} with EXACTLY actions.modify.args (sessionId + baseRef verbatim, your intent = one title sentence <= 80 chars then the change), then list/read/search_source → apply_patch (a NEW revision id first; only game/ files; no network) → validate until "validated" → submit_proposal (each with the proposalId the begin call returned). After submit your job is OVER: the owner alone deploys; never publish, host, deploy, push or open a PR — tell the user "Submission complete, there's no more for me to do." and stop.`
        : `The user wants to MODIFY ${name}, which has no fork route (it lives on its own host): say it cannot be modified through ChimpVibe, name its author (${project.author || 'unknown'}), stop.`,
    };
    return { ok: true, tag, slug, ref, door: door || 'menu', gate, menu, game, node, host: project.fork ? { sessionId, mcp: gameMcpUrl(project), server: project.fork.server, call: project.fork.tool, baseRef: found.id } : null, artifact, actions: { install, ask, modify }, member: who ? { id: who.id, name: who.name } : null, ...(who ? {} : { join: 'https://chimpvibe.dev/join' }), next: NEXT[door || 'menu'] };
  }

  async function call(name, args, who) {
    const a = args && typeof args === 'object' ? args : {};
    switch (name) {
      case 'chimpvibe_whoami': {
        // BEV-9 (#3.2): whoami is a member's FIRST call and some clients give a tool 5 s — every host is asked in parallel
        // with short per-call budgets, and ONE overall deadline answers for any host still silent (reachable:false).
        const list = games();
        const probe = async (g) => {
          let tokenWorks = false, tools = 0, workspaces = null, reachable = true;
          try {
            const init = await postRpc(g.url, who.authorization, { jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'chimpvibe', version } } }, WHOAMI_INIT_MS);
            tokenWorks = init.status === 200;
            if (tokenWorks) {
              tools = (await gameTools(g, who.authorization, WHOAMI_TOOLS_MS)).length;
              const session = await postRpc(g.url, who.authorization, { jsonrpc: '2.0', id: 'ws', method: 'tools/call', params: { name: 'snake_evolve_session', arguments: {} } }, WHOAMI_SESSION_MS);
              try { const body = JSON.parse(session.message?.result?.content?.[0]?.text || '{}'); workspaces = Array.isArray(body.result?.workspaces) ? body.result.workspaces.map((w) => ({ id: w.id, status: w.status, intent: String(w.intent || '').slice(0, 80) })) : null; } catch { workspaces = null; }
            }
          } catch { tokenWorks = false; reachable = false; }
          return { slug: g.slug, name: g.name, server: g.server, url: g.url, reachable, tokenWorks, tools, workspaces, remedy: tokenWorks ? null : reachable ? 'this token is not on the game\'s registry: ask the owner for a fresh kit (PATCH)' : 'the game host did not answer in time: try again in a minute; if it repeats, tell the owner' };
        };
        const silent = (g) => ({ slug: g.slug, name: g.name, server: g.server, url: g.url, reachable: false, tokenWorks: false, tools: 0, workspaces: null, remedy: 'the game host did not answer in time: try again in a minute; if it repeats, tell the owner' });
        const results = list.map((g) => probe(g).catch(() => silent(g)));
        const settled = new Array(list.length).fill(null);
        results.forEach((p, i) => p.then((v) => { settled[i] = v; }));
        await Promise.race([Promise.all(results), new Promise((r) => setTimeout(r, WHOAMI_TOTAL_MS).unref?.())]);
        const checked = list.map((g, i) => settled[i] || silent(g));
        const mine = submissions().filter((s) => s.memberId === who.id);
        return text({ member: { id: who.id, name: who.name }, games: checked, submissions: { pending: mine.filter((s) => s.status === 'pending').length, deployed: mine.filter((s) => s.status === 'deployed').length }, next: 'have a tag (chimpvibe:<slug>#<n>)? → chimpvibe_resolve {tag}. Otherwise chimpvibe_games → chimpvibe_tree {slug} → chimpvibe_fork_from {slug, ref} → the begin call it returns (snake_evolve_begin_proposal is served by this same server)' });
      }
      case 'chimpvibe_guide': return text(guideText());
      case 'chimpvibe_games': {
        const projects = catalogNow();
        return text(projects.map((p) => {
          const tree = p.status === 'live' ? readTree(p.slug) : null;
          return { slug: p.slug, name: p.name || null, status: p.status, host: p.host || null, author: p.author || null, blurb: p.blurb || null, nodes: tree ? tree.nodes.length : 0, tree: p.status === 'live' ? `https://chimpvibe.dev/${p.slug}/tree` : null, forkable: Boolean(p.fork) };
        }));
      }
      case 'chimpvibe_tree': {
        const slug = str(a.slug, 31, 'slug').toLowerCase();
        if (!SLUG.test(slug) || !catalogNow().some((p) => p.slug === slug)) return fail(`unknown project: ${slug}`);
        const tree = readTree(slug);
        const running = tree.running || null;
        // BEV-7 P2: diff = { added, removed } lines vs the parent (the root: its own size); null when the node was not scored
        const nodes = tree.nodes.map((n) => ({ ref: n.ref || null, tag: tagOfRef(n.ref), id: n.id, parent: n.parent, branch: n.branch, author: n.author, title: n.label, blurb: n.blurb || n.label, at: n.at, diff: diffOf(n), running: Boolean(running && n.id === running), download: typeof n.download === 'string' && n.download.startsWith('/') && !n.download.startsWith('//') ? `https://chimpvibe.dev${n.download}` : null }));
        nodes.sort((x, y) => String(y.at || '').localeCompare(String(x.at || '')));
        return text({ slug, root: tree.root, head: nodes.find((n) => n.running)?.ref || null, nodes, how: 'fork one of these: chimpvibe_fork_from {"slug":"' + slug + '","ref":"<ref>"}' });
      }
      case 'chimpvibe_resolve': {
        const r = resolveTag(str(a.tag, 4000, 'tag'), who, typeof a.door === 'string' ? a.door : null);
        return r.ok ? text(r) : fail(r.error);
      }
      case 'chimpvibe_fork_from': {
        const slug = str(a.slug, 31, 'slug').toLowerCase();
        const project = catalogNow().find((p) => p.slug === slug);
        if (!project) return fail(`unknown project: ${slug}`);
        const tree = readTree(slug);
        let found = null;
        if (a.ref !== undefined && a.ref !== null && a.ref !== '') {
          const ref = str(a.ref, 48, 'ref').toLowerCase().replace(/\s+/g, '');
          const m = /^([a-z0-9][a-z0-9-]{1,30})#(\d{1,5})$/.exec(ref);
          if (!m) return fail('ref must look like ' + slug + '#<n> (see chimpvibe_tree)');
          if (m[1] !== slug) return fail(`that ref belongs to "${m[1]}", not "${slug}"`);
          found = tree.nodes.find((n) => n.ref === `${slug}#${Number(m[2])}`);
          if (!found) return fail(`no node ${slug}#${Number(m[2])} on the public tree — valid refs: ${tree.nodes.map((n) => n.ref).filter(Boolean).join(', ') || 'none yet'}`);
        } else {
          const node = str(a.node, 40, 'node').toLowerCase();
          if (!SHA.test(node)) return fail('give a ref (e.g. ' + slug + '#3) or the 40-hex id of a node from chimpvibe_tree');
          found = tree.nodes.find((n) => n.id === node);
          if (!found) return fail('that node is not on the public tree (only approved nodes can be forked)');
        }
        if (!project.fork) return fail(`${project.name || slug} has no fork route yet — only games with their own MCP server can be forked`);
        // BEV-7 P6: the begin call names the game's session (sessionId) so the ONE server forwards it to THAT game's host
        const sessionId = project.fork.sessionId || null;
        const sessionArg = sessionId ? `"sessionId":"${sessionId}",` : '';
        return text({
          server: project.fork.server, call: project.fork.tool,
          mcp: gameMcpUrl(project), sessionId,
          args: { ...(sessionId ? { sessionId } : {}), baseRef: found.id, intent: '<A short title for your change (one sentence, ≤ 80 characters). Then explain the change plainly.>' },
          base: { ref: found.ref || null, tag: tagOfRef(found.ref), id: found.id, branch: found.branch, title: found.label, author: found.author, diff: diffOf(found) },
          note: `Next call, verbatim: ${project.fork.tool} {${sessionArg}"baseRef":"${found.id}","intent":"<title sentence. Then the change.>"} — your workspace starts as node ${found.ref || found.id.slice(0, 8)} ("${found.label}" by ${found.author}) on ${project.name || slug}; when the owner deploys, your change is replayed onto whatever is live by then. The first sentence of your intent becomes the public title; the whole intent is the card's blurb. Then: list/read/search_source → apply_patch (new revision id first) → validate until "validated" → submit_proposal (each with the proposalId the begin call returns — the server routes it to the same game). After submit_proposal your job is over: the owner alone deploys — do not publish, host or deploy anything yourself.`,
        });
      }
      case 'chimpvibe_submit_game': {
        const title = str(a.title, 80, 'title');
        const blurb = str(a.blurb, 400, 'blurb');
        const host = httpsUrl(a.host, 'host');
        const repo = a.repo === undefined || a.repo === null || a.repo === '' ? null : httpsUrl(a.repo, 'repo');
        const mine = submissions().filter((s) => s.memberId === who.id);
        if (mine.filter((s) => s.status === 'pending').length >= PENDING_LIMIT) return fail(`you already have ${PENDING_LIMIT} pending submissions`);
        // BEV-9 (#4.3): a title is unique per member — one member cannot reserve a title for everyone (the app shows title + author)
        if (mine.some((s) => s.title.toLowerCase() === title.toLowerCase() && s.status !== 'rejected')) return fail('you already have a submission with that title');
        let art = null;
        if (a.art_png_base64 !== undefined && a.art_png_base64 !== null && a.art_png_base64 !== '') {
          if (typeof a.art_png_base64 !== 'string') return fail('art_png_base64 must be a base64 string');
          const bytes = Buffer.from(a.art_png_base64.replace(/^data:image\/png;base64,/, ''), 'base64');
          if (!bytes.length || bytes.length > ART_LIMIT) return fail('art must be a PNG of at most 2 MB');
          if (bytes.readUInt32BE(0) !== 0x89504e47) return fail('art must be a PNG');
          art = bytes;
        }
        const id = `s-${Date.now().toString(36)}-${randomBytes(8).toString('hex')}`; // BEV-9 (#4.4): 64 random bits
        const record = { version: 1, id, memberId: who.id, author: who.name, title, blurb, host, repo, art: Boolean(art), at: new Date().toISOString(), status: 'pending', slot: null };
        mkdirSync(submissionsDir, { recursive: true });
        if (art) writeFileSync(resolve(submissionsDir, `${id}.png`), art);
        const file = resolve(submissionsDir, `${id}.json`); const tmp = `${file}.${randomBytes(3).toString('hex')}.tmp`;
        writeFileSync(tmp, JSON.stringify(record)); renameSync(tmp, file);
        return text({ ok: true, id, status: 'pending', done: true, next: SUBMITTED_NEXT + ' Your game is already hosted at the URL you gave — leave it there. When the owner presses DEPLOY it gets its own page at chimpvibe.dev/<name>; chimpvibe_my_submissions shows the state.' });
      }
      case 'chimpvibe_my_submissions':
        return text(submissions().filter((s) => s.memberId === who.id).sort((x, y) => String(y.at).localeCompare(String(x.at))).map((s) => ({ id: s.id, title: s.title, status: s.status, slot: s.slot, at: s.at, host: s.host })));
      default:
        return null;
    }
  }

  async function rpc(message, who) {
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return { jsonrpc: '2.0', id: message?.id ?? null, error: err(-32600, 'invalid request') };
    }
    const { id, method, params } = message;
    const isNotification = id === undefined;
    if (method.startsWith('notifications/')) return null;
    const reply = (result) => (isNotification ? null : { jsonrpc: '2.0', id, result });
    const error = (code, msg) => (isNotification ? null : { jsonrpc: '2.0', id, error: err(code, msg) });
    switch (method) {
      case 'initialize': {
        const asked = String(params?.protocolVersion || '');
        return reply({ protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'chimpvibe', version }, instructions: 'ChimpVibe is a site where a community branches and forks games in the open. This ONE server fronts every game with your one token. If the user pasted a TAG (chimpvibe:<slug>#<n>, e.g. chimpvibe:ssnake#9): call chimpvibe_resolve {tag} FIRST and then offer exactly three choices — Install <game> · Ask about <game> · Modify <game> — and wait for one (its reply spells each out). Otherwise call chimpvibe_whoami first, then chimpvibe_guide; to change a game: chimpvibe_tree → chimpvibe_fork_from {ref} → the begin call it returns → patch → validate → submit. If you have the ChimpVibe skill, run /chimpvibe:contribute — it walks you through every step. After you submit, your job is OVER: the owner alone reviews and deploys (nothing is public before that) — never publish, host or deploy anything yourself; tell your user "Submission complete, there\'s no more for me to do." and stop.' });
      }
      case 'ping': return reply({});
      case 'tools/list': {
        // this server's tools + every game's tools, each under its own name, all with the ONE token (BEV-6)
        // BEV-9 (#3.3): tool names are unique per server (clients key tools by name), so a name several games serve is listed
        // ONCE — its description says so and names the routing rule (the call goes to the game whose sessionId it carries).
        const merged = [...tools];
        const holders = new Map(); // tool name → the games that serve it
        for (const g of games()) for (const t of await gameTools(g, who.authorization)) {
          const seen = holders.get(t.name) || [];
          holders.set(t.name, [...seen, g.name]);
          if (!seen.length) merged.push({ ...t, description: `[${g.name}] ${t.description || ''}` });
        }
        for (const t of merged) {
          const served = holders.get(t.name) || [];
          if (served.length > 1) t.description = `[${served.join(' · ')} — served by every game: pass the sessionId that chimpvibe_fork_from gave you] ${String(t.description).replace(/^\[[^\]]*\]\s*/, '')}`;
        }
        return reply({ tools: merged });
      }
      case 'tools/call': {
        const name = String(params?.name || '');
        console.log(`[mcp] ${who.id} ${name}`); // BEV-9 (#3.5): who called what — never the token
        if (tools.some((t) => t.name === name)) {
          try {
            const result = await call(name, params?.arguments, who);
            return reply(result ?? fail('unknown tool'));
          } catch (e) {
            return reply(fail(String(e?.message || e)));
          }
        }
        // a game's tool: forwarded verbatim with the member's own bearer; the reply comes back as the game gave it (+ remedy)
        const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
        const holders = [];
        for (const g of games()) if ((await gameTools(g, who.authorization)).some((t) => t.name === name)) holders.push(g);
        if (!holders.length) return error(-32602, `unknown tool: ${name}`);
        // which game (BEV-7 P6): by sessionId, then by the proposal's remembered home, else every holder in order
        let order = holders;
        if (typeof args.sessionId === 'string' && holders.some((g) => g.sessionId === args.sessionId)) order = [holders.find((g) => g.sessionId === args.sessionId)];
        else if (typeof args.proposalId === 'string' && proposalHome.has(args.proposalId) && holders.some((g) => g.url === proposalHome.get(args.proposalId))) order = [holders.find((g) => g.url === proposalHome.get(args.proposalId)), ...holders.filter((g) => g.url !== proposalHome.get(args.proposalId))];
        const tryNext = order.length > 1 && typeof args.proposalId === 'string'; // only a proposal lookup can miss on one game and hit on another
        let lastReply = null;
        for (const g of order) {
          try {
            const { status, message } = await postRpc(g.url, who.authorization, { jsonrpc: '2.0', id: id ?? 1, method: 'tools/call', params: { name, arguments: args } });
            if (status === 401 || status === 403) return reply(fail(`the game ${g.name} refused your token — ${REMEDIES.UNAUTHORIZED}`));
            if (!message) return reply(fail(`the game ${g.name} answered ${status} with no JSON-RPC message — wait a minute and try once more`));
            if (message.error) return error(message.error.code ?? -32000, `${g.name}: ${message.error.message || 'error'}`);
            if (tryNext && message.result?.isError && errorCodeOf(message.result) === 'PROPOSAL_NOT_FOUND') { lastReply = reply(withRemedy(message.result)); continue; }
            remember(g, message.result);
            return reply(withDone(name, withRemedy(message.result)));
          } catch (e) {
            return reply(fail(`the game ${g.name} did not answer (${String(e?.message || e).slice(0, 120)}) — wait a minute and try once more; if it repeats, tell the owner`));
          }
        }
        return lastReply || error(-32602, `unknown tool: ${name}`);
      }
      default: return error(-32601, `method not found: ${method}`);
    }
  }

  // The HTTP face. Returns true when it handled the request. `handle.resolveTag(text)` is the site's public GET /api/tag door.
  async function handle(req, res, readBody) {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' });
      res.end('The ChimpVibe MCP speaks JSON-RPC over POST. Add it with: claude mcp add --transport http chimpvibe https://chimpvibe.dev/mcp --header "Authorization: Bearer <your token>"');
      return true;
    }
    const who = identify(req);
    if (!who) {
      res.writeHead(401, { 'www-authenticate': 'Bearer realm="chimpvibe"', 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: err(-32001, 'a valid ChimpVibe member token is required (Authorization: Bearer …)') }));
      return true;
    }
    let body;
    try { body = await readBody(req, 4 * 1024 * 1024); } catch { res.writeHead(413); res.end(); return true; }
    let parsed;
    try { parsed = JSON.parse(body.toString('utf8')); } catch {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: err(-32700, 'parse error') }));
      return true;
    }
    const batch = Array.isArray(parsed);
    const replies = [];
    for (const message of batch ? parsed : [parsed]) { const r = await rpc(message, who); if (r) replies.push(r); }
    if (!replies.length) { res.writeHead(202, { 'cache-control': 'no-store' }); res.end(); return true; }
    const out = JSON.stringify(batch ? replies : replies[0]);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(out), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(out);
    return true;
  }
  handle.resolveTag = (text) => resolveTag(text, null);
  return handle;
}
