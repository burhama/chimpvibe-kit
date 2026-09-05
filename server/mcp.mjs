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
const ART_LIMIT = 2 * 1024 * 1024;
const PENDING_LIMIT = 20;

const err = (code, message) => ({ code, message });
const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (message) => ({ content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message }) }], isError: true });
const str = (v, max, name) => { if (typeof v !== 'string') throw new Error(`${name} must be a string`); const s = v.trim(); if (!s || s.length > max) throw new Error(`${name} must be 1–${max} characters`); return s; };
const httpsUrl = (v, name) => { const s = str(v, 200, name); let u; try { u = new URL(s); } catch { throw new Error(`${name} must be a URL`); } if (u.protocol !== 'https:' || !u.hostname.includes('.')) throw new Error(`${name} must be an https URL with a real host`); return u.toString(); };

// BEV-6: what a member's AI does next for each refusal a game can raise — appended as `remedy` to every forwarded error,
// and the source of the skill's ERROR → REMEDY table (plugin/skills/contribute/SKILL.md).
export const REMEDIES = {
  SESSION_NOT_FOUND: 'omit sessionId — the server has exactly one session',
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
async function postRpc(url, authorization, message, timeoutMs = GAME_TIMEOUT_MS) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization }, body: JSON.stringify(message), signal: AbortSignal.timeout(timeoutMs) });
  const text = await r.text();
  if (r.status === 401 || r.status === 403) return { status: r.status, message: null };
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  let parsed = null;
  try { parsed = JSON.parse(line ? line.slice(5) : text); } catch { parsed = null; }
  return { status: r.status, message: parsed };
}

export function createMcp({ dataRoot, catalogNow, readTree, guideText, version = '1.0', gameMcpUrl = (p) => p.fork?.mcp || null }) {
  // the games this server fronts: every catalog project with a fork route that names an MCP url
  const games = () => catalogNow().filter((p) => p.fork && gameMcpUrl(p)).map((p) => ({ slug: p.slug, server: p.fork.server, url: gameMcpUrl(p), name: p.name || p.slug }));
  const gameToolCache = new Map(); // url → { at, tools }
  async function gameTools(game, authorization) {
    const cached = gameToolCache.get(game.url);
    if (cached && Date.now() - cached.at < 60_000) return cached.tools;
    try {
      const { status, message } = await postRpc(game.url, authorization, { jsonrpc: '2.0', id: 'tools', method: 'tools/list' }, 15_000);
      const tools = status === 200 && Array.isArray(message?.result?.tools) ? message.result.tools : null;
      if (tools) { gameToolCache.set(game.url, { at: Date.now(), tools }); return tools; }
      return cached?.tools || [];
    } catch { return cached?.tools || []; }
  }
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
    return { id: member.id, name: String(member.name || member.id).slice(0, 80), authorization: header };
  }

  function submissions() {
    if (!existsSync(submissionsDir)) return [];
    return readdirSync(submissionsDir).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(readFileSync(resolve(submissionsDir, f), 'utf8')); } catch { return null; } }).filter(Boolean);
  }

  const tools = [
    { name: 'chimpvibe_whoami', description: 'Call this FIRST. Who you are on ChimpVibe, which games this one token opens (each checked live), how many tools each game offers, your open workspaces and submissions, and the next call to make.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'chimpvibe_guide', description: 'What ChimpVibe is, how its trees work, and exactly how to contribute a fork or a new game. Read this first.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'chimpvibe_games', description: 'Every project slot on chimpvibe.dev: slug, name, status, host, and how many nodes its public tree has.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'chimpvibe_tree', description: 'The public tree of one project, newest first: every approved node with its identifier (ref, e.g. ssnake#9), id, parent, branch, author, title, blurb, download, and which one the game runs (running). Pick a ref here before you fork.', inputSchema: { type: 'object', properties: { slug: { type: 'string', description: 'project slug, e.g. ssnake' } }, required: ['slug'], additionalProperties: false } },
    { name: 'chimpvibe_fork_from', description: 'Fork a project from one node: give its ref (e.g. "ssnake#9", from chimpvibe_tree) and get back the EXACT snake_evolve_begin_proposal call to make next — copy its args verbatim (baseRef is that node\'s commit).', inputSchema: { type: 'object', properties: { slug: { type: 'string' }, ref: { type: 'string', description: 'node identifier from chimpvibe_tree, e.g. ssnake#9' }, node: { type: 'string', description: 'alternatively the 40-hex node id' } }, required: ['slug'], additionalProperties: false } },
    { name: 'chimpvibe_submit_game', description: 'Submit a NEW game to ChimpVibe (pending until the owner deploys it). Needs a title, a short blurb, and a reachable https host where the game is playable; optionally a repo URL and a PNG capture (base64, ≤ 2 MB, 16:9 looks best).', inputSchema: { type: 'object', properties: { title: { type: 'string', maxLength: 80 }, blurb: { type: 'string', maxLength: 400 }, host: { type: 'string', description: 'https URL of the playable game' }, repo: { type: 'string', description: 'optional https URL of the source' }, art_png_base64: { type: 'string', description: 'optional PNG capture, base64' } }, required: ['title', 'blurb', 'host'], additionalProperties: false } },
    { name: 'chimpvibe_my_submissions', description: 'Your own game submissions and their state (pending · deployed · rejected).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  ];

  async function call(name, args, who) {
    const a = args && typeof args === 'object' ? args : {};
    switch (name) {
      case 'chimpvibe_whoami': {
        const list = games();
        const checked = await Promise.all(list.map(async (g) => {
          let tokenWorks = false, tools = 0, workspaces = null;
          try {
            const init = await postRpc(g.url, who.authorization, { jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'chimpvibe', version } } }, 10_000);
            tokenWorks = init.status === 200;
            if (tokenWorks) {
              tools = (await gameTools(g, who.authorization)).length;
              const session = await postRpc(g.url, who.authorization, { jsonrpc: '2.0', id: 'ws', method: 'tools/call', params: { name: 'snake_evolve_session', arguments: {} } }, 20_000);
              try { const body = JSON.parse(session.message?.result?.content?.[0]?.text || '{}'); workspaces = Array.isArray(body.result?.workspaces) ? body.result.workspaces.map((w) => ({ id: w.id, status: w.status, intent: String(w.intent || '').slice(0, 80) })) : null; } catch { workspaces = null; }
            }
          } catch { tokenWorks = false; }
          return { slug: g.slug, name: g.name, server: g.server, url: g.url, tokenWorks, tools, workspaces, remedy: tokenWorks ? null : 'this token is not on the game\'s registry: ask the owner for a fresh kit (PATCH)' };
        }));
        const mine = submissions().filter((s) => s.memberId === who.id);
        return text({ member: { id: who.id, name: who.name }, games: checked, submissions: { pending: mine.filter((s) => s.status === 'pending').length, deployed: mine.filter((s) => s.status === 'deployed').length }, next: 'chimpvibe_games → chimpvibe_tree {slug} → chimpvibe_fork_from {slug, ref} → the begin call it returns (snake_evolve_begin_proposal is served by this same server)' });
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
        const nodes = tree.nodes.map((n) => ({ ref: n.ref || null, id: n.id, parent: n.parent, branch: n.branch, author: n.author, title: n.label, blurb: n.blurb || n.label, at: n.at, running: Boolean(running && n.id === running), download: `https://chimpvibe.dev${n.download}` }));
        nodes.sort((x, y) => String(y.at || '').localeCompare(String(x.at || '')));
        return text({ slug, root: tree.root, head: nodes.find((n) => n.running)?.ref || null, nodes, how: 'fork one of these: chimpvibe_fork_from {"slug":"' + slug + '","ref":"<ref>"}' });
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
        return text({
          server: project.fork.server, call: project.fork.tool,
          args: { baseRef: found.id, intent: '<A short title for your change (one sentence, ≤ 80 characters). Then explain the change plainly.>' },
          base: { ref: found.ref || null, id: found.id, branch: found.branch, title: found.label, author: found.author },
          note: `Next call, verbatim: ${project.fork.tool} {"baseRef":"${found.id}","intent":"<title sentence. Then the change.>"} — your workspace starts as node ${found.ref || found.id.slice(0, 8)} ("${found.label}" by ${found.author}); when the owner deploys, your change is replayed onto whatever is live by then. The first sentence of your intent becomes the public title; the whole intent is the card's blurb. Then: list/read/search_source → apply_patch (new revision id first) → validate until "validated" → submit_proposal.`,
        });
      }
      case 'chimpvibe_submit_game': {
        const title = str(a.title, 80, 'title');
        const blurb = str(a.blurb, 400, 'blurb');
        const host = httpsUrl(a.host, 'host');
        const repo = a.repo === undefined || a.repo === null || a.repo === '' ? null : httpsUrl(a.repo, 'repo');
        const mine = submissions().filter((s) => s.memberId === who.id);
        if (mine.filter((s) => s.status === 'pending').length >= PENDING_LIMIT) return fail(`you already have ${PENDING_LIMIT} pending submissions`);
        if (submissions().some((s) => s.title.toLowerCase() === title.toLowerCase() && s.status !== 'rejected')) return fail('a submission with that title already exists');
        let art = null;
        if (a.art_png_base64 !== undefined && a.art_png_base64 !== null && a.art_png_base64 !== '') {
          if (typeof a.art_png_base64 !== 'string') return fail('art_png_base64 must be a base64 string');
          const bytes = Buffer.from(a.art_png_base64.replace(/^data:image\/png;base64,/, ''), 'base64');
          if (!bytes.length || bytes.length > ART_LIMIT) return fail('art must be a PNG of at most 2 MB');
          if (bytes.readUInt32BE(0) !== 0x89504e47) return fail('art must be a PNG');
          art = bytes;
        }
        const id = `s-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`;
        const record = { version: 1, id, memberId: who.id, author: who.name, title, blurb, host, repo, art: Boolean(art), at: new Date().toISOString(), status: 'pending', slot: null };
        mkdirSync(submissionsDir, { recursive: true });
        if (art) writeFileSync(resolve(submissionsDir, `${id}.png`), art);
        const file = resolve(submissionsDir, `${id}.json`); const tmp = `${file}.${randomBytes(3).toString('hex')}.tmp`;
        writeFileSync(tmp, JSON.stringify(record)); renameSync(tmp, file);
        return text({ ok: true, id, status: 'pending', next: 'The owner reviews submissions in his app; when he presses DEPLOY your game takes a slot on chimpvibe.dev. Check with chimpvibe_my_submissions.' });
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
        return reply({ protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'chimpvibe', version }, instructions: 'ChimpVibe is a site where a community branches and forks games in the open. This ONE server fronts every game with your one token. Call chimpvibe_whoami first, then chimpvibe_guide; to change a game: chimpvibe_tree → chimpvibe_fork_from {ref} → the begin call it returns → patch → validate → submit. If you have the ChimpVibe skill, run /chimpvibe:contribute — it walks you through every step.' });
      }
      case 'ping': return reply({});
      case 'tools/list': {
        // this server's tools + every game's tools, each under its own name, all with the ONE token (BEV-6)
        const merged = [...tools];
        for (const g of games()) for (const t of await gameTools(g, who.authorization)) if (!merged.some((x) => x.name === t.name)) merged.push({ ...t, description: `[${g.name}] ${t.description || ''}` });
        return reply({ tools: merged });
      }
      case 'tools/call': {
        const name = String(params?.name || '');
        if (tools.some((t) => t.name === name)) {
          try {
            const result = await call(name, params?.arguments, who);
            return reply(result ?? fail('unknown tool'));
          } catch (e) {
            return reply(fail(String(e?.message || e)));
          }
        }
        // a game's tool: forwarded verbatim with the member's own bearer; the reply comes back as the game gave it (+ remedy)
        for (const g of games()) {
          const gt = await gameTools(g, who.authorization);
          if (!gt.some((t) => t.name === name)) continue;
          try {
            const { status, message } = await postRpc(g.url, who.authorization, { jsonrpc: '2.0', id: id ?? 1, method: 'tools/call', params: { name, arguments: params?.arguments || {} } });
            if (status === 401 || status === 403) return reply(fail(`the game ${g.name} refused your token — ${REMEDIES.UNAUTHORIZED}`));
            if (!message) return reply(fail(`the game ${g.name} answered ${status} with no JSON-RPC message — wait a minute and try once more`));
            if (message.error) return error(message.error.code ?? -32000, `${g.name}: ${message.error.message || 'error'}`);
            return reply(withRemedy(message.result));
          } catch (e) {
            return reply(fail(`the game ${g.name} did not answer (${String(e?.message || e).slice(0, 120)}) — wait a minute and try once more; if it repeats, tell the owner`));
          }
        }
        return error(-32602, `unknown tool: ${name}`);
      }
      default: return error(-32601, `method not found: ${method}`);
    }
  }

  // The HTTP face. Returns true when it handled the request.
  return async function handle(req, res, readBody) {
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
  };
}
