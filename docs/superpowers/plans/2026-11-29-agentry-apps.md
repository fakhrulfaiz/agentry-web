# Agentry and connected apps (plan, 2026-11-29)

Goal: the built-in `agentry` assistant can set up agents that use connected apps (Composio): see what is connected, ask the user to connect a missing app, carry on by itself once it is connected, look up an app's actions, give the new agent access to the app, and make slim wrapper tools (like the hand-written Gmail ones) that are stored per owner and usable by every agent allowed that app.

Repo: `~/code/dsh-agents-api` (all of it). Web: only small touches if needed (below). Agreed with the user 2026-11-28/29; build steps 1–3 of the proposal, step 4 (per-agent MCP tool lists, search for big MCP servers) later.

## Facts to start from

- `src/mount-agentry-tools.ts`: Agentry tools (`AGENTRY_TOOL_NAMES`, `ASK_TOOLS` → `tools/pre-execute` answers `{kind:'ask'}`, the approval card).
- `src/builtin-agents.ts`: the `agentry` agent, today with no apps (so `grantsAllowNoApps` → no owner Composio tool is mounted for it).
- `src/mount-owner-composio.ts`: owner's sealed Composio key → MCP tool `composio` (`connect.composio.dev/mcp`, `x-consumer-api-key`).
- `src/mount-composio-app-tools.ts`: `APP_TOOLS` (Gmail/Calendar), each a nested `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL` call, grants checked with `checkComposioCall`, writes ask through the nested call. Mounted in `gateway.ts` (~line 2185).
- `src/connect-request.ts`: a tool output with a `connect.composio.dev/link/...` URL becomes `connect_request` on the item; the web shows a Connect button.
- `src/mount-agent-tools.ts`: `agent_create`/`agent_update` take `apps`, clamped by `clampGrants(requested, callerGrants)`.

## Task A: Agentry sees and connects apps (+ carries on after Connect)

1. Mount the owner's Composio tool for the `agentry` session too, but only for Agentry's own use: the model must not run app actions itself (hide `COMPOSIO_MULTI_EXECUTE_TOOL`, `COMPOSIO_REMOTE_WORKBENCH`, the bash/workbench tools and the Gmail/Calendar app tools from its mask). Agentry's tools call the meta tools as nested calls.
2. New Agentry tools (names in `AGENTRY_TOOL_NAMES`, only on the `agentry` agent — other agents do not get these):
   - `apps_list`: connected apps (and accounts) for this owner, via the Composio meta tools (`COMPOSIO_MANAGE_CONNECTIONS` / search result connection status — check which the live server lists). Read, no ask. Says plainly when the owner has no Composio key (point to Settings → Connectors).
   - `apps_tools_search(app, query)`: the app's actions with a short description and input names, from `COMPOSIO_SEARCH_TOOLS` (and the schema tool if needed), trimmed. Read, no ask.
   - `apps_connect(app)`: if already connected, says so. Otherwise returns the Connect link in its output (so `connect_request` makes the Connect card) and starts a watcher.
3. Watcher (the "how does the agent know" part, same idea as OpenMausBot answering its Connect card): poll the connection status every ~3 s for up to 10 minutes (stop early when the session is deleted). When active, put a short message into the session as the next input, e.g. "Gmail is now connected (work@…). Continue the setup." — start a turn if the session is idle, otherwise queue it after the running turn. Find the API's existing way to post an input into a session (schedules / approvals); do not invent a second path. One watcher per (session, app); memory only (an API restart drops it; the user can then just say "done"). Do not add a per-turn "connected apps" prompt section (it would change the prompt every turn and break the prompt cache).
4. Agentry giving apps to agents: `agent_create`/`agent_update` clamp `apps` to the caller's grants. Agentry has no apps of its own, so pass `callerGrants: null` for the `agentry` session (it is the owner's own assistant and every create asks first). Other agents keep the clamp.
5. Update the `agentry` instructions: when the user wants an agent that uses an app, `apps_list` → `apps_connect` if missing (then wait for the "connected" message, do not ask the user to type done) → `apps_tools_search` → create the agent with `apps` → optionally `app_tool_create` for the 2–5 actions it will use most.

## Task B: stored wrapper tools

1. Store: new table `app_tools` (owner, name, app, slug, description, input schema, defaults, fixed values, numeric limits, write flag, created/updated) in every store implementation (follow how `library_sources` / `owner_secrets` were added, with a migration). Name rules: `<app>_<action>` lowercase, unique per owner, must not clash with `APP_TOOLS` names or any other tool name.
2. Declarative runner: generalise the `APP_TOOLS` runner so a stored spec runs the same way (nested `COMPOSIO_MULTI_EXECUTE_TOOL`, grants check, write asks, `OUT_MAX` trim). Spec shape: `inputs` (JSON-schema properties the model sees, a slim subset of Composio's), `defaults` (used when the model leaves an input out), `fixed` (always sent, the model cannot change), `limits` (`{field: max}` clamp), `map` (model input name → Composio argument name, optional). Validate the spec on create (it must be JSON, inputs must be simple types, size cap).
3. Mounting: every session whose agent's grants allow the wrapper's app (and with an owner Composio key) gets the owner's wrappers for that app, next to `APP_TOOLS`. Read once per session start (cheap query); keep the list small (cap ~30 per owner, say so on create).
4. Agentry-only tools: `app_tool_create` (reads the real Composio schema for the slug first, refuses unknown slugs; asks first, approval card shows name, app, slug, inputs and fixed values), `app_tool_list`, `app_tool_delete` (asks first). Writes in a wrapper (`write: true`, or the slug is a write by `isWriteSlug`) ask before each run like the Gmail write tools.
5. Optional HTTP read for the web later (`GET /v1/agents/app-tools`); no web UI in this plan.

## Tests (minimal, only what protects behaviour)

- Spec validation and the declarative runner's argument building (defaults, fixed, limits, map) in one unit spec.
- Mount rule: wrappers only for agents allowed the app; Agentry-only tools absent on other agents; `agentry`'s mask hides app execution.
- Watcher: posts one "connected" input when the status flips to active, nothing on timeout (fake timers, fake status reader).
- Agentry's `agent_create` keeps `apps` (no clamp to none).

## Live check (reads only, rules)

- Never send email, post messages, or connect/disconnect accounts during the check; the owner's Composio key must never appear in output, logs, session config or the browser.
- Through the API with the dev owner: Agentry `apps_list`, `apps_tools_search("slack", "post message")`, `app_tool_create` for a read action (e.g. a Gmail or Calendar list action) → approve → a new chat with an agent allowed that app has the wrapper and one read call works. `apps_connect` for an app that is not connected returns a Connect link (do not open it); stop the watcher by deleting the test session. Clean up everything made.
