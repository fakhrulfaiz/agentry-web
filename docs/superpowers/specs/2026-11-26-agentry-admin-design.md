# Agentry Admin: design

Date: 2026-11-26 · Status: awaiting user review · Scope: the Agentry API's admin surface (`/admin/v1` in `~/code/dsh-agents-api`) and the web app's admin section (F2 in `agentry-web`).

Decisions this spec builds on (do not re-litigate): `dsh-agents-api/AGENTS.md` decision 6 (auth modes; the admin API needs an admin realm role in Keycloak mode) and decision 8 (admins see all sessions, user messages, and the full per-turn model request rebuilt from the DSH Session log; live configuration through `dsh-config-editor` / `dsh-settings`). The F1 web spec (`docs/superpowers/specs/2026-11-08-agentry-web-f1-design.md`) defers admin pages to F2 and says role checks run on the server. The API foundation spec (`dsh-agents-api/docs/superpowers/specs/2026-11-08-agentry-api-foundation-design.md`, section 6) sketched the routes; this spec replaces that sketch where they differ and says why.

## 1. Goals

1. An admin can list and search every session of every owner, newest first, with owner, agent, status, model, title and times.
2. An admin can open any session read-only and see what the user saw: user messages, assistant text, reasoning, tool cards and subagents.
3. An admin can list the steps of a session and open the **full model request** of any step: system prompt, runtime context, tools, message history and call parameters. A golden test proves the rebuilt request equals what the provider received.
4. An admin can read the raw Session log of a session, paged.
5. An admin can view and change **live** configuration (fields DSH marks as live), with secrets never sent to the browser.
6. An admin can see service health in one place: versions, DSH pin, Postgres, Keycloak, the sandbox service, the local sandbox enforcement level.
7. Every admin read and write leaves one audit row, and admins can read the audit log.
8. Admin access works in both auth modes: a realm role in Keycloak mode, a key role in API-key mode.
9. Non-admins cannot reach any of it. The API answers 403; the web app answers 404 and hides the menu entry.

## 2. Non-goals

- Acting as another user: no impersonation, no sending messages into another owner's chat, no answering their approvals.
- User and role management. Keycloak owns users and roles. API keys stay in config, made with `pnpm keys:create`.
- Editing non-live configuration (needs a file edit and a restart). No raw `dsh-config-editor` writes from the browser in this round (section 6.6 explains).
- Cost dashboards and charts. The step list shows token usage per step; totals come later.
- Managing the Agentry Sandbox service (places, keys, limits). It has its own admin page (section 9).
- Copying model requests into Postgres. The Session log stays the source of truth (decision 7).
- The DSH web UI. It stays unrouted; admins reach it over an SSH tunnel as before.

## 3. What exists (facts, with paths)

API (`~/code/dsh-agents-api`):

- `src/auth/authenticator.ts`: `Principal = { owner, roles }`, `Role = 'agentry-user' | 'agentry-admin'`, helpers `requireRole` and `requireAnyRole`, and `firstThen` to chain two authenticators.
- `src/auth/keycloak.ts`: roles come from `realm_access.roles`, filtered to the two known roles.
- `src/auth/api-keys.ts`: each key entry is `{ name, owner, roles, hash }`; `roles` may include `agentry-admin`. `pnpm keys:create --admin` makes such a key.
- `src/auth/static-key.ts`: the development key; `devKey.admin` defaults to `true` (`src/index.ts`, `Config`).
- `src/gateway.ts`: `/v1` dispatch. `handle()` accepts either role. `routeTable()` feeds `tests/openapi-drift.spec.ts`, which already says to add `AdminGateway.routeTable()` with prefix `/admin/v1`.
- `src/store/store.ts`: `sessions.list({ owner: 'any', ... })`, `sessions.get(id, 'any')`, and `audit({ actor, action, target })`. Migration `0001-initial.sql` already made `admin_audit(id, actor, action, target, at)`. The `owners` table has only `id` and `created_at`.
- `src/history/session-history.ts`: items, turns and wire events from the log through `sessionQuery.readSession`, folded by `WireProjector`. It is owner-agnostic: it takes a `ProjectionBase`, so admin routes can reuse it as is.
- `src/redact.ts`: masks MCP header and env values on every wire response.
- `src/index.ts`: `inject` already lists `sessionQuery`. One web server serves `/`, `/v1`, `/health`; `/admin/v1` is planned on the same server (decision 2).

DSH (`~/code/dsh-pinned`, tag `dsh-v0.2.2-rc.1`):

- **How a request is built.** `packages/core/agent-loop/src/agent.ts`, `buildRequest()`: the request is `header.config` + `session.deriveMessages()` + `session.toolHistory()` + `header.tools`. The header is logged as a `request/header` event just before. System prompt changes are logged as `system/message` events and runtime context as `user/message` events, both inside the step, before `buildRequest()`.
- **Offline rebuild helpers.** `packages/core/session/src/request-header.ts`, `foldRequestHeader(events)`: "the pure offline reconstruction path". `packages/core/session/src/index.ts`: `Session.create(id, seed, header, inheritedEventCount, projections)` replays any log prefix; on it, `requestHeader()`, `requestContext()`, `toolHistory()` and `deriveMessages()` give the same values the loop used.
- **One attempt, one event.** `packages/core/session/src/types.ts`: each model attempt ends in exactly one `assistant/message` (carries `usage`) or `assistant/attempt` (failed or retried). So the request of an attempt = the state of the log just before that event.
- **Message interpreters.** `packages/session/session-format-catalog/src/message-projections.ts`: `currentSessionMessageProjections` must be passed to `Session.create` so image offload replays the same way.
- **Session query.** `packages/session-query/session-query/src/index.ts`: `readSession`, `observeSession`, `listEvents`, `readEvent`, `traceSession` (subagent tree), and `searchSessions` (full text; needs `dsh-session-query-sqlite`, which the base bundle mounts in `packages/bundle/base/cordis.patch.yml`).
- **Session inspector.** `packages/experimental/session-inspector` is a browser view of the raw log (turn and step grouping, stream chunks folded under their block). It does **not** rebuild requests. We copy its grouping rules for the web log view (section 7), not its code path for requests. Decision 8's "reuse the reconstruction in the inspector" therefore means: rebuild through the same `Session` folds the inspector and the loop rely on.
- **Settings.** `packages/settings/settings/src/index.ts`: `ctx.settings.describe({ redactSecrets: true })` returns one `SettingsDescriptor` per entry (`ns`, `schema`, `value`, `revision`, `base`, `user`, `secrets`), live fields only. `mutate(ns, ops, expectedRevision)` applies path edits without restating redacted secrets and throws `SettingsConflictError` on a stale revision. Both `config-editor` and `settings` are mounted by the base bundle.
- **Config editor.** `packages/boot/config-editor/src/index.ts`: `configuration()` returns full raw config (secrets included); `edit()` writes any field. Too broad for a browser (section 6.6).

Agentry Sandbox (`~/code/agentry-sandbox`), the model for an admin surface:

- `src/config.ts`: `AGENTRY_SANDBOX_ADMIN_KEYS` (hashes), which must differ from the API keys. No admin keys means no admin surface.
- `src/http/server.ts`: `/admin` serves one HTML page; `/v1/admin/*` answers 404 when admin keys are off, 401 without an admin key. An admin key is refused on `/v1`, and an API key on `/v1/admin`. Routes: `overview`, `sandboxes` (every owner's, start, stop, delete), `limits` (GET, PUT, DELETE), `places`, `keys`.

What we take from it: the admin surface can be turned off; it is a separate route tree with its own check; it shows every owner's records with plain actions. What we do not take: separate admin-only keys. Agentry already has roles on keys and tokens (section 5.2 and open question 1).

Web (`agentry-web`):

- `src/server/session.ts`: `Identity = { owner, roles, displayName }` in the encrypted session.
- `src/server/keycloak.ts`: roles from `realm_access.roles` at sign-in.
- `app/api/auth/apikey/route.ts`: reads `principal` from the `GET /v1/agents` response, which the API never sends. So in API-key mode the web app does not know the roles today (they show as empty).
- `src/server/allowlist.ts` + `app/api/agentry/[...path]/route.ts`: the `/v1` proxy, POST and DELETE only for writes, CSRF on both.

## 4. API: `/admin/v1`

### 4.1 Shape and auth

- New `src/admin/admin-gateway.ts` (`AdminGateway`), registered on the same web server as a `prefix` route `/admin/v1` (`src/index.ts`), next to `/v1`. It reuses the gateway's `Authenticator`.
- Every request: `requireRole(await authenticate(req), 'agentry-admin')`. 401 `unauthenticated` without valid credentials; 403 `forbidden` without the role. Errors use the existing envelope in `src/errors.ts`.
- `auth.admin.enabled` (default `true`): `false` makes every `/admin/v1` path answer 404, like the sandbox service with no admin keys.
- 503 `store_unavailable` while the store is opening, as on `/v1`.
- Every call writes one `admin_audit` row **before** it answers (section 4.5). If the audit write fails, the call fails with 503 and returns no data.
- All writes are `POST` (house style of `/v1`; the web proxy only forwards POST and DELETE). The foundation spec's `PATCH /config/{entry_id}` becomes `POST /config/{ns}`.
- Lists use `{ object: 'list', data, has_more, next_cursor }`, like `/v1`.

### 4.2 Routes

| Method | Route | Result |
|---|---|---|
| `GET` | `/admin/v1/me` | `{ owner, roles }` of the caller (also lets the web app confirm the role) |
| `GET` | `/admin/v1/owners?cursor=&limit=` | Owners with `id`, `display_name`, `created_at`, `last_seen_at`, `session_count` |
| `GET` | `/admin/v1/sessions?owner=&agent=&status=&from=&to=&q=&cursor=&limit=` | Sessions across owners (4.3) |
| `GET` | `/admin/v1/sessions/{id}` | Index row, title, owner, agent, environment, redacted resolved setup (`body`), and the subagent tree from `traceSession` |
| `GET` | `/admin/v1/sessions/{id}/items?after=&limit=&order=` | Same shape as `/v1/agents/sessions/{id}/items` |
| `GET` | `/admin/v1/sessions/{id}/turns?after=&limit=&order=` | Same shape as `/v1/agents/sessions/{id}/turns` |
| `GET` | `/admin/v1/sessions/{id}/steps?turn=` | Steps (4.4) |
| `GET` | `/admin/v1/sessions/{id}/steps/{step_id}/request?attempt=` | Full model request of one attempt (4.4) |
| `GET` | `/admin/v1/sessions/{id}/log?after=&limit=&types=` | Raw Session events, paged by `seq` |
| `GET` | `/admin/v1/sessions/{id}/subagents/{child_id}/…` | `items`, `turns`, `steps`, `request`, `log` for a child session in the tree (same shapes) |
| `GET` | `/admin/v1/config` | Live settings forms (4.6) |
| `POST` | `/admin/v1/config/{ns}` | `{ revision, ops }` path edits (4.6) |
| `GET` | `/admin/v1/health` | Versions and dependency checks (4.7) |
| `GET` | `/admin/v1/audit?actor=&action=&from=&to=&cursor=&limit=` | Audit rows, newest first |

Why `items` and `turns` instead of the foundation spec's `messages`: the web app already renders `/v1` items and turns (cards, trajectory). Same shapes mean the admin session page reuses that code unchanged.

### 4.3 Session list and search

- Without `q`: `store.sessions.list({ owner: owner ?? 'any', agentId, status, from, to, cursor, limit })`. It already supports `'any'`.
- With `q`: `ctx.sessionQuery.searchSessions({ query: q, ... })`, then map DSH session ids back to index rows (`dshSessionId` equals `id` today, `src/gateway.ts`; add `store.sessions.byDshIds(ids)` so it stays right if they diverge). Hits for DSH sessions without an index row (child sessions, sessions made outside Agentry) are dropped. Filters still apply after mapping.
- Each row: `{ id, owner, owner_display_name, agent_id, environment_id, status, last_error, model, reasoning_effort, title, created_at, updated_at }`. `title` is the session metadata title from `body`, or `null`.

### 4.4 Steps and the full model request

New module `src/admin/request-reconstruction.ts`. Input: a session's raw events (`sessionQuery.readSession`). It never touches a live agent.

**Steps.** One pass over the events:

- Step boundaries: `step/start` and `step/end` (`{ turn, step }`). `step_id` = `t<turn>s<step>` (DSH numbers), stable and readable.
- Attempts: every `assistant/message` or `assistant/attempt` with that `{ turn, step }` is one attempt, in log order.
- Per step: `{ id, turn_id, turn, step, started_at, ended_at, model, provider, attempts: [{ index, outcome: 'message' | 'failed' | 'interrupted', seq, usage }], usage }`. Times come from event envelopes; `model` and `provider` from the `request/header` in force; `usage` from `assistant/message.usage`.
- `turn_id` maps DSH turn numbers to the wire turn ids the projector uses, so the web can link a step to its turn.

**Request of one attempt.** Let `cut` be the index of the attempt's `assistant/message` or `assistant/attempt` event.

1. `prefix = events.slice(0, cut)`.
2. `session = Session.create(id, prefix, header, inheritedEventCount, currentSessionMessageProjections)`.
3. `header = session.requestHeader()`; `messages = session.deriveMessages()`; `toolHistory = session.toolHistory()`; `context = session.requestContext()`.
4. Answer:

```json
{
  "object": "admin.model_request",
  "session_id": "…", "step_id": "t3s2", "attempt": 0, "seq": 1234,
  "model": "…", "provider": "…",
  "parameters": { "...header.config without model/provider": "…", "adapter_defaults": {} },
  "system": [ { "text": "…", "source": "…" } ],
  "context": [ { "text": "…" } ],
  "tools": [ { "name": "…", "description": "…", "parameters": {} } ],
  "tool_history": { "…": "…" },
  "messages": [ { "role": "system|developer|user|assistant|tool", "content": [] } ],
  "route": { "context_window": 0, "system_prompt_update": "…" }
}
```

`system` and `context` are views picked out of `messages` (system-role messages, and user messages whose `source.kind` is `runtime-context`) so the page can show them on their own tabs. `messages` stays the exact list the provider got. Images in messages are replaced by `{ type: 'image', ref, media_type, bytes }` (no inline bytes); the web fetches nothing for them in this round.

`?attempt=` defaults to the last attempt. A step without any attempt event (crash before the stream settled) answers 404 `request_not_recorded`.

**Spike first.** Task 1 of the plan proves the cut rule. Acceptance: a recorded multi-turn session with tool calls, a retried attempt and a compaction, run against a fake provider that captures each request; every rebuilt request deep-equals the captured one (minus `signal` and `sessionId`). If it fails, the fallback in the foundation spec section 6.2 applies (capture through DSH's model-request hook into a `model_requests` table) and AGENTS.md decision 7 is amended in the same change. Stop and ask the user before taking that branch.

**Cost.** A request read replays the log prefix once. Cache the last few replays per session by `(session id, log length)` in memory (LRU, size 8) so stepping through a session does not replay from zero every click. Logs of live sessions grow; the key changes and the cache misses, which is correct.

### 4.5 Audit

- One row per admin call: `actor` = caller's owner id, `action` = a fixed name per route (`owners.list`, `sessions.list`, `sessions.search`, `session.view`, `session.items`, `session.turns`, `session.steps`, `step.request`, `session.log`, `config.view`, `config.update`, `health.view`, `audit.view`), `target` = the session id, `<session>/<step>`, config `ns`, or the query string for lists (search text included, cut to 200 characters).
- Migration `0005-admin.sql`: `admin_audit` gains `detail jsonb null` (for config writes: the changed paths, never values) and an index on `(at desc)`; `owners` gains `display_name text null` and `last_seen_at timestamptz null`.
- No delete route. Retention is an open question (open question 5).

### 4.6 Live configuration

- Read: `ctx.settings.describe({ redactSecrets: true })`, mapped to `{ data: [{ ns, schema, value, base, user, revision, secrets }] }`. Secret fields arrive only as presence markers (`secrets`), never values. Only fields DSH marks live appear; everything else is read-only in files.
- Write: `POST /admin/v1/config/{ns}` with `{ revision, ops: [{ op: 'set', path, value } | { op: 'unset', path }] }` → `ctx.settings.mutate(ns, ops, revision)`. 409 `config_conflict` on `SettingsConflictError` (the page reloads the form); 400 `invalid_config` with the validation message when the full config check refuses; 404 for an unknown `ns`. The audit `detail` lists the paths.
- `settings` and `configEditor` are optional injects (`ctx.get('settings')`): when absent, `GET /config` answers `{ data: [], available: false }` and writes answer 503 `config_unavailable`.
- **Why not raw `configEditor` now:** `configuration()` returns secrets (API keys hashes, database URL, sandbox key, provider keys) and `edit()` can change `auth.mode` or drop the admin's own key from a browser. That needs its own design (field allow-list, secret redaction, restart handling). Open question 4.

### 4.7 Health

`GET /admin/v1/health`:

```json
{
  "api": { "version": "x.y.z" },
  "dsh": { "pin": "dsh-v0.2.2-rc.1" },
  "auth": { "mode": "production|apiKeys|development", "keycloak": "ok|unreachable|off" },
  "store": { "status": "ok|opening|failed", "error": null },
  "sandbox_service": { "status": "ok|unreachable|refused|off" },
  "local_sandbox": { "enforcement": "full|partial|unknown" },
  "sessions": { "in_progress": 0, "requires_action": 0, "interrupted": 0 }
}
```

`keycloak` is a JWKS fetch with a 3 s timeout. `sandbox_service` reuses the `sandbox` provider's availability check. `local_sandbox.enforcement` is read from the DSH sandbox service if it exposes it, else `unknown` (verify in Task 8).

### 4.8 Who-am-I for every user

`GET /v1/whoami` (any authenticated principal) → `{ owner, roles }`. The web app uses it at API-key sign-in to learn the key's roles. It is on `/v1`, not `/admin/v1`, because non-admins call it too. Added to `openapi/agentry.yaml`.

### 4.9 Owner display names

The `Principal` gains an optional `displayName`: Keycloak `preferred_username`, else `email`, else none; an API key's `name`; the dev key's owner. `store.ensureOwner(owner, displayName)` writes `display_name` and `last_seen_at` (at most once a minute per owner, kept in memory). Admin lists show the name with the id beside it.

### 4.10 Redaction

Admin responses pass through the same `src/redact.ts` helpers as `/v1` for session setup (`body`: MCP headers and env). The raw log and rebuilt requests are not redacted: they are what the model saw, which is the point of decision 8. Tool schemas carry no credentials (MCP headers are transport, not schema). Tool outputs can contain anything a tool printed; that is stated on the page (section 6).

## 5. Auth: who is an admin

### 5.1 Keycloak mode (`auth.mode: production`, or Keycloak tokens in the other modes)

- The realm role `agentry-admin`. The foundation spec (7.3) planned it in a realm import `deploy/keycloak/realm-agentry.json`, which does not exist yet in `dsh-agents-api/deploy/`; until it does, create the role by hand in the realm (README step). Give it to a user in Keycloak; it shows up in `realm_access.roles` on the next token.
- The API checks the role on every call. Removing the role takes effect when the user's access token expires (minutes), because the API reads roles from each token.

### 5.2 API-key mode (`auth.mode: apiKeys`)

- An admin is a key whose entry has `roles: [agentry-user, agentry-admin]` (made with `pnpm keys:create --name <n> --owner <o> --admin`). Nothing new to build in the API.
- Recommended practice (documented in the README): give an admin a **second, named admin key** for the same owner (`<name>-admin`), and keep their everyday key user-only. A leaked everyday key then cannot read everyone's chats. Revoke by removing the entry.
- `development` mode: the dev key is admin by default (`devKey.admin: true`). Keep it; it is never in production.
- Unlike the sandbox service, an admin key may also use `/v1` (it is a normal user too). Open question 1 asks whether to copy the sandbox rule instead.

### 5.3 Web app

- Keycloak mode: roles come from the token at sign-in (exists). On every token refresh, `refreshIfNeeded` re-reads `realm_access.roles` from the new access token and updates `identity.roles`, so a removed role disappears from the UI within one token lifetime.
- API-key mode: at sign-in, after the existing check call, the BFF calls `GET /v1/whoami` and stores `{ owner, roles }` in the identity. This also fixes the empty roles the user menu shows today.
- `isAdmin(identity)` = `identity.roles.includes('agentry-admin')`. It only decides what to **show**. The API is the authority: a stale `isAdmin` gets 403 from the API, which the BFF turns into 404 and clears nothing else.

## 6. Web app: the admin section

### 6.1 Routes and guard

- Pages under `app/(app)/admin/` share the app shell. `app/(app)/admin/layout.tsx` calls `requireAdminPage()` (new, `src/server/require-auth.ts`): signed out → `/login`; signed in but not admin → `notFound()`.
- The sidebar shows **Admin** (shield icon) above Settings only when `isAdmin(identity)`.
- A thin banner on every admin page: "Admin view. Read-only. Your views are logged." (Config shows "Changes apply live and are logged.")

| Route | Content |
|---|---|
| `/admin` | Overview: health cards (API, DSH pin, auth, store, sandbox service, local sandbox), counts of running, waiting and interrupted sessions, and the five newest audit rows |
| `/admin/sessions` | Table of all sessions: title, owner, agent, status, model, updated. Filters: owner (combobox from `/owners`), status, agent, date range. Search box (`q`). Cursor paging. Row click opens the session |
| `/admin/sessions/[id]` | Header: title, owner, agent, environment, model, status, created and updated. Tabs: **Conversation**, **Steps**, **Log**, **Setup** |
| `/admin/sessions/[id]/steps/[stepId]` | The model request viewer (6.3) |
| `/admin/users` | Owners table: display name, id, first seen, last seen, session count; row click → `/admin/sessions?owner=<id>` |
| `/admin/config` | Live settings (6.4) |
| `/admin/audit` | Audit table: time, actor, action, target; filters actor, action, dates |

### 6.2 Session page tabs

- **Conversation:** the existing conversation renderers fed by the admin `items` and `turns` routes, read-only: no composer, no approval buttons, no title menu. Polling instead of the SSE stream (every 5 s while the session is `in_progress` or `requires_action`; off otherwise). Subagent cards open the child's items from the admin subagent routes.
- **Steps:** one row per step: turn, step, model, attempts, input/output tokens, duration, outcome. Row click → request viewer.
- **Log:** the raw events, paged by `seq`, grouped by turn and step the way the DSH session inspector groups them (`session-log/groups.ts`): turn and step headers, stream chunks folded under their assistant message. Type filter. Each row expands to its JSON.
- **Setup:** the redacted resolved setup (`body`): agent, instructions, tools, environment, metadata.

### 6.3 Request viewer

Tabs: **Messages** (the exact list, one block per message with role, source and content; tool calls and results shown as in tool cards), **System prompt**, **Context**, **Tools** (name, description, JSON schema, folded), **Parameters**, **Raw JSON** (copy button). An attempt picker when a step has more than one attempt. Prev/next step buttons. Large text blocks start folded beyond 40 lines.

### 6.4 Config page

- One section per namespace, from the `schema` in each descriptor.
- Scalar fields get controls: switch (boolean), number field, text field, select (enum). Arrays and objects get a JSON text area validated on save. Secret fields show "set" or "not set" with a **Replace** button that opens a password field; the value is sent once and never shown again.
- Save sends only changed paths as `ops` with the namespace `revision`. 409 → "Changed elsewhere; reloaded" and the form reloads. Reset per field sends `unset`.

### 6.5 BFF

- New proxy `app/api/admin/[...path]/route.ts` → `${AGENTRY_API_URL}/admin/v1/…`, with its own allow-list `src/server/admin-allowlist.ts` (GET on every route in 4.2 except `me`, plus `POST config/{ns}`). Same rules as the `/v1` proxy: fresh upstream headers, path segments checked, CSRF and same-origin on POST.
- Before forwarding, the route checks `isAdmin(identity)`; not admin → 404. Upstream 403 → 404. Upstream 401 → the usual sign-out.
- Browser-side client `src/api/admin-client.ts` (`listAdminSessions`, `getAdminSession`, `listAdminItems`, …) mirroring `src/api/client.ts`.

### 6.6 Security

- Browsers never see an Agentry credential (unchanged). Admin data reaches the browser only through the BFF, only for admins.
- Server-side checks in three places: BFF route (role), API (role on every call), audit row per call.
- Config secrets never leave the API (settings redaction). The web never sends a full config section, only path ops, so a redacted secret cannot be erased by a save.
- Admin pages set `cache-control: no-store` and `referrer-policy: no-referrer` (already a security header), so other users' content does not linger in caches.
- Model requests and logs can hold anything users or tools wrote. The banner says so. There is no export or bulk download in this round.

## 7. Testing

API (Vitest, `DSH_ROOT` set):

- Reconstruction golden test: fake provider captures every request of a scripted session (two turns, a tool call, a retried attempt, a compaction, a system prompt change, a tool added mid-session); every rebuilt request equals the capture.
- Step listing from fixture logs: attempts, usage, ids, times.
- `AdminGateway`: 401, 403 for a user-only key, 404 when disabled, 503 while the store opens; every route writes exactly one audit row; audit failure fails the call.
- Session list across owners, search mapping (dropped child sessions), filters.
- Config: redacted read; mutate success, 409, 400, 404; a secret is never in a response.
- `/v1/whoami` for each auth mode; display name capture.
- OpenAPI: `/admin/v1` routes added to `openapi/agentry.yaml`; `AdminGateway.routeTable()` joins `routeSets()` in `tests/openapi-drift.spec.ts`.

Web (Vitest; one e2e at the end, before merge):

- Unit: admin allow-list; `isAdmin`; the admin proxy (non-admin → 404, upstream 403 → 404, CSRF on POST); API-key sign-in stores roles from `/v1/whoami`; Keycloak refresh updates roles; config ops diff (only changed paths, secrets never echoed).
- Component: sessions table and filters; session tabs with fixture items; steps table; request viewer tabs and attempt picker; log grouping; config form (scalar edits, JSON field, secret replace, 409 reload).
- e2e (mock API gains `/admin/v1` routes and an admin key): admin key signs in, sees Admin, opens a session, opens a step request; a user key gets 404 on `/admin`.

## 8. Delivery

Two repos, in order: API first (Tasks 1–9 of the plan), then web (Tasks 10–18). The plan is `docs/superpowers/plans/2026-11-26-agentry-admin.md`. Each repo updates its `CHANGELOG.md`; the API also writes `docs/changes/2026-11-26-admin-api.md`, a row in `docs/README.md`, and updates its `AGENTS.md` status.

## 9. Agentry Sandbox admin

Not merged into Agentry Admin in this round. `/admin` overview shows the sandbox service's reachability and, when `AGENTRY_WEB_SANDBOX_ADMIN_URL` is set, a link "Open sandbox admin" to its own page (`http://<sandbox host>/admin`, its own admin key). Bringing its sandboxes, places and limits into Agentry Admin would need the API to hold a sandbox **admin** key (`sandbox.adminKey`) and proxy `/v1/admin/*`; open question 6.

## 10. Open questions for the user

1. **Admin keys in API-key mode.** Keep roles on keys (an admin key also works as a normal user key, nothing new to build), or copy the sandbox rule (separate admin-only keys, refused on `/v1`)? Recommended: keep roles, document a second admin key per admin.
2. **Privacy notice to users.** Admins can read every chat and every model request. Should users be told (a line on the sign-in page or in Settings), and should an owner be able to see that an admin opened their chat (from the audit log)?
3. **Admin actions on sessions.** Read-only in this round. Do you want Stop (cancel a running turn) and Delete for any session now, or later?
4. **Non-live configuration.** Live fields through `dsh-settings` only in this round. Do you want a later round that edits other fields through `dsh-config-editor` with an allow-list and a "restart needed" notice, and which fields?
5. **Audit retention.** Keep audit rows forever, or prune after N days (config `admin.auditRetentionDays`)?
6. **Sandbox admin.** Link out to the sandbox service's own admin page (this spec), or bring sandboxes, places and limits into Agentry Admin through the API (needs a sandbox admin key in the API config)?
7. **Images in requests.** Show image references only (this spec), or also serve the image bytes to admins through an admin attachment route?
8. **Subagent and scheduled sessions in the list.** Child sessions appear only inside their parent's tree (this spec). Should scheduled-run sessions get a "scheduled" badge or filter?
