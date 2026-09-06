# chimpvibe-kit

Everything a community member needs to contribute to the games on **[chimpvibe.dev](https://chimpvibe.dev)** — one server,
one token, one skill.

- **One server.** `https://chimpvibe.dev/mcp` fronts every game on the site. Your AI connects once, with your one token,
  and gets the site's tools (`chimpvibe_whoami`, `chimpvibe_games`, `chimpvibe_tree`, `chimpvibe_fork_from`,
  `chimpvibe_submit_game`, `chimpvibe_my_submissions`) **and** every game's own tools (for Ssnake: `snake_evolve_*`) under
  their own names. `server/mcp.mjs` is the exact code that runs there.
- **One token.** The owner mints it for you (it arrives in your kit). It never goes anywhere but the `Authorization`
  header to chimpvibe.dev.
- **One skill.** `/chimpvibe:contribute` is a wizard: it asks which game, which node (every node has an identifier like
  `ssnake#9`), what you want to build, and then walks your AI — whatever model it is — through fork → patch → validate →
  submit, with a table of every error the game can raise and exactly what to do about it.

## Get your token (10 seconds, no owner needed)

Open **https://chimpvibe.dev/join**, type your name, press MINT MY TOKEN. The page shows your token ONCE together with
the two install lines below, already filled in — copy them. (The owner can still hand you a kit file instead; both work.)

## Install (Claude Code)

```
claude plugin marketplace add burhama/chimpvibe-kit
claude plugin install chimpvibe@chimpvibe-kit --config token=<your token>
```

Then, in any project:

```
/chimpvibe:contribute
```

Or just say "contribute a change to a ChimpVibe game" — the skill starts itself.

## Install (any other MCP client)

```
claude mcp add --transport http chimpvibe https://chimpvibe.dev/mcp --header "Authorization: Bearer <your token>"
```

…or the equivalent `mcpServers` entry (`url: https://chimpvibe.dev/mcp`, header `Authorization: Bearer <your token>`).
Then give your AI the text of [`plugin/skills/contribute/SKILL.md`](plugin/skills/contribute/SKILL.md) and say
"contribute".

## What is in here

| path | what |
|---|---|
| `plugin/` | the Claude Code plugin: `.mcp.json` (the ONE server, your token from the plugin's config), `skills/contribute/SKILL.md` (the wizard) |
| `server/mcp.mjs` | the ONE server's source, verbatim as deployed (kept equal by `scripts/sync-server.mjs --check`) |
| `scripts/check-secrets.mjs` | refuses to commit anything token-shaped — this repo never holds a secret |

## How a contribution flows

1. `chimpvibe_whoami` — who you are, which games your token opens.
2. `chimpvibe_tree {slug}` — the game's public tree; every node has a ref like `ssnake#9`; `head` names the running build.
3. `chimpvibe_fork_from {slug, ref}` — returns the exact `snake_evolve_begin_proposal` call (its `baseRef` is that node).
4. `snake_evolve_begin_proposal` → `list/read/search_source` → `apply_patch` (a NEW revision id first) →
   `snake_evolve_validate` until `validated` → `snake_evolve_submit_proposal`.
5. The owner presses DEPLOY: your change is replayed onto whatever is live by then, accepted, and appears on the tree
   with your name and title.

Privacy: the token is yours; the owner can revoke it. The plugin stores it in your Claude Code user settings exactly as a `claude mcp add --header` token would be stored; it is sent only as the Authorization header to chimpvibe.dev. Nothing you submit is public before the owner deploys it.

Tool names in Claude Code: the plugin's server exposes its tools as `mcp__plugin_chimpvibe_chimpvibe__<tool>`; a server added by hand with `claude mcp add` exposes them as `mcp__chimpvibe__<tool>`. Same tools.

MIT.
