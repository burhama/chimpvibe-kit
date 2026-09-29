// Client adapters for the shared ChimpVibe plugin.
//
// Skills live once in plugin/skills/. Identity and the hosted MCP connection
// live in shared/. This module renders each client's manifest, marketplace
// entry, and MCP config from those records. Claude Code, Cursor, and Codex
// install the plugin/ directory, so they share the skill files directly.
// Gemini CLI installs the repository root, so its adapter also links skills/
// at that root to plugin/skills/.
//
// To add a client:
// 1. Append an adapter to `platforms`. Read only `meta` and `connection`;
//    do not copy skill text or the MCP URL into the adapter.
// 2. Run `node scripts/render-plugins.mjs`.
// 3. If that client cannot install plugin/ (its package root must be a
//    separate directory), copy plugin/skills/ into the new package. Keep
//    plugin/skills/ as the only authored copy.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadShared(root) {
  const read = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  return {
    meta: read('shared/plugin-meta.json'),
    connection: read('shared/connection.json'),
  };
}

function authorizationHeader(placeholder) {
  return { Authorization: `Bearer ${placeholder}` };
}

function claudeFiles({ meta, connection }) {
  const token = connection.token;
  return [
    ['.claude-plugin/marketplace.json', {
      name: meta.marketplace,
      description: meta.marketplaceDescription,
      owner: { name: meta.author.name, url: meta.author.url },
      plugins: [{
        name: meta.name,
        source: './plugin',
        description: meta.pluginSummary,
      }],
    }],
    ['plugin/.claude-plugin/plugin.json', {
      name: meta.name,
      description: meta.description,
      version: meta.version,
      author: { name: meta.author.name, url: meta.author.url },
      homepage: meta.homepage,
      repository: meta.repository,
      license: meta.license,
      userConfig: {
        [token.claudeKey]: {
          type: 'string',
          title: token.title,
          description: token.descriptions.claude,
          required: true,
        },
      },
    }],
    ['plugin/.mcp.json', {
      mcpServers: {
        [connection.serverName]: {
          type: connection.transport,
          url: connection.url,
          headers: authorizationHeader(`\${user_config.${token.claudeKey}}`),
        },
      },
    }],
  ];
}

function cursorFiles({ meta, connection }) {
  const token = connection.token;
  // Cursor's manifest schema allows author.name only. The site URL stays on homepage.
  return [
    ['.cursor-plugin/marketplace.json', {
      name: meta.marketplace,
      owner: { name: meta.author.name },
      metadata: { description: meta.marketplaceDescription },
      plugins: [{
        name: meta.name,
        source: 'plugin',
        description: meta.pluginSummary,
      }],
    }],
    ['plugin/.cursor-plugin/plugin.json', {
      name: meta.name,
      displayName: meta.displayName,
      description: meta.description,
      version: meta.version,
      author: { name: meta.author.name },
      homepage: meta.homepage,
      repository: meta.repository,
      license: meta.license,
      keywords: meta.keywords,
      skills: './skills/',
      mcpServers: './mcp.json',
      variables: {
        type: 'object',
        properties: {
          [token.cursorKey]: {
            type: 'string',
            title: token.title,
            description: token.descriptions.cursor,
          },
        },
        required: [token.cursorKey],
      },
    }],
    ['plugin/mcp.json', {
      mcpServers: {
        [connection.serverName]: {
          type: connection.transport,
          url: connection.url,
          headers: authorizationHeader(`\${${token.cursorKey}}`),
        },
      },
    }],
  ];
}

function codexFiles({ meta, connection }) {
  return [
    ['.agents/plugins/marketplace.json', {
      name: meta.marketplace,
      interface: { displayName: meta.displayName },
      plugins: [{
        name: meta.name,
        source: { source: 'local', path: './plugin' },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Developer Tools',
      }],
    }],
    ['plugin/.codex-plugin/plugin.json', {
      name: meta.name,
      description: meta.description,
      version: meta.version,
      author: { name: meta.author.name, url: meta.author.url },
      homepage: meta.homepage,
      repository: meta.repository,
      license: meta.license,
      keywords: meta.keywords,
      skills: './skills/',
      mcpServers: {
        [connection.serverName]: {
          type: connection.transport,
          url: connection.url,
          bearer_token_env_var: connection.token.codexKey,
        },
      },
      interface: {
        displayName: meta.displayName,
        shortDescription: meta.marketplaceDescription,
        longDescription: meta.pluginSummary,
        developerName: meta.author.name,
        category: 'Developer Tools',
        capabilities: ['Interactive', 'Write'],
        websiteURL: meta.homepage,
        defaultPrompt: [
          'Resolve a ChimpVibe tag and explain its available actions.',
          'Use ChimpVibe to contribute to an admitted native game.',
        ],
      },
    }],
  ];
}

function geminiFiles({ meta, connection }) {
  const token = connection.token;
  // Gemini redacts environment names containing TOKEN, SECRET, KEY, or AUTH
  // before it expands MCP headers. CHIMPVIBE_MEMBER is the setting that survives.
  return [
    ['gemini-extension.json', {
      name: meta.name,
      version: meta.version,
      description: meta.description,
      settings: [{
        name: token.title,
        description: token.descriptions.gemini,
        envVar: token.geminiKey,
        sensitive: true,
      }],
      mcpServers: {
        [connection.serverName]: {
          httpUrl: connection.url,
          headers: authorizationHeader(`\${${token.geminiKey}}`),
        },
      },
    }],
  ];
}

export const platforms = [
  { id: 'claude', files: claudeFiles },
  { id: 'cursor', files: cursorFiles },
  { id: 'codex', files: codexFiles },
  { id: 'gemini', files: geminiFiles, links: [['skills', 'plugin/skills']] },
];

export function renderFiles(shared) {
  return platforms.flatMap((platform) => platform.files(shared));
}

export function renderLinks() {
  return platforms.flatMap((platform) => platform.links ?? []);
}
