# Agents extras and owner connectors: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-11-26-agents-import-and-owner-connectors-design.md`.

**Goal:** (A) the API holds each owner's Composio key, sealed, and adds the Composio tool to every session it mounts, so scheduled runs get connectors; (B) import an agent from a GitHub/gist link or pasted text; (C) save a chat's subagent as a named agent; (D) remove the BFF's soft app note.

**Repos:** `~/code/dsh-agents-api` (Parts A and B backend) and `~/code/agentry-web` (web halves). Work in worktrees per each repo's `AGENTS.md`; branches from `develop`.

**Model per task:** marked **[Sonnet]** (mechanical, pattern exists) or **[Opus]** (security, cross-cutting or unclear seams).

## Global constraints

- The Composio key never appears in an API response, a log line, the session's saved config, an SSE frame or the browser. Tests assert this.
- Sealing: AES-256-GCM, HKDF-SHA256 from `secrets.key` (`AGENTRY_SECRETS_KEY`, at least 32 bytes), authenticated data `owner_id + "\0" + name`. Without `secrets.key` the secret routes answer 501 `secrets_disabled` and the API starts normally.
- Every new API route is in `openapi/agentry.yaml` (drift test) and `docs/http-api.md`; a `docs/changes/2026-11-26-owner-connectors.md` note and a `docs/README.md` row.
- Every behaviour change: dated bullet at the top of `## Unreleased` in that repo's `CHANGELOG.md`.
- Web: astryx components and tokens only; read props with `pnpm exec astryx component <Name>`.
- Checks: API `pnpm typecheck && pnpm vitest run` (with `DSH_ROOT=~/code/dsh-pinned`); web `pnpm typecheck && pnpm vitest run --no-file-parallelism`.

## Part A: owner secrets and mount-time Composio (API, then web)

### Task A1: sealing helper [Sonnet]

**Files:** create `dsh-agents-api/src/secrets/seal.ts`, `dsh-agents-api/tests/secrets-seal.spec.ts`.

- [ ] Write tests first: `seal(key, owner, name, value)` then `open(key, owner, name, sealed)` round-trips; opening with another owner or name throws `SecretOpenError`; opening with another key throws; `last4('ck_abcdef1234')` is `'1234'`; sealed output is base64 of iv(12) | tag(16) | data.
- [ ] Implement with `node:crypto` (`hkdfSync('sha256', key, 'agentry-api', 'agentry-api owner secrets v1', 32)`), modelled on `agentry-sandbox/src/crypto/secrets.ts`.
- [ ] `pnpm vitest run tests/secrets-seal.spec.ts` green; commit.

### Task A2: `owner_secrets` store [Sonnet]

**Files:** create `src/store/migrations/0005-owner-secrets.sql`; modify `src/store/store.ts` (add `secrets: SecretCollection` to `Store` and `guardStore`), `src/store/postgres.ts`, `tests/support/memory-store.ts`, `tests/store.spec.ts`.

- [ ] Tests first in `tests/store.spec.ts` (runs against both stores as the existing cases do): `put(owner, name, { sealed, last4 })` then `get` returns it with `updated_at`; `put` again replaces; `delete` returns true then false; another owner sees nothing; deleting the owner row cascades (if the owners table has cascade; match `files`).
- [ ] Migration: `create table owner_secrets (owner_id text not null references owners(id) on delete cascade, name text not null, sealed text not null, last4 text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (owner_id, name))`. Check `0001-initial.sql` for the owners table name and follow it.
- [ ] Implement both stores; green; commit.

### Task A3: config `secrets.key` and the `OwnerSecrets` service [Opus]

**Files:** modify `src/index.ts` (Config type and zod schema: `secrets?: { key?: string }`, min 32 bytes when set; pass to the gateway), `cordis.patch.yml` (`secrets: { key: !!js process.env.AGENTRY_SECRETS_KEY }`), `docker/agentry-api.env.example` (`AGENTRY_SECRETS_KEY=` with "openssl rand -hex 32"); create `src/secrets/owner-secrets.ts`, `tests/owner-secrets.spec.ts`.

- [ ] Tests first: `OwnerSecrets` with a memory store: `set/get/remove/status` (status gives `{ configured, last4, updated_at }`, never the value); `get` returns `undefined` and logs one warning (per owner, not per call) when the row cannot be opened (key changed); `enabled` is false without a key and `set` throws `SecretsDisabledError`; a config key under 32 bytes fails startup with a named error.
- [ ] Implement; green; commit.

### Task A4: Composio key and connections routes [Opus]

**Files:** create `src/connectors/composio-routes.ts`, `src/connectors/composio-status.ts` (port of `agentry-web/src/server/connector-status.ts`: `rpc`, `parseRpcBody`, `parseConnected`, `listConnectionsResult` with `action: "list"` only), `tests/composio-routes.spec.ts`, `tests/composio-status.spec.ts` (port the web's `tests/unit/connector-status.spec.ts` cases); modify `src/gateway.ts` (register routes before `/agents/:agent_id`; add `connectors` to the reserved first segments if the router needs it), `openapi/agentry.yaml`, `docs/http-api.md`.

- [ ] Tests first, with a fake `fetch`:
  - `GET /agents/connectors/composio` → `{ configured: false, last4: null, updated_at: null }`.
  - `POST` with `{ key: 'ck_x1234' }` → `{ configured: true, last4: '1234', ... }`; response body and captured logs do not contain `ck_x1234`.
  - `POST` with `{ key: 'nope' }` → 400 `invalid_key`; without `secrets.key` → 501 `secrets_disabled`.
  - `DELETE` → `configured: false`.
  - `GET .../connections?toolkits=gmail,github` → `{ data: { gmail: [...], github: [] } }` shape matching the web's `ConnectedInventory` (`src/server/connector-inventory.ts`); no key → 409 `connector_key_missing`; Composio 401 → 502 with `reason: 'rejected'`.
  - Another owner cannot see or delete the first owner's key.
- [ ] Implement; update OpenAPI (drift test green) and `docs/http-api.md`; commit.

### Task A5: mount the owner's Composio tool on every session [Opus]

**Files:** create `src/mount-owner-composio.ts`; modify `src/gateway.ts` (`buildAgentSetup`: after `mountMcpTools(agentCtx, mcpToolsFrom(resolved.tools), cwd)`), `src/index.ts` (`composio.mcpUrl`, default `https://connect.composio.dev/mcp`); create `tests/mount-owner-composio.spec.ts`; extend `tests/gateway.spec.ts`.

- [ ] Tests first:
  - `ownerComposioTool(tools, key, url)` returns a wire `mcp` tool `{ server_label: 'composio', required: false, transport: { type: 'http', server_url, headers: { 'x-consumer-api-key': key } } }`, or `undefined` when `tools` already has label `composio` or there is no key.
  - Gateway: a session created through `createIdleSession` with only `agent_id` (the schedule path) mounts a `composio` MCP client when the owner has a key (assert via the fake `McpClient` the gateway tests already use, or a spy on `mountMcpTools`).
  - The saved session config (`store.sessions.get(...).config`) never contains the key or a `composio` tool added this way.
  - Resume (`resumeSession`) mounts it again with the **current** key (replace the key between create and resume; assert the new value).
  - A session whose saved tools already have `composio` gets no second client.
  - `mountComposio` grants still refuse an ungranted app on that tool (reuse a case from `tests/mount-composio.spec.ts`).
- [ ] Implement: `buildAgentSetup` receives `owner` already; read the key through `OwnerSecrets.get(owner, 'composio')`; call `mountMcpTools(agentCtx, [tool], cwd)`.
- [ ] CHANGELOG bullet; `docs/changes/2026-11-26-owner-connectors.md` (what moved, the shadowing of the profile row, key changes apply on next start/resume, `AGENTRY_SECRETS_KEY`); `docs/README.md` row; mirror the backlog note in `dsh-agents-api/AGENTS.md`. Commit.

### Task A6: web key route forwards to the API, with one-time move [Opus]

**Files:** modify `app/api/agentry/connectors/key/route.ts`, `src/api/types.ts` (`ConnectorKeyStatus { configured, last4, updated_at }`); create `src/server/connector-key-upstream.ts` (server-only: `keyStatus(auth)`, `saveKey(auth, key)`, `removeKey(auth)` calling `agentryUrl('/agents/connectors/composio')` with `agentryHeaders`); modify `tests/unit/connectors-route.spec.ts`.

- [ ] Tests first (mock `fetch` and the file store):
  - `GET` returns the API's status (`last4` included, no key).
  - `GET` with a file-store key and API `configured: false` → POSTs it to the API, deletes the file entry on success, returns the new status; on API failure keeps the file entry and returns the API's status.
  - `POST` forwards `{ key }`; 400 `invalid_key` and 501 `secrets_disabled` pass through with their messages; CSRF still required.
  - `DELETE` forwards and also removes any file-store entry.
- [ ] Implement; the Connectors form (`src/ui/settings/ConnectorsForm.tsx`) shows `ck_…1234` and the 501 message ("This server cannot store connector keys. Ask the administrator to set AGENTRY_SECRETS_KEY."); add a line "A new key applies to chats you start after saving it." Update `tests/component/connectors-form.spec.ts`. Commit.

### Task A7: web status reads from the API [Sonnet]

**Files:** modify `app/api/agentry/connectors/status/route.ts`, `app/api/agentry/connectors/connected/route.ts`, `app/(app)/plugins/page.tsx`, `src/server/connections.ts`, `src/server/connection-cache.ts` (fetcher now takes `authorization` instead of a key); delete `src/server/connector-status.ts` and `tests/unit/connector-status.spec.ts` (ported in A4); update `tests/unit/connection-cache.spec.ts`, `tests/unit/connector-inventory.spec.ts`, `tests/component/plugins-page.spec.ts`.

- [ ] Tests first: status and connected routes call `GET /agents/connectors/composio/connections?toolkits=...` and map 409 to `{ data: null }` and 502 to the existing "unavailable"/"rejected" states; the cache key is the owner; no route imports `connectors-store` any more except the key route's migration.
- [ ] Implement; green; commit.

### Task A8: proxy stops editing session bodies [Sonnet]

**Files:** modify `app/api/agentry/[...path]/route.ts` (remove `withOwnerKey`, `withAgentNote`, their imports, and the body rewrite branch); delete `src/server/connector-tools.ts`, `src/server/agent-connectors.ts`, `tests/unit/connector-tools.spec.ts`, `tests/unit/agent-connectors.spec.ts`; modify `src/agents/form.ts` (remove `connectorNote`, `instructionsWithConnectors`; keep `grantsOf` and `CONNECTORS_KEY`), `tests/unit/agent-form.spec.ts`; update `tests/unit/proxy.spec.ts`.

- [ ] Test first in `tests/unit/proxy.spec.ts`: a `POST /agents/sessions` body is forwarded byte-for-byte (no `composio` tool, no instructions change), with and without a stored key.
- [ ] Implement; grep shows no remaining use of the removed functions; CHANGELOG bullet (connectors now apply to scheduled tasks and every chat; soft app note removed because the backend enforces app grants); update `AGENTS.md` status line ("hard app limits" done; drop the known limitation) and the agents page spec's "Known limitation" line with a pointer to this spec. Commit.

## Part B: import an agent

### Task B1: agent file parser [Sonnet]

**Files:** create `dsh-agents-api/src/agent-import/parse.ts`, `tests/agent-import-parse.spec.ts`, fixtures `tests/fixtures/agents/{planner.md,code-reviewer.md,no-tools.md,list-tools.md,agentry.json,not-an-agent.md}` (copy two real files from `~/code/ECC/agents/`, MIT; keep the license line in a fixture README).

- [ ] Tests first: front matter with `tools: Read, Grep, Glob` and with a YAML list; `name` `code-reviewer` → "Code reviewer"; body → `instructions`; `description` → `metadata.description`; `model: opus` → no model plus a note; `Task` in tools → `multi_agent.enabled: true`; unknown tool `NotebookEdit` → dropped with a note; tools not in the given Host catalog → dropped with a note; no `tools` → no `host_tools`; Agentry JSON keeps valid fields and drops `id`, `created_at`, and any MCP tool whose headers are `***`; instructions over 65,536 bytes → `ImportError('import_too_large')`; plain text without front matter → `ImportError('import_unrecognized')`.
- [ ] Implement with the `yaml` package the API already uses (`src/sandbox/presets.ts` imports it); the tool map is a constant in the file. Commit.

### Task B2: link fetching [Opus]

**Files:** create `src/agent-import/fetch.ts`, `tests/agent-import-fetch.spec.ts`; reuse `GithubDeps` from `src/skills/github.ts`.

- [ ] Tests first (fake `fetch`): `https://github.com/o/r/blob/main/agents/x.md` → fetches `https://raw.githubusercontent.com/o/r/main/agents/x.md`; `https://github.com/o/r/tree/main/agents` → lists `.md` files through `GET {apiBase}/repos/o/r/contents/agents?ref=main` and reads each one's front matter (cap 200, fetch in parallel with a limit of 8), returning candidates; gist URLs → raw; `http://` and other hosts → `ImportError('import_host_not_allowed')`; a redirect to another host is refused (`redirect: 'manual'`); body over 256 KB → `import_too_large`; 10 s timeout → `import_fetch_failed`.
- [ ] Implement; config `agents.importHosts` in `src/index.ts` (default the four GitHub hosts). Commit.

### Task B3: `POST /agents/import` route [Sonnet]

**Files:** create `src/agent-import/routes.ts`; modify `src/gateway.ts` (register before `/agents/:agent_id`; `import` joins the reserved agent ids), `openapi/agentry.yaml`, `docs/http-api.md`; create `tests/agent-import-routes.spec.ts`.

- [ ] Tests first: `{ text }` → `agent.import.draft`; `{ url }` file → draft with `source.url`; folder → `agent.import.candidates`; both or neither field → 400; errors map to 400 with their codes, `import_fetch_failed` to 502; nothing is written to `store.agents`.
- [ ] Implement (Host catalog names from the same source as `GET /agents/tools`); OpenAPI; CHANGELOG. Commit.

### Task B4: web client and allow-list [Sonnet]

**Files:** modify `src/server/allowlist.ts` (`POST agents/import`; add `import` to `RESERVED_AGENT_IDS`), `src/api/client.ts` (`importAgent(input)`), `src/api/types.ts` (`AgentImportDraft`, `AgentImportCandidates`); tests `tests/unit/allowlist.spec.ts`, `tests/unit/api-client.spec.ts`.

- [ ] Tests first: `POST /agents/import` allowed, `GET` not; `agents/import` is not read as an agent id; client posts JSON and returns the typed union. Implement; commit.

### Task B5: Import dialog and prefilled editor [Sonnet]

**Files:** create `src/ui/agents/ImportAgentDialog.tsx`, `src/agents/draft.ts` (pure `applyDraft(form, draft, catalog)` like `applyStarter`), `tests/component/import-agent.spec.tsx`, `tests/unit/agent-draft.spec.ts`; modify `src/ui/agents/AgentsPage.tsx` ("Import" button beside "New agent"), `src/ui/agents/AgentEditorDialog.tsx` (`EditorTarget` `{ kind: 'new'; starterId?; draft? }`), `src/ui/agents/AgentForm.tsx` (optional `draft` prop; shows `notes` in a `Notice` above the form; shows the source link and "Check the source's license before you share this agent.").

- [ ] Tests first: `applyDraft` keeps the user's default model when the draft has none, applies `host_tools.allow` only for names in the catalog; dialog: link tab posts `{ url }`, paste tab posts `{ text }`, a candidates answer shows a list and picking one posts its `url`, an error shows the server message; picking a draft opens the editor with the name and instructions filled and nothing saved until Save.
- [ ] Implement with astryx (`Dialog`, `Tabs`/`ToggleButton` as the page already uses, `TextInput`, `TextArea`, `List`/`Item`); commit.

### Task B6: Export [Sonnet]

**Files:** create `src/agents/export.ts` (pure: `toAgentJson(agent)`, `toAgentMarkdown(agent, catalogNames)` reversing the tool map), `tests/unit/agent-export.spec.ts`; modify the agent row menu in `src/ui/agents/AgentsPage.tsx`.

- [ ] Tests first: JSON drops `id`, timestamps and MCP tools with `***`; Markdown front matter round-trips through B1's parser (copy the parser's expected output for a fixture). Implement (download through a `Blob` link); CHANGELOG; commit.

## Part C: save a subagent as an agent (web)

### Task C1: keep `prompt` and `model` on the subagent view [Sonnet]

**Files:** modify `src/chat/reducer.ts` (`subagent` view gains `prompt?: string`, `model?: string`, read from the delegating `function_call` arguments where `description` is read today); tests in `tests/unit/reducer.spec.ts` (use a recorded fixture from `tests/fixtures/live/` with a subagent call).

- [ ] Test first, implement, commit.

### Task C2: "Save as agent" on the subagent card [Sonnet]

**Files:** create `src/agents/from-subagent.ts` (pure: `subagentDraft({ name, prompt, model }, chatModel)` → `AgentImportDraft`-shaped draft with instructions `You handle tasks like this one:\n\n<prompt>`), `tests/unit/from-subagent.spec.ts`; modify `src/ui/chat/SubagentCard.tsx` (an action in the header, hidden while the child runs and when `prompt` is missing), the route to the editor (`/agents?draft=…` is too long for a prompt; hold the draft in a small client store `src/agents/pending-draft.ts` read once by `AgentEditorDialog`); `tests/component/subagent.spec.tsx`.

- [ ] Tests first: draft fields; the card shows the action only for finished children with a prompt; clicking navigates to `/agents` with the editor open and the fields filled.
- [ ] Implement; CHANGELOG; update `AGENTS.md` status ("Not yet" list loses ECC/URL import and subagent deployment); commit.

## Part D: final checks

### Task D1: docs and live check notes [Sonnet]

- [ ] `README.md` (web): Connectors section says keys live in the API and need `AGENTRY_SECRETS_KEY` there.
- [ ] `docs/live-check.md` (web): add "schedule a task that reads Gmail; the run uses the connector" and "import `https://github.com/affaan-m/everything-claude-code/blob/main/agents/planner.md`".
- [ ] Both repos' checks green; commit.

## Review focus

1. Key never leaks: grep test output and the saved session config for the key; SSE replay of a session started with the injected tool.
2. Schedule path: a schedule created from the web form with `agent_id` runs with Composio tools.
3. Key replaced: new sessions and resumed sessions use the new key; a live session keeps the old one until it restarts.
4. Import refuses non-allowed hosts and redirects; no draft is saved without Save.
