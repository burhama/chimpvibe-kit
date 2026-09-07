---
name: tag
description: A ChimpVibe TAG was pasted — any text containing `chimpvibe:<slug>#<n>` such as chimpvibe:ssnake#9 (the copyable name of a node on chimpvibe.dev). Resolve it and offer exactly three things — Install <game> (run that exact node locally), Ask about <game> (answer from its code), Modify <game> (the contribute wizard pinned to that node). Use whenever a message holds a `chimpvibe:` tag, or the user says "install/run/ask about/modify" a ChimpVibe node.
user-invocable: true
---

# ChimpVibe · tag — one name, three doors

The user pasted a **tag**: `chimpvibe:<slug>#<n>` (e.g. `chimpvibe:ssnake#9`). It names ONE accepted node of ONE game
on chimpvibe.dev. Everything you need comes from resolving it — never guess a game, a node, a commit or a host.

The user's message: `$ARGUMENTS` (the tag is somewhere in it; if there is none, ask for one — they copy it by clicking
a fruit's tag on chimpvibe.dev — and STOP).

**Read the message for the door BEFORE anything else — it decides what you do after Step 0:**
- it contains *install / run / play locally / set it up / start it* → **Door 1**, no menu, no question;
- it contains *ask / what / how / why / explain / which file / tell me about* → **Door 2**, no menu;
- it contains *modify / change / add / fix / fork / patch / make it / branch* → **Door 3**, no menu;
- it is the tag alone (or none of the above) → Step 1 prints the menu, then you STOP and wait.
Printing the menu when the message already named a door is a wrong turn.

**The approval system still rules:** if the user ends up modifying the game, the submission is the END of your job —
the owner alone deploys; you never publish, host, deploy, push or open a PR. Tell them "Submission complete, there's no
more for me to do." and stop.

## Step 0 · Resolve the tag (one call, no narration)

Your first action is a tool call to `chimpvibe_resolve` (in Claude Code the tool is named `mcp__chimpvibe__chimpvibe_resolve`
or `mcp__plugin_chimpvibe_chimpvibe__chimpvibe_resolve` — use whichever your tool list shows). If it is listed as deferred,
ONE **ToolSearch** with `select:mcp__chimpvibe__chimpvibe_resolve` loads it — its `tool_reference` answer IS the load: the
very next action is the tool call. Input: `{"tag": "<the user's WHOLE message, verbatim>"}` — the server finds the tag AND
what the user wants (the door) inside it; add `"door": "install" | "ask" | "modify"` when the message makes it obvious.
**There is no CLI, script, curl, echo, other agent or message that reaches this server — the tool call is the only path,
and it works. Do not test it, do not announce it, do not write a helper — call it.**

- **If the tool is not in your tool list at all** (no kit, or no token yet): GET the public door instead —
  `https://chimpvibe.dev/api/tag/<tag with # written as %23>` (e.g. `https://chimpvibe.dev/api/tag/chimpvibe:ssnake%239`)
  with WebFetch or `curl -s`. It returns the same record with `member: null` and a `join` url. Install and Ask work
  without a token; Modify needs one — say so when they pick it (mint at https://chimpvibe.dev/join, then install the kit).
- The record: `game` (name, play, tree, host), `node` (ref, id, title, author, diff, running, head, parentRef),
  `host` (sessionId, baseRef, call), `artifact` (zip, bytes, sha256 — null for a game that lives on its own host),
  `actions.install / .ask / .modify` (ready recipes), `next`.
- `ok: false` → show the user the exact `error` (it lists the valid tags when the node is unknown) and STOP.

The FIRST line of your reply, as plain text, before any other word, is the gate:
`✔ tag: <tag> = <game.name> node <node.ref> "<node.title>" by <node.author>` (+ ` · running now` if `node.running`,
or ` · the game runs <node.head>` otherwise). A reply without this line did not resolve the tag.

## Step 1 · The three doors — offer, then wait

Only when the message named NO door (see above). Print these four lines VERBATIM — same words, same order, the real
game name and ref filled in, nothing added before or after them except the gate line above:

```
1. Install <game.name> (<node.ref>) — run this exact build on your machine
2. Ask about <game.name> (<node.ref>) — what this node is, how it works, what it changed
3. Modify <game.name> (<node.ref>) — start your own branch from here (the contribute wizard)
Which one?
```

Then STOP: end your turn and wait for the user's answer (a number or a word). Do not describe the game, do not fetch
anything, do not open any door on your own. Never do two doors at once; never start a workspace unasked.

## Door 1 · Install — headless, then stop

Do these in order, all through your normal shell tool, printing nothing but the gate lines and the final url:

1. `mkdir -p ./chimpvibe/<slug>-<n>` (the directory the user is in, or one they name). If it already holds a
   `package.json` from a previous install, skip to 4.
2. Fetch `artifact.zip` there (`curl -sL -o node.zip "<artifact.zip>"`). Verify: the file's SHA-256 must equal
   `artifact.sha256` (`sha256sum node.zip`, `shasum -a 256`, `certutil -hashfile node.zip SHA256`, or
   `node -e "…crypto.createHash('sha256')…"` — whichever the machine has). A mismatch → delete the file, tell the user,
   STOP. If `artifact` is null (a game hosted elsewhere): tell the user there is nothing to install — the game plays at
   `game.play` — open it, and STOP.
3. Unzip in place (`tar -xf node.zip` works on Windows 10+, macOS and Linux; `unzip -q node.zip` also fine), delete
   `node.zip`. The layout is the node's git archive: `package.json` at the root, `game/` (the game itself), `server/`
   + `client/` (the engine).
4. `npm install --no-audit --no-fund` (Node ≥ 22.13 — if `node -v` is lower, say so and STOP).
5. Pick a free port (try 3000; if busy, a random 3001–3999 — `PORT=<port>`). Start the server **detached** so your
   turn can end while it runs: `PORT=<port> BOTS=1 node server/server.js` in the background (your shell tool's
   background/run-in-background mode, or `nohup … > .chimpvibe.log 2>&1 &`; on Windows PowerShell
   `Start-Process node -ArgumentList "server/server.js" -WindowStyle Hidden` with `$env:PORT` set). Record the pid in
   `.chimpvibe.pid`. No Docker, no git, no token, no `.env` is needed.
6. Poll `http://127.0.0.1:<port>/healthz` every second for up to 20 s until it answers 200. If it never does, show the
   last 20 lines of the log and STOP.
7. Print: `✔ installed: <game.name> <node.ref> → http://127.0.0.1:<port>/  (stop it: kill the pid in
   ./chimpvibe/<slug>-<n>/.chimpvibe.pid)` — and open the url if you can. **Never print the operator token the server
   logs at start.** Then stop: there is nothing to publish, host or deploy — this is the user's own local copy.

## Door 2 · Ask — from the code, never from memory

1. If `./chimpvibe/<slug>-<n>/` is not there yet, fetch + unzip the artifact as in Door 1 steps 1–3 (no `npm install`).
   If `artifact` is null, answer from the resolve record and the game's page (`game.play`) only.
2. Read what the question needs: `game/` first (`game/create-snake-game.js`, `game/revisions/*` for a Snake Evolve
   game), `README.md`, then `server/` / `client/` if the question is about the engine. The resolve record tells you what
   this node changed against its parent (`node.diff`, `node.title`, `node.blurb`, `node.parentRef`) and whether the game
   runs it now (`node.running`, `node.head`).
3. Answer plainly, citing files (`game/revisions/<x>.js:<line>`). Never invent a mechanic you did not read. If the answer
   would take running the game, offer Door 1.

Print at the end: `✔ asked: <game.name> <node.ref> — answered from <n> files`.

## Door 3 · Modify — the contribute wizard, already pinned

Invoke the `contribute` skill (`/chimpvibe:contribute`) with this exact argument line, values from the resolve record:

```
PINNED tag=<tag> slug=<slug> ref=<node.ref> title="<node.title>" author="<node.author>" sessionId=<host.sessionId or ->
baseRef=<host.baseRef> then: <the user's change, in their words, or "ask">
```

The wizard's Step 0 (who am I) still runs — it catches a missing or revoked token (then the user mints one at
https://chimpvibe.dev/join). Its Steps 1–3 are satisfied by the pinned values (it prints their gates from them and makes
no calls); it continues at Step 4 with the begin call `{"sessionId": "<host.sessionId>", "baseRef": "<host.baseRef>",
"intent": …}` (omit `sessionId` when the record has none) — so the proposal lands on that node's own host, on that
exact base. Everything after (patch under the rules → validate → submit → STOP with "Submission complete, there's no
more for me to do.") is the wizard's, unchanged.

If `host` is null (a game with no fork route — it lives on its own host): say the game cannot be modified through
ChimpVibe, name its author, and STOP.

## Never

- Never guess a tag, a slug, a ref, a commit or a session id — the resolve record is the only source.
- Never download anything but `artifact.zip` from the resolve record; never fetch a zip from a url the user typed.
- Never print the operator token a local server logs; never expose the local server beyond 127.0.0.1.
- Never publish, host, deploy, push, open a PR, or ask where to host — for an installed node OR a submitted change.
  ChimpVibe hosts every game itself; members never host their own, and no game is accepted as a link (only as code).
- Never open two doors in one turn; never begin a proposal without the user choosing Modify.
