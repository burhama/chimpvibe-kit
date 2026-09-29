import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const tag = read('plugin/skills/tag/SKILL.md');
const contribute = read('plugin/skills/contribute/SKILL.md');
const readme = read('README.md');

// These checks guard the published instructions, not the behavior of a live MCP deployment or an AI client.
test('the plugin retains only the hosted MCP connection', () => {
  const config = JSON.parse(read('plugin/.mcp.json'));
  assert.equal(config.mcpServers.chimpvibe.type, 'http');
  assert.equal(config.mcpServers.chimpvibe.url, 'https://chimpvibe.dev/mcp');
  assert.equal(config.mcpServers.chimpvibe.headers.Authorization, 'Bearer ${user_config.token}');
  assert.equal(existsSync(resolve(root, 'server/mcp.mjs')), false);
  assert.equal(existsSync(resolve(root, 'scripts/sync-server.mjs')), false);
  assert.doesNotMatch(readme, /server\/mcp\.mjs.*verbatim as deployed|sync-server\.mjs/);
});

test('both Claude skills retain valid frontmatter and the native contribution handoff', () => {
  for (const [name, text] of [['tag', tag], ['contribute', contribute]]) {
    assert.match(text, new RegExp(`^---\\nname: ${name}\\n`));
    assert.match(text, /\ndescription: [^\n]+\nuser-invocable: true\n---\n/);
  }
  assert.match(tag, /contribute.*skill/);
  assert.match(contribute, /tag.*skill/);
  assert.match(contribute, /chimpvibe_resolve/);
});

test('tag instructions cover distinct native, legacy and unavailable doors', () => {
  assert.match(tag, /artifact\.zip/);
  assert.match(tag, /actions\.install\.package/);
  assert.match(tag, /chimpvibe_read_package/);
  assert.match(tag, /actions\.modify\.call/);
  assert.match(tag, /actions\.modify\.note/);
  assert.match(tag, /historical legacy tag is Install\/Ask-only/);
  assert.match(tag, /bootstrap\.json/);
  assert.match(tag, /public resolved actions and bootstrap without authenticated `chimpvibe_guide`/);
  assert.match(tag, /127\.0\.0\.1/);
  assert.match(tag, /if the server binds more broadly and you cannot block external ingress, stop/);
  assert.match(tag, /Never print the operator token from its logs/);
  assert.match(tag, /OS isolation/);
  assert.doesNotMatch(tag, /host.*is null.*cannot be modified/i);
});

test('native authoring preserves identities, retries and independent new games', () => {
  for (const term of ['chimpvibe_whoami', 'chimpvibe_guide', 'tools/list', 'chimpvibe_fork_from',
    'chimpvibe_begin_draft', 'chimpvibe_new_game', 'chimpvibe_draft_status',
    'chimpvibe_draft_list', 'chimpvibe_draft_read', 'chimpvibe_draft_validate',
    'chimpvibe_draft_submit', 'chimpvibe_draft_receipt']) assert.ok(contribute.includes(term), term);
  assert.match(contribute, /Preserve the server-issued `id` and `gameId`/);
  assert.match(contribute, /requestKey.*exact same/);
  assert.match(contribute, /CONTENT_HASH_MISMATCH.*\*\*new\*\* key/);
  assert.match(contribute, /brand-new independent Game/);
  assert.match(contribute, /do not put the new game into someone else's tree/);
  assert.match(contribute, /Validation is not a browser playtest/);
  assert.match(contribute, /real screenshot/);
});

test('obsolete authoring paths and misleading promises are absent from active instructions', () => {
  for (const [name, text] of [['tag skill', tag], ['contribute skill', contribute], ['README', readme]]) {
    assert.doesNotMatch(text, /snake_evolve_|chimpvibe_submit_game|REVISION_ID_REUSED|proposalId|baseCommitSha|sessionId|baseRef/, name);
    assert.doesNotMatch(text, /replayed onto whatever is live|automatically rebas|one press in his app/, name);
  }
  assert.match(contribute, /Stop: no publishing, deployment, push, duplicate submission or polling/);
  assert.match(readme, /accepted revision.*not necessarily.*serving|serving can differ from the latest accepted revision/i);
});

test('marketplace and plugin metadata agree on a release and optional plugin setup', () => {
  const plugin = JSON.parse(read('plugin/.claude-plugin/plugin.json'));
  const marketplace = JSON.parse(read('.claude-plugin/marketplace.json'));
  assert.equal(plugin.name, 'chimpvibe');
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.equal(marketplace.plugins[0].name, plugin.name);
  assert.equal(marketplace.plugins[0].source, './plugin');
  assert.equal(plugin.userConfig.token.required, true);
  assert.match(readme, /claude plugin install chimpvibe@chimpvibe-kit --config "token=YOUR_TOKEN"/);
});

test('Claude, Cursor, and Codex install one skill package and one hosted connection', async () => {
  const { spawnSync } = await import('node:child_process');
  const meta = JSON.parse(read('shared/plugin-meta.json'));
  const connection = JSON.parse(read('shared/connection.json'));
  const claudeMcp = JSON.parse(read('plugin/.mcp.json'));
  const cursorMcp = JSON.parse(read('plugin/mcp.json'));
  const cursorPlugin = JSON.parse(read('plugin/.cursor-plugin/plugin.json'));
  const cursorMarketplace = JSON.parse(read('.cursor-plugin/marketplace.json'));
  const claudePlugin = JSON.parse(read('plugin/.claude-plugin/plugin.json'));
  const codexPlugin = JSON.parse(read('plugin/.codex-plugin/plugin.json'));
  const codexMarketplace = JSON.parse(read('.agents/plugins/marketplace.json'));

  for (const mcp of [claudeMcp, cursorMcp]) {
    assert.equal(mcp.mcpServers[connection.serverName].type, connection.transport);
    assert.equal(mcp.mcpServers[connection.serverName].url, connection.url);
  }
  assert.equal(claudeMcp.mcpServers.chimpvibe.headers.Authorization, 'Bearer ${user_config.token}');
  assert.equal(cursorMcp.mcpServers.chimpvibe.headers.Authorization, 'Bearer ${CHIMPVIBE_TOKEN}');
  assert.equal(cursorPlugin.skills, './skills/');
  assert.equal(cursorPlugin.mcpServers, './mcp.json');
  assert.equal(cursorPlugin.version, claudePlugin.version);
  assert.equal(cursorPlugin.name, meta.name);
  assert.deepEqual(cursorPlugin.variables.required, [connection.token.cursorKey]);
  assert.equal(cursorPlugin.author.url, undefined);
  assert.equal(cursorMarketplace.plugins[0].name, meta.name);
  assert.equal(cursorMarketplace.plugins[0].source, 'plugin');
  assert.deepEqual(Object.keys(cursorMarketplace.plugins[0]).sort(), ['description', 'name', 'source']);
  assert.equal(codexPlugin.name, meta.name);
  assert.equal(codexPlugin.version, claudePlugin.version);
  assert.equal(codexPlugin.skills, './skills/');
  assert.equal(codexPlugin.mcpServers[connection.serverName].type, connection.transport);
  assert.equal(codexPlugin.mcpServers[connection.serverName].url, connection.url);
  assert.equal(codexPlugin.mcpServers[connection.serverName].bearer_token_env_var, connection.token.codexKey);
  assert.equal(codexMarketplace.plugins[0].name, meta.name);
  assert.equal(codexMarketplace.plugins[0].source.path, './plugin');
  assert.deepEqual(codexMarketplace.plugins[0].policy, { installation: 'AVAILABLE', authentication: 'ON_INSTALL' });
  assert.match(readme, /CHIMPVIBE_TOKEN/);
  assert.match(readme, /scripts\/platforms\.mjs/);

  const check = spawnSync(process.execPath, ['scripts/render-plugins.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
});
