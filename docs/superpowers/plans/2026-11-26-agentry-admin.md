# Agentry Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins see every session, its conversation, the full model request of every step, the raw Session log, live configuration and service health, from an Admin section in Agentry Web. Every admin call is audited. Non-admins cannot reach any of it.

**Spec:** `docs/superpowers/specs/2026-11-26-agentry-admin-design.md`. Section numbers below (§) refer to it.

**Architecture:**
- API (`~/code/dsh-agents-api`): a new `AdminGateway` on prefix `/admin/v1`, same web server and `Authenticator` as `/v1`, requiring the `agentry-admin` role. Requests are rebuilt offline from the DSH Session log with `Session.create` over a log prefix (`requestHeader()`, `deriveMessages()`, `toolHistory()`). Live configuration goes through `ctx.settings`. Audit rows go to the existing `admin_audit` table.
- Web (`agentry-web`): pages under `app/(app)/admin/`, a separate BFF proxy `app/api/admin/[...path]` with its own allow-list, and an `isAdmin` check that only decides what to show (the API decides access).

**Tech stack:** TypeScript, Cordis plugin, Vitest, Postgres (Testcontainers) in the API; Next.js App Router, astryx `0.7.17`, StyleX, Vitest, Playwright in the web app.

**Model per task:** each task says **Sonnet** (clear, mechanical, well covered by tests) or **Opus** (judgement on DSH seams, security, or reuse of tricky UI). Per the user's memory notes: implementers on Sonnet unless marked Opus; no per-task reviews; one final review; e2e only right before merge.

## Global Constraints

- Never edit `~/code/dsh-pinned` or `~/code/deepseek-harness`. Read them freely. `export DSH_ROOT=/home/mffaiz/code/dsh-pinned` for every API command.
- Toolchain: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH`. API checks: `pnpm typecheck && pnpm vitest run`. Web checks: `pnpm typecheck && pnpm vitest run --no-file-parallelism`.
- Work on `develop` (or a branch off it). Commit as `fakhrulfaiz <fakhrulfaiz2003@gmail.com>`. No `Co-Authored-By` or any AI attribution in commits, PRs or code comments.
- Every behaviour change: a dated bullet at the top of `## Unreleased` in that repo's `CHANGELOG.md`. API route changes also update `openapi/agentry.yaml` in the same commit (drift test).
- Admin routes never return a secret: session setup goes through `src/redact.ts`; config through `settings.describe({ redactSecrets: true })`.
- Audit before answer: every `/admin/v1` call writes its audit row first; a failed audit write fails the call (503) with no data.
- Browser never sees an Agentry credential. Admin data reaches the browser only through the admin BFF route, only for admins.
- Web UI: astryx components and tokens only; read props with `pnpm exec astryx component <Name>`; no raw `<div>`, `className`, `style` or hex.
- Write the failing test first in every task.

## Review Focus (final review)

1. The rebuilt request equals the provider's request for every attempt, including retries, compaction and a system prompt change (Task 1).
2. No `/admin/v1` route answers without the admin role or without an audit row (Task 5).
3. No secret in any admin response: MCP headers in `body`, settings secrets, API keys (Tasks 6, 8).
4. The web never shows admin pages or data to a non-admin, even with a stale cookie (Tasks 11, 12).
5. A config save never erases a redacted secret (Tasks 8, 17).

---

## Part A: Agentry API (`~/code/dsh-agents-api`)

### Task 1: Spike and golden test: rebuild a step's request from the log — **Opus**

Proves §4.4's cut rule before anything depends on it.

**Files:**
- Create `src/admin/request-reconstruction.ts`: `rebuildRequest(sessionId, events, header, inheritedEventCount, cut): RebuiltRequest`.
- Create `tests/admin/request-reconstruction.spec.ts`.
- Create `tests/support/capturing-llm.ts`: a fake `llm` service whose `stream(request)` records a deep clone of the request and replays a scripted answer.

**Interfaces:**
- `RebuiltRequest = { config: LlmCallConfig; adapterDefaults?: …; tools?: ToolSchema[]; messages: Message[]; toolHistory: ToolHistory; context?: RequestContext }`.
- Use `Session.create(id, prefix, header, inheritedEventCount, currentSessionMessageProjections)` from `@deepseek-ai/dsh-session` and `@deepseek-ai/dsh-session-format-catalog` (check the exact export path; add it to `tsconfig` paths and `peerDependencies` if missing).

- [ ] Read `packages/core/agent-loop/src/agent.ts` (`step()`, `buildRequest()`) and `packages/test-support/agent-loop-testkit` (`mountAgentLoopTestHarness`). Decide how to run a real agent loop in a test with the capturing `llm` (verify: the loop calls `ctx.llm.stream`, or `preparedCall.stream` when a route prepares the call; capture both).
- [ ] Write the failing golden test. Scripted session: turn 1 with a tool call and its result; turn 2 where the first attempt throws a retryable error and the second succeeds; a forced compaction; a system prompt change between turns; a tool added mid-session. For each captured request `k`, find attempt `k` in the log (`assistant/message` or `assistant/attempt`, in order), rebuild with `cut` = that event's index, and `expect(rebuilt).toEqual(captured)` (drop `signal` and `sessionId`).
- [ ] Implement `rebuildRequest`. Run the test until green.
- [ ] If it cannot pass: stop. Write what differs into this task's notes and ask the user before taking the fallback in §4.4 (capture table and an AGENTS.md decision 7 amendment).
- [ ] Commit: `feat(admin): rebuild a step's model request from the Session log`.

### Task 2: Steps and attempts from a log — **Sonnet**

**Files:**
- Modify `src/admin/request-reconstruction.ts`: add `listSteps(events, turnIds): AdminStep[]` and `attemptCut(events, turn, step, attempt?): number | undefined`.
- Create `tests/admin/steps.spec.ts` with small hand-written event arrays (no agent loop).

**Interfaces:** `AdminStep` and the attempt shape exactly as §4.4 ("Steps"). `step_id = t<turn>s<step>`. `turnIds: Map<number, string>` maps DSH turn numbers to wire turn ids (get them from the projector in Task 7).

- [ ] Failing tests: one step one message; a step with a failed then a good attempt; an interrupted message (`interrupted: true` → outcome `interrupted`); usage summed per step; `started_at`/`ended_at` from `step/start`/`step/end` envelope times; model/provider from the last `request/header` before the attempt; an open step (no `step/end`) has `ended_at: null`; `attemptCut` defaults to the last attempt and returns `undefined` for a step without attempts.
- [ ] Implement; tests green; commit.

### Task 3: Migration 0005 and store additions — **Sonnet**

**Files:**
- Create `src/store/migrations/0005-admin.sql`: `alter table owners add column display_name text, add column last_seen_at timestamptz`; `alter table admin_audit add column detail jsonb`; `create index admin_audit_at on admin_audit (at desc)`.
- Modify `src/store/store.ts`, `src/store/postgres.ts`, `tests/support/memory-store.ts`.
- Modify `tests/store.spec.ts`.

**Interfaces (add to `Store`):**
- `ensureOwner(owner, displayName?)`: also sets `display_name` when given and changed, and `last_seen_at = now()`.
- `owners.list({ cursor, limit }): { data: OwnerRow[]; nextCursor }` with `OwnerRow = { id, displayName, createdAt, lastSeenAt, sessionCount }`, newest `last_seen_at` first.
- `sessions.byDshIds(ids): Map<string, SessionIndexRow>`.
- `audit({ actor, action, target, detail? })` (detail optional).
- `auditLog.list({ actor?, action?, from?, to?, cursor?, limit }): { data: AuditRow[]; nextCursor }`, newest first.

- [ ] Failing store tests (Postgres via `tests/support/postgres.ts`) and the same cases against `MemoryStore`.
- [ ] Implement; migrations from empty still pass; commit.

### Task 4: Display names and `GET /v1/whoami` — **Sonnet**

**Files:**
- Modify `src/auth/authenticator.ts` (`Principal.displayName?: string`), `src/auth/keycloak.ts` (`preferred_username`, else `email`), `src/auth/api-keys.ts` (entry `name`), `src/auth/static-key.ts` (owner).
- Modify `src/gateway.ts`: `dispatch()` passes `principal.displayName` to `ensureOwner`, throttled to once a minute per owner (in-memory map); add route `GET /whoami` → `{ owner, roles: [...] }`.
- Modify `openapi/agentry.yaml` (`/whoami`).
- Tests: `tests/auth.spec.ts`, `tests/api-keys.spec.ts`, `tests/gateway.spec.ts`.

- [ ] Failing tests: display name per authenticator; `whoami` for a user key, an admin key, the dev key; `ensureOwner` called with the name at most once a minute.
- [ ] Implement; drift and contract tests green; commit.

### Task 5: `AdminGateway` core: auth, switch, audit, `me`, `health` — **Opus**

**Files:**
- Create `src/admin/admin-gateway.ts`: class `AdminGateway` with `handle(req, res)`, `routeTable()`, a small route matcher (reuse the one in `src/gateway.ts` if it can be shared without changing `/v1` behaviour; otherwise copy it).
- Create `src/admin/health.ts`: `adminHealth(deps): Promise<AdminHealth>` (§4.7).
- Modify `src/index.ts`: config `auth.admin.enabled` (default `true`) in `Config` and its `z` schema; register `ctx.webServer.register({ kind: 'prefix', path: '/admin/v1', handler })` next to `/v1`; give the admin gateway the store once open (same path the `/v1` gateway gets it).
- Create `tests/admin/admin-gateway.spec.ts`.

**Behaviour:**
- `requireRole(await authenticate(req), 'agentry-admin')`; 401/403 as `/v1` does (`rejectAuth`).
- `enabled: false` → 404 `not_found` for every path, before auth.
- Store not open → 503 `store_unavailable`.
- Each route declares its `action` and a `target(params, url)`. The gateway writes `store.audit(...)` before calling the handler; on audit failure → 503, handler not called.
- `GET /me` → `{ owner, roles }`. `GET /health` → §4.7 (Keycloak JWKS fetch with 3 s timeout; sandbox provider availability from the `SandboxRegistry`; enforcement level `unknown` unless DSH exposes it; read the API version from `package.json` and the pin from `dsh.pin`).

- [ ] Failing tests: no token 401; user-only key 403; admin key 200; disabled 404 even with an admin key; 503 while opening; exactly one audit row per call with the right action and target; audit throws → 503 and handler not run; health shape with stubbed checks.
- [ ] Implement; commit.

### Task 6: Session routes: list, search, detail, items, turns, subagents — **Sonnet**

**Files:**
- Create `src/admin/sessions.ts` (handlers), registered in `AdminGateway`.
- Create `tests/admin/sessions.spec.ts` (use `MemoryStore` and `tests/support/fake-session-query.ts`; extend the fake with `searchSessions` and `traceSession`).

**Behaviour:** §4.2 and §4.3.
- List: query params validated (bad `status`, dates, `limit` > 100 → 400 `invalid_request`); `store.sessions.list({ owner: owner ?? 'any', … })`; rows mapped to the §4.3 shape with `owner_display_name` (one `owners` lookup per page) and `title` from `body.metadata.title`.
- Search: `q` → `sessionQuery.searchSessions`, map with `store.sessions.byDshIds`, drop unknown ids, apply the other filters, page with the search cursor.
- Detail: index row + `redactSessionConfig(body)` (add to `src/redact.ts` if no helper covers `SessionConfig`) + `traceSession` tree mapped to `{ id, agent_name, status, children }`.
- Items and turns: build the same `ProjectionBase` the `/v1` routes build from the row, then call `history.items` / `history.turns`. Same query params and shapes as `/v1`.
- Subagents: `…/subagents/{child_id}/items|turns` only when `child_id` is in the tree of `{id}`, else 404.

- [ ] Failing tests for each route, including another owner's session visible to the admin, MCP header masked in `body`, search dropping a child session, unknown id 404.
- [ ] Implement; commit.

### Task 7: Steps, request and log routes, with a replay cache — **Sonnet**

**Files:**
- Create `src/admin/steps.ts` (handlers) and `src/admin/replay-cache.ts` (LRU of 8 keyed by `sessionId + ':' + events.length`).
- Modify `tests/admin/sessions.spec.ts` or create `tests/admin/steps-routes.spec.ts`.

**Behaviour:**
- `GET …/steps?turn=`: `sessionQuery.readSession(dshSessionId)` → `listSteps` (Task 2). `turnIds` from folding the log with the existing projector (`history.fold(base)`; read its turn id per DSH turn number, add a small accessor to `WireProjector` if needed).
- `GET …/steps/{step_id}/request?attempt=`: parse `t<n>s<m>` (else 404); `attemptCut`; `rebuildRequest` (Task 1); map to the §4.4 JSON: `system` and `context` views, images as references. 404 `request_not_recorded` when no attempt.
- `GET …/log?after=&limit=&types=`: events with `seq > after`, up to `limit` (default 200, max 1000), optional type filter (comma list, literal types); `{ object: 'list', data: [{ seq, type, time, data }], has_more, next_cursor }`.
- Child sessions: the same three routes under `…/subagents/{child_id}/`.

- [ ] Failing tests: step listing on a fixture log; request JSON shape and the image reference replacement; bad step id 404; log paging and filter; the cache returns the same object for the same length and misses after an append.
- [ ] Implement; commit.

### Task 8: Live configuration routes — **Sonnet**

**Files:**
- Create `src/admin/config.ts`; register `GET /config` and `POST /config/{ns}`.
- Create `tests/admin/config.spec.ts` with a fake `settings` service.

**Behaviour:** §4.6. `ctx.get('settings')` at call time; absent → `{ data: [], available: false }` and 503 `config_unavailable` on write. Body `{ revision: number, ops: SettingsPathOp[] }` validated (op is `set`/`unset`, `path` non-empty string array); `SettingsConflictError` → 409 `config_conflict` with `{ expected, actual }`; validation error → 400 `invalid_config` with its message; unknown ns → 404. Audit `detail = { paths: [...] }`, never values.

- [ ] Failing tests: redacted read (a secret value in the fake never appears in the JSON); write success; 409; 400; 404; audit detail has paths only.
- [ ] Implement; commit.

### Task 9: OpenAPI, docs, changelog — **Sonnet**

**Files:**
- Modify `openapi/agentry.yaml`: every `/admin/v1` route and schema (`AdminSession`, `AdminStep`, `AdminModelRequest`, `AdminLogEvent`, `AdminConfigEntry`, `AdminHealth`, `AdminAuditRow`, `AdminOwner`).
- Modify `tests/openapi-drift.spec.ts`: add `{ prefix: '/admin/v1', routes: admin.routeTable() }` to `routeSets()`.
- Create `docs/changes/2026-11-26-admin-api.md`; add its row to `docs/README.md`; add `/admin/v1` to `docs/http-api.md`.
- Modify `README.md`: admin access per auth mode (§5.1, §5.2), including the "second admin key" practice and creating the realm role by hand.
- Modify `AGENTS.md` Status; `CHANGELOG.md`.

- [ ] Drift and contract tests fail first (routes missing from the spec), then pass.
- [ ] Full suite green; commit.

---

## Part B: Agentry Web (`~/code/agentry-web`)

### Task 10: Roles in the identity — **Sonnet**

**Files:**
- Modify `app/api/auth/apikey/route.ts`: after the check call, `GET /v1/whoami`; set `identity = { owner, roles, displayName: owner }`; fall back to today's identity when `whoami` answers 404 (older API).
- Modify `src/server/keycloak.ts` / `src/server/require-auth.ts`: when `refreshIfNeeded` returns a new token, recompute `identity` with `identityFromTokens` and save it.
- Create `src/server/roles.ts`: `ADMIN_ROLE = 'agentry-admin'`, `isAdmin(identity)`.
- Modify `src/server/require-auth.ts`: `requireAdminPage()` (signed out → `/login`, not admin → `notFound()`).
- Tests: `tests/unit/auth-apikey.spec.ts`, `tests/unit/keycloak-refresh.spec.ts`, new `tests/unit/roles.spec.ts`.

- [ ] Failing tests: admin key stores `agentry-admin`; user key does not; `whoami` 404 falls back; a refreshed token without the role drops it from the identity; `requireAdminPage` redirects and 404s.
- [ ] Implement; CHANGELOG bullet; commit.

### Task 11: Admin BFF proxy and allow-list — **Sonnet**

**Files:**
- Create `src/server/admin-allowlist.ts` (same matcher style as `src/server/allowlist.ts`): GET on `owners`, `sessions`, `sessions/{s}`, `sessions/{s}/items|turns|steps|log`, `sessions/{s}/steps/{step}/request`, `sessions/{s}/subagents/{c}/items|turns|steps|log`, `sessions/{s}/subagents/{c}/steps/{step}/request`, `config`, `health`, `audit`; POST on `config/{ns}`. `step` matches `^t\d+s\d+$`; `ns` matches `^[A-Za-z0-9_.-]+$`.
- Create `app/api/admin/[...path]/route.ts`: allow-list → `requireCredential()` → `isAdmin` else 404 → CSRF + same-origin on POST → fetch `${apiUrl}/admin/v1${path}${search}` with fresh headers → upstream 403 becomes 404, 401 signs out (reuse `relay` / `signedOut` from `src/server/upstream.ts`). Responses `cache-control: no-store`.
- Modify `src/server/agentry.ts`: `agentryAdminUrl(path, search)`.
- Tests: `tests/unit/admin-allowlist.spec.ts`, `tests/unit/admin-proxy.spec.ts` (pattern of `tests/unit/proxy.spec.ts`).

- [ ] Failing tests: allowed and refused paths (dot segments, `%`, unknown routes); non-admin 404 without an upstream call; POST without CSRF 403; upstream 403 → 404; query passes through.
- [ ] Implement; commit.

### Task 12: Admin API client and types — **Sonnet**

**Files:**
- Create `src/api/admin-types.ts` (wire types from §4: `AdminSession`, `AdminSessionDetail`, `AdminStep`, `AdminModelRequest`, `AdminLogEvent`, `AdminConfigEntry`, `AdminHealth`, `AdminAuditRow`, `AdminOwner`, list envelope).
- Create `src/api/admin-client.ts`: `listAdminSessions(filters)`, `getAdminSession(id)`, `listAdminItems(id, q, child?)`, `listAdminTurns`, `listAdminSteps`, `getAdminRequest(id, stepId, attempt?, child?)`, `listAdminLog(id, q, child?)`, `listAdminOwners`, `getAdminConfig`, `updateAdminConfig(ns, revision, ops)` (sends `x-agentry-csrf` like `src/api/client.ts`), `getAdminHealth`, `listAdminAudit`.
- Test: `tests/unit/admin-client.spec.ts` (URLs, query encoding, CSRF header on POST, error mapping).

- [ ] Failing tests; implement; commit.

### Task 13: Shell entry, admin layout, overview page — **Sonnet**

**Files:**
- Modify `src/ui/shell/Sidebar.tsx`: `SideNavItem` "Admin" (shield icon from the existing icon set) above Settings when `isAdmin(identity)`; selected on `/admin*`.
- Create `app/(app)/admin/layout.tsx`: `requireAdminPage()`; banner (astryx `Banner` or `Alert`, read its props) "Admin view. Read-only. Your views are logged."; sub-navigation tabs Overview, Sessions, Users, Config, Audit (`ViewTabs` pattern in `src/ui/shell/ViewTabs.tsx`).
- Create `app/(app)/admin/page.tsx` + `src/ui/admin/AdminOverview.tsx`: health rows (StatusDot + label), session counts, five newest audit rows.
- Tests: `tests/component/admin-overview.spec.tsx`, sidebar case in an existing shell spec or a new `tests/component/admin-nav.spec.tsx`.

- [ ] Start from `pnpm exec astryx build "admin overview with health status rows and recent activity"`; keep the template frame.
- [ ] Failing component tests: Admin item hidden for a user, shown for an admin; overview renders each health state and the audit rows.
- [ ] Implement; `pnpm exec astryx doctor --built src/ui/admin`; commit.

### Task 14: Sessions, Users and Audit tables — **Sonnet**

**Files:**
- Create `app/(app)/admin/sessions/page.tsx` + `src/ui/admin/AdminSessions.tsx`: Table with title, owner (name and id), agent, status, model, updated; filters (owner combobox from `listAdminOwners`, status select, agent text, date range); search field (debounced 300 ms) → `q`; cursor paging ("Load more"); filters kept in the URL query.
- Create `app/(app)/admin/users/page.tsx` + `src/ui/admin/AdminUsers.tsx`.
- Create `app/(app)/admin/audit/page.tsx` + `src/ui/admin/AdminAudit.tsx`.
- Tests: `tests/component/admin-sessions.spec.tsx`, `admin-users.spec.tsx`, `admin-audit.spec.tsx`.

- [ ] Failing tests: rows render; a filter change updates the URL and the request; search sends `q`; load more appends; row click goes to the session (users → sessions filtered by owner).
- [ ] Implement; doctor; commit.

### Task 15: Admin session page: Conversation, Steps, Setup tabs — **Opus**

Needs care: the conversation renderers today assume a live, owned session (stream, composer, approvals, `useRouter`).

**Files:**
- Create `app/(app)/admin/sessions/[id]/page.tsx` + `src/ui/admin/AdminSession.tsx` (header + tabs).
- Create `src/ui/admin/AdminConversation.tsx`: loads items and turns through the admin client, feeds the existing reducer (`src/chat/reducer.ts`) the same way history load does in `src/chat/use-conversation.ts`, and renders with `TurnGroup` / `Message` / `ToolCard` / `SubagentCard`. Read-only: no composer, approval and question cards show their state without buttons (add a `readOnly` prop where a card has actions; default `false` so chat is unchanged). Poll every 5 s while the status is `in_progress` or `requires_action`.
- Create `src/ui/admin/AdminSteps.tsx` (Table: turn, step, model, attempts, tokens in/out, duration, outcome; row → step page).
- Create `src/ui/admin/AdminSetup.tsx` (reuse `src/ui/trajectory/JsonView.tsx` for the redacted `body`).
- Tests: `tests/component/admin-session.spec.tsx` with `tests/fixtures/live/` items; existing chat specs must stay green.

- [ ] Failing tests: conversation renders fixture items with no composer and no action buttons; polling starts and stops with status; steps table; setup JSON shows `***` for masked headers.
- [ ] Implement; full web suite green (chat unchanged); commit.

### Task 16: Log tab and request viewer — **Sonnet**

**Files:**
- Create `src/ui/admin/log-groups.ts`: pure grouping of `AdminLogEvent[]` into turn → step → events, assistant stream chunks folded under their message (rules from DSH `packages/experimental/session-inspector/src/client/views/session-log/groups.ts`; copy logic only where needed and keep DeepSeek's MIT notice in the file if substantial code is copied).
- Create `src/ui/admin/AdminLog.tsx`: grouped list, type filter, expand row → `JsonView`, "Load more" by `seq`.
- Create `app/(app)/admin/sessions/[id]/steps/[stepId]/page.tsx` + `src/ui/admin/RequestViewer.tsx`: tabs Messages, System prompt, Context, Tools, Parameters, Raw JSON; attempt picker; prev/next step; long blocks folded beyond 40 lines; copy button on Raw JSON.
- Tests: `tests/unit/admin-log-groups.spec.ts`, `tests/component/admin-log.spec.tsx`, `tests/component/request-viewer.spec.tsx`.

- [ ] Failing tests: grouping (open step without end, chunks under their block, events outside a turn stay at root); viewer tabs show the right parts; attempt picker reloads; prev/next links.
- [ ] Implement; doctor; commit.

### Task 17: Config page — **Opus**

Schema-driven form with redacted secrets; the risk is erasing a secret or sending a whole section.

**Files:**
- Create `src/ui/admin/config-ops.ts`: `diffOps(schema, original, edited): SettingsPathOp[]` (only changed leaf paths; arrays and objects edited as JSON become one `set` on their path; secret fields only when replaced).
- Create `app/(app)/admin/config/page.tsx` + `src/ui/admin/AdminConfig.tsx`: one section per `ns`; controls by schema type (Switch, number field, TextField, Select; JSON TextArea with validation for arrays and objects); secrets "set" / "not set" + Replace (password field); per-field Reset (`unset`); Save sends `{ revision, ops }`; 409 → notice and reload; 400 → the message under the form.
- Tests: `tests/unit/config-ops.spec.ts`, `tests/component/admin-config.spec.tsx`.

- [ ] Read the real descriptor shape first: `packages/settings/settings/src/schema.ts` (form projection) and `types.ts`; note which schema node kinds occur and handle unknown kinds as read-only JSON.
- [ ] Failing tests: unchanged form sends no ops; one scalar change sends one `set`; a secret never appears in ops unless replaced; JSON field invalid blocks save; 409 reloads.
- [ ] Implement; doctor; commit.

### Task 18: Mock API, e2e, docs — **Sonnet**

**Files:**
- Modify `mock/agentry-mock.ts`: `/v1/whoami`; `/admin/v1/*` for the routes the pages use, fed by fixtures; an admin key and a user key.
- Create `tests/e2e/admin.spec.ts`: admin key signs in → Admin in the sidebar → sessions → a session → Steps → a request; user key → `/admin` is 404 and no Admin item.
- Modify `README.md` (admin section: how to become admin in each mode), `AGENTS.md` Status (F2 implemented), `CHANGELOG.md`.

- [ ] Write the e2e spec; run it once, right before merge (memory rule); everything else on Vitest.
- [ ] Commit.

---

## Order and parallelism

- Part A first: 1 → 2 → 3 → 4 → 5 → (6, 7, 8 in parallel) → 9.
- Part B can start once Task 9's OpenAPI is in (types follow it): 10 → 11 → 12 → 13 → (14, 15, 16, 17 in parallel, different files) → 18.
- One final review across both repos (Review Focus above), one fix wave, no re-review.
