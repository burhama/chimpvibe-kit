import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, lstatSync, readlinkSync } from 'node:fs';
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
  assert.equal(config.mcpServers.chimpvibe.headers, undefined);
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
  assert.equal(plugin.userConfig, undefined);
  assert.match(readme, /claude plugin install chimpvibe@chimpvibe-kit\n/);
  assert.doesNotMatch(readme, /claude plugin install [^\n]*--config/);
});

test('Claude, Cursor, Codex, Gemini, and Copilot install one skill package and one hosted connection', async () => {
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
  // ChimpVibe's /mcp refuses fixed tokens; every client signs in with OAuth, so no config sends a token.
  assert.equal(claudeMcp.mcpServers.chimpvibe.headers, undefined);
  assert.equal(cursorMcp.mcpServers.chimpvibe.headers, undefined);
  assert.equal(cursorPlugin.skills, './skills/');
  assert.equal(cursorPlugin.mcpServers, './mcp.json');
  assert.equal(cursorPlugin.version, claudePlugin.version);
  assert.equal(cursorPlugin.name, meta.name);
  assert.equal(cursorPlugin.variables, undefined);
  assert.equal(cursorPlugin.author.url, undefined);
  assert.equal(cursorMarketplace.plugins[0].name, meta.name);
  assert.equal(cursorMarketplace.plugins[0].source, 'plugin');
  assert.deepEqual(Object.keys(cursorMarketplace.plugins[0]).sort(), ['description', 'name', 'source']);
  assert.equal(codexPlugin.name, meta.name);
  assert.equal(codexPlugin.version, claudePlugin.version);
  assert.equal(codexPlugin.skills, './skills/');
  assert.equal(codexPlugin.mcpServers[connection.serverName].type, connection.transport);
  assert.equal(codexPlugin.mcpServers[connection.serverName].url, connection.url);
  assert.equal(codexPlugin.mcpServers[connection.serverName].bearer_token_env_var, undefined);
  assert.equal(codexPlugin.mcpServers[connection.serverName].headers, undefined);
  assert.equal(codexPlugin.mcpServers[connection.serverName].http_headers, undefined);
  assert.equal(codexMarketplace.plugins[0].name, meta.name);
  assert.equal(codexMarketplace.plugins[0].source.path, './plugin');
  assert.deepEqual(codexMarketplace.plugins[0].policy, { installation: 'AVAILABLE', authentication: 'ON_INSTALL' });
  const gemini = JSON.parse(read('gemini-extension.json'));
  assert.equal(gemini.name, meta.name);
  assert.equal(gemini.version, claudePlugin.version);
  assert.equal(gemini.mcpServers[connection.serverName].httpUrl, connection.url);
  assert.equal(gemini.mcpServers.chimpvibe.headers, undefined);
  assert.equal(gemini.settings, undefined);
  assert.equal(lstatSync(resolve(root, 'skills')).isSymbolicLink(), true);
  assert.equal(readlinkSync(resolve(root, 'skills')), 'plugin/skills');
  assert.match(readme, /Upgrading from the token setup/);
  assert.match(readme, /Auth required/);
  assert.match(readme, /gemini extensions install https:\/\/github.com\/burhama\/chimpvibe-kit/);
  const copilot = JSON.parse(read('copilot/plugin.json'));
  const copilotMcp = JSON.parse(read('copilot/.mcp.json'));
  const copilotMarketplace = JSON.parse(read('.github/plugin/marketplace.json'));
  assert.equal(copilot.name, meta.name);
  assert.equal(copilot.version, claudePlugin.version);
  assert.equal(copilot.skills, 'skills/');
  assert.equal(copilot.mcpServers, '.mcp.json');
  assert.equal(copilot.$schema, undefined);
  assert.equal(copilotMcp.mcpServers[connection.serverName].type, connection.transport);
  assert.equal(copilotMcp.mcpServers[connection.serverName].url, connection.url);
  assert.equal(copilotMcp.mcpServers.chimpvibe.headers, undefined);
  assert.equal(copilotMarketplace.plugins[0].name, meta.name);
  assert.equal(copilotMarketplace.plugins[0].source, './copilot');
  assert.equal(read('copilot/skills/tag/SKILL.md'), tag);
  assert.equal(read('copilot/skills/contribute/SKILL.md'), contribute);
  assert.match(readme, /copilot plugin marketplace add burhama\/chimpvibe-kit/);
  assert.match(readme, /scripts\/platforms\.mjs/);

  const check = spawnSync(process.execPath, ['scripts/render-plugins.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
});

test('no config, script, or doc tells a client to send a fixed token to /mcp', async () => {
  const { spawnSync } = await import('node:child_process');
  const files = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter((f) => /\.(json|mjs|md)$/.test(f) && f !== 'tests/kit-contract.test.mjs' && f !== 'scripts/check-secrets.mjs' && !f.endsWith('SKILL.md'));
  assert.ok(files.length > 10);
  for (const file of files) {
    const text = read(file);
    // The README names the old settings once, in its upgrade section, so it is skipped here.
    if (file === 'README.md') continue;
    assert.doesNotMatch(text, /bearer_token_env_var|"Authorization"\s*:|Authorization:\s*Bearer/, file);
    assert.doesNotMatch(text, /CHIMPVIBE_TOKEN|CHIMPVIBE_MEMBER|COPILOT_MCP_CHIMPVIBE/, file);
  }
});
