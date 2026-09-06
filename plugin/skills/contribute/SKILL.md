---
name: contribute
description: Contribute a change to a game on chimpvibe.dev (fork a node, patch, validate, submit — then STOP; the owner alone deploys) or submit a new game. Use whenever the user wants to change, add to, fork, or contribute to a ChimpVibe game such as Ssnake, or mentions chimpvibe.dev, a ChimpVibe kit, or a node like ssnake#9.
user-invocable: true
---

# ChimpVibe · contribute — the wizard

You are driving a member's contribution to a game on chimpvibe.dev through the **chimpvibe** MCP server (one server,
one token; every game's tools are served by it under their own names). Follow the steps **in order**. Each step ends
when you print its gate line (`✔ step N: …`) as plain text in your reply — printed only AFTER the step is complete, with
the real values filled in (never a gate with a question in it). **Never skip a gate. Never invent an id, a ref, a session
id or a file name — every value comes from a tool result or from the user. If you are unsure, STOP and ask the user.**

**The approval system, before anything else:** a submission is the END of your job. The owner alone reviews it and
puts it live (ONE press in his app, on his time); nothing is public before that. There is nothing for you to publish,
host, deploy, push, build or ask about afterwards — none of that exists in this system. When a submission succeeds you
tell the user, in these words, **"Submission complete, there's no more for me to do."** — and you stop.

The user's request is: `$ARGUMENTS` (may be empty — then ask).

## Your first two actions — no narration, no alternatives

1. If `mcp__chimpvibe__chimpvibe_whoami` (or `mcp__plugin_chimpvibe_chimpvibe__chimpvibe_whoami`) is not yet in your tool
   list, call **ToolSearch** once with the query
   `select:mcp__chimpvibe__chimpvibe_whoami,mcp__chimpvibe__chimpvibe_games,mcp__chimpvibe__chimpvibe_tree,mcp__chimpvibe__chimpvibe_fork_from,mcp__chimpvibe__snake_evolve_begin_proposal,mcp__chimpvibe__snake_evolve_list_source,mcp__chimpvibe__snake_evolve_read_source,mcp__chimpvibe__snake_evolve_search_source,mcp__chimpvibe__snake_evolve_apply_patch,mcp__chimpvibe__snake_evolve_validate,mcp__chimpvibe__snake_evolve_submit_proposal`.
   Its answer is a list of `tool_reference` entries. **That answer IS the load.** Nothing else is needed.
2. Emit a tool call named `mcp__chimpvibe__chimpvibe_whoami` (or the `mcp__plugin_chimpvibe_chimpvibe__` form) with input
   `{}` — the same way you would call Read or Grep. It works. **There is no HTTP endpoint, port, CLI, script or curl that
   reaches this server** — every Bash / PowerShell / node / curl attempt is refused by the environment and is a wrong turn.
   If you notice yourself typing `echo`, `curl` or `node -e`, stop: the tool call is the only path, and you can make it.
   "I do not have direct access to invoke MCP tools" is never true here — the tools in your list are yours to call.
3. As soon as that call answers, print its gate line as plain text — `✔ step 0: I am <member.name> (<member.id>); games:
   <slug…>; open workspaces: <n>` — before any other sentence. Every later step ends the same way (its own `✔ step N:` line);
   a step without its printed gate line did not happen.

**How to call the tools.** Every ChimpVibe tool is an MCP tool on the server named `chimpvibe`. In Claude Code they
appear as `mcp__chimpvibe__<tool>` (e.g. `mcp__chimpvibe__chimpvibe_whoami`) or, when the server came with this plugin,
as `mcp__plugin_chimpvibe_chimpvibe__<tool>` — the same tools, use whichever prefix your tool list shows. If your client lists them as deferred,
load them ONCE with ToolSearch (`select:mcp__chimpvibe__chimpvibe_whoami,mcp__chimpvibe__chimpvibe_games,...`) — after
ToolSearch returns them they ARE callable — a `tool_reference` result means the tool is now in your list: your very next
action is a tool call to `mcp__chimpvibe__chimpvibe_whoami` (or `mcp__plugin_chimpvibe_chimpvibe__chimpvibe_whoami`)
with `{}`. If you believe the tools "are not registered" or "cannot be invoked", that belief is wrong: make the call
anyway; it works. Do not announce it, do not test it, do not echo anything, do not write a script — call it. Never reach the server through Bash,
PowerShell, curl, node or any script; there is no CLI for it. Do not ask the user whether the kit is installed: if the
tools are in your tool list, it is.

## Step 0 · Who am I

Call `chimpvibe_whoami` with `{}` (the tool `mcp__chimpvibe__chimpvibe_whoami`).
- Only if that tool does NOT exist in your tool list at all: tell the user the kit is not installed — the install lines
  are `claude plugin marketplace add burhama/chimpvibe-kit` then `claude plugin install chimpvibe@chimpvibe-kit
  --config token=<token>` — and STOP.
- If the call answers with a 401 / "a valid ChimpVibe member token is required": the plugin has no token (or a revoked
  one). Tell the user to open **https://chimpvibe.dev/join**, mint their own token (shown once), and run the second install
  line the page gives them; then start again. STOP.
- If the call returns an error: show the user the exact error text and STOP.
- If any game shows `tokenWorks: false`: tell the user its `remedy` (the owner re-issues their kit). STOP.
- Note `workspaces` per game: a game allows 3 open workspaces. If 3 are listed, the user must let one expire (1 h idle)
  or you must finish one — say so.

Print: `✔ step 0: I am <member.name> (<member.id>); games: <slug…>; open workspaces: <n>`

## Step 1 · Which game

Call `chimpvibe_games` with `{}`. Only `status: "live"` games with `forkable: true` can be changed.
- If the user already named the game in their request, use it — do not ask again.
- Otherwise list the live games (slug · name · nodes) and **ask the user which one**. Wait for the answer.
- If the user wants to submit a **brand-new game** they host elsewhere, skip to **Step N** at the end.

Print: `✔ step 1: game = <slug>` — print this gate even when there is only one game or the user named it.

## Step 2 · Which node to build on (the identifier)

Call `chimpvibe_tree` with `{"slug": "<slug>"}`. Every node has a **ref** like `ssnake#9` (the number is its place in
accept order; `#0` is the base). `head` is the ref of the build the game runs right now.

**First look at the user's request for a ref.** A ref is the pattern `<slug>#<number>` (e.g. `ssnake#3`).
- The request names a ref that is in the tree → that is the base. **Do not ask.**
- The request says "the running build", "latest", "current", "head" → the base is `head`. **Do not ask.**
- The request names a ref that is NOT in the tree → tell the user it does not exist, list the valid refs (newest 6 as
  `ref · title · author`), and ask which one. STOP until they answer. Never guess.
- The request names no node at all → show the newest 6 as `ref · title · author`, say the running build is `head`, and
  ask which one. STOP until they answer.

Print, only once the base is decided: `✔ step 2: base = <ref> ("<title>" by <author>)`

## Step 3 · Get the exact fork call

Call `chimpvibe_fork_from` with `{"slug": "<slug>", "ref": "<ref>"}`. The result holds `call` and `args`
(`baseRef`, `intent`, and — when the site fronts several games — `sessionId`). **Copy `args` verbatim**: `baseRef` is the
node's commit, `sessionId` names the game's own host (several games share the same tool names; the server routes your
calls by it). Never add a `sessionId` the result did not give you; never drop one it did.

Print: `✔ step 3: baseRef = <first 8 chars of args.baseRef>…`

## Step 4 · State the change in one sentence

**Before you begin anything, check the ask against Rule 3.** If it needs the network (fetch, sockets, webhooks,
analytics, "send … to a URL"), collects or sends player data anywhere, uses `eval`, reaches outside `game/`, or is not
a change to the game people play: do NOT begin a workspace. Tell the user plainly that ChimpVibe game code cannot do
that (it runs sandboxed, no network), offer the nearest in-game alternative, and STOP. There is no gate for this step
in that case.

Write the `intent`: **the first sentence is the public title** (≤ 80 characters, plain words), then one or two
sentences explaining the change. If the user's request is unclear, ask ONE question, then write it.

Call `snake_evolve_begin_proposal` with fork_from's `args` plus your `intent` — `{"baseRef": "<args.baseRef>", "intent":
"<intent>"}` and, if fork_from gave one, `"sessionId": "<args.sessionId>"`. Keep the returned workspace `id` (it starts
with `proposal-`); every later call needs it as `proposalId` (the server remembers which host holds it).

Print: `✔ step 4: workspace <id>, intent "<first sentence>"`

## Step 5 · Patch, under the rules

Read before you write: `snake_evolve_list_source` (`{"proposalId"}`), then `snake_evolve_read_source`
(`{"proposalId", "path"}`) on every file you will touch, and `snake_evolve_search_source` (`{"proposalId", "query"}`)
to find things.

**The game at your base may not be what the user assumes.** A node can carry a whole different game — the running build
has been replaced wholesale before (a swarm shooter once sat on Ssnake's tree; it now has its own tree, `lumencoil`). Read the manifest in
`game/revisions/` (`title`, `summary`, `client.entry`) before patching. If the mechanic the user named does not exist in the
game this node runs (no food, no score, no snake…), do NOT invent a stand-in and do NOT guess: say what this node's game is,
name the newest node from Step 2's list whose title fits the ask (or propose the nearest equivalent inside this game), and
ask ONE question. The open workspace expires on its own (1 h idle); when the user picks another node, repeat Steps 2–4.

**Rule 1 — a NEW revision id, FIRST.** The revision file (`game/revisions/<name>.js`, usually `classic.js`) carries an
`id:` line. It must change to a new kebab-case id that describes your change (e.g. `id: 'golden-apples'`). The game
refuses a build that keeps the running id (`REVISION_ID_REUSED`). Do this patch before any other.

**Rule 2 — labels ≤ 40 characters.** Any `label` in presentation/HUD data must be 1–40 characters.

**Rule 3 — only `game/`.** Only files under `game/` with `.js`, `.json`, `.md`. No network, no `eval`, no imports from
outside `game/`, no new dependencies.

**Rule 4 — one exact match per patch.** `snake_evolve_apply_patch` takes `{"proposalId", "path", "match", "replacement"}`.
`match` must occur **exactly once** in the file: copy it verbatim from `read_source`, including indentation. To create a
file, pass `"match": null`. Small patches, one at a time. A workspace allows 100 patches.

Print after your last patch and BEFORE you call `snake_evolve_validate`: `✔ step 5: patched <n> file(s): <paths>` (Rule 1 must be among them unless the file
already carried a new id).

## Step 6 · Validate until green

Call `snake_evolve_validate` with `{"proposalId"}`.
- `status: "validated"` → continue.
- Otherwise read `error.code` and `error.message`, look the code up in the **ERROR → REMEDY** table below, do exactly
  that, then validate again. Up to 6 rounds. If still failing, show the user the last message and ask how to proceed.

Print: `✔ step 6: validated (round <k>)`

## Step 7 · Submit

Call `snake_evolve_submit_proposal` with `{"proposalId"}`. The result's `proposal` shows `status: "pending"` and its
`baseCommitSha` (the node you chose). If `stale: true` appears, that is fine: the owner's deploy replays your change
onto the live head. The result also carries `done: true` and a `next` sentence — that sentence is the whole of what is
left, and it is addressed to you: stop.

Print: `✔ step 7: submitted; base <ref>; the owner's DEPLOY finishes it`

## Step 8 · Stop — the approval system

Say to the user, first, in exactly these words: **"Submission complete, there's no more for me to do."**

Then, in three short lines: the fruit is **pending** and not public until the owner presses DEPLOY in his app (his
decision, on his time — nobody can hurry it and there is no way to check other than looking at the tree later); when he
does, it goes live on the game and appears on https://chimpvibe.dev/<slug>/tree with their name and the title; to change
it later, do **not** resubmit — begin a **new** proposal from the head (Step 2) once it is live. There is no "revise" tool.
Do not submit the same change twice.

**Nothing after submit is yours to do.** Do not publish, host, deploy, build a page, push to any repo or GitHub Pages,
open a pull request, write a README, "make it available", zip it, or ask the user where to host it — none of those exist
in this system; the owner's DEPLOY is the only way anything goes live, and he does it from his own app. Do not poll
`chimpvibe_tree` waiting for it. Do not start another workspace unless the user asks for a new change.

Print: `✔ step 8: done`

## Step N · A brand-new game (not a fork)

Ask for: title (≤ 80), a blurb (≤ 400), the https URL where it is playable, optionally a repo URL and a PNG capture.
Check the URL answers. Call `chimpvibe_submit_game` with `{title, blurb, host[, repo][, art_png_base64]}`. Then
`chimpvibe_my_submissions` to show its `pending` state. Print: `✔ step N: submitted "<title>" — pending the owner's
DEPLOY`. Then say, in exactly these words, **"Submission complete, there's no more for me to do."** — and stop. The game
stays hosted where it already is (the `host` URL); you do not host, publish, deploy or move it anywhere, and you do not
build a page for it — the owner's DEPLOY gives it `chimpvibe.dev/<name>`.

## Identification — how nodes are named

- `<game>#<n>` — the node's identifier. `n` counts accepted builds in order (`#0` = the base). Numbers never change
  and never move; a pending fruit reads `#?` until the owner accepts it.
- `head` (from `chimpvibe_tree`) — the ref of the build the game runs now. Building on `head` is the normal choice;
  building on an older node is fine too (the owner's deploy replays your change onto whatever is live by then).
- `baseRef` — the 40-hex commit behind a ref. You never type it: `chimpvibe_fork_from` gives it to you.
- `proposalId` — your workspace, `proposal-…`, from `snake_evolve_begin_proposal`.
- `sessionId` — the game's host, given by `chimpvibe_fork_from` (`args.sessionId`) when the site fronts several games. Copy
  it into `snake_evolve_begin_proposal` verbatim; never invent one; omit it only when fork_from gave none.

## ERROR → REMEDY

| code | do this |
|---|---|
| `REVISION_ID_REUSED` | change the `id:` line of the revision file to a NEW kebab-case id (Rule 1), validate again |
| `CONTRACT_INVALID` | the message names the field: a `label` must be 1–40 chars; a death `cause` a lowercase token — fix it, validate again |
| `SOURCE_POLICY_VIOLATION` | you touched something outside Rule 3 (network, eval, a path outside `game/`, a bad extension) — undo it, validate again |
| `SOURCE_LIMIT_EXCEEDED` | too many files or bytes — trim, validate again |
| `CANDIDATE_EXECUTION_FAILED` / `VALIDATOR_FAILED` | your code crashed in the smoke run — read the message (file:line), fix, validate again |
| `CANDIDATE_CONTRACT_UNSUPPORTED` | the manifest must say `runtimeVersion` 1 or 2 and `clientVersion` 1–3 |
| `VALIDATION_STALE` | you patched after validating — validate again, then submit |
| `PATCH_MATCH_NOT_FOUND` / `PATCH_MATCH_AMBIGUOUS` | your `match` is not found, or found twice — re-read the file and copy a unique passage verbatim |
| `WORKSPACE_LIMIT_EXCEEDED` | 3 workspaces open (or 100 patches used) — submit one, or wait for one to expire (1 h idle) |
| `PROPOSAL_NOT_FOUND` | wrong `proposalId` — use the one Step 4 printed; if it expired, begin again |
| `PROPOSAL_STATE_INVALID` | this workspace is already submitted — begin a new one for a new change |
| `BASE_REF_INVALID` / `BASE_REF_UNKNOWN` | `baseRef` must come verbatim from `chimpvibe_fork_from` — repeat Steps 2–3 |
| `PROPOSAL_BASE_MISMATCH` | the head moved — nothing to do, keep going |
| `SESSION_NOT_FOUND` | the `sessionId` is not one the server gave you — repeat Step 3 and copy `args` verbatim |
| `UNAUTHORIZED` / `tokenWorks: false` | the token is not on the game's registry — the owner re-issues the kit |
| `INTERNAL_ERROR` | wait a minute, retry once; then tell the user to report it |

Every error from the server also carries a `remedy` field — it says the same thing. Follow it.

## Never

- Never call a tool that is not in `tools/list` (there is no `snake_evolve_revise_proposal`).
- Never reach the server through Bash / PowerShell / curl / a script — only through the MCP tools themselves.
- Never hand the tool calls to a subagent / Agent / Task — make every call yourself, in this conversation, so every
  id, ref and gate stays in front of the user (a delegated call loses them and the next step starts from a guess).
- Never ask the user to install anything while the `mcp__chimpvibe__*` tools are in your tool list.
- Never invent a `sessionId`, a `baseRef` or a `proposalId` — every one of them comes from a tool result.
- Never skip validation, never submit twice, never patch files outside `game/`.
- Never publish, host, deploy, push, build a page, open a PR or ask about hosting after a submission — the owner alone
  deploys. A successful submission ends with "Submission complete, there's no more for me to do." and nothing else.
- Never ask the user for their token, and never print it.
