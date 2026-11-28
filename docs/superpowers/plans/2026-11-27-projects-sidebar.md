# Projects Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class owner-scoped Projects so sidebar chats can be grouped by reusable named contexts, one-off chats stay unfiled, and new chats can inherit a Project's agent and environment.

**Architecture:** Add a Project resource and session attachment to the Agentry API, then wire the web BFF/client and sidebar/NewChat UI to it. The API is the source of truth for Project identity, defaults, archive state, and filtering; the web keeps grouping pure and loads filtered session pages only for expanded Project sections.

**Tech Stack:** TypeScript, Next.js App Router, Postgres migrations, `@agentry/api` gateway/store, astryx components, StyleX layout glue, Vitest, OpenAPI contract tests.

**Spec:** `docs/superpowers/specs/2026-11-27-projects-sidebar-design.md`

## Global Constraints

- Browser JavaScript, storage, and requests to the web app never contain an Agentry access token, refresh token, or API key.
- Cookie `agentry_session`: `httpOnly`, `SameSite=Lax`, `Secure` in production when the request came over HTTPS (`X-Forwarded-Proto`; `AGENTRY_WEB_COOKIE_SECURE=always` forces it, decided 2026-11-25 so plain-HTTP deployments on a LAN address can sign in); secret `AGENTRY_WEB_SESSION_SECRET` ≥ 32 bytes, required at startup.
- `AGENTRY_WEB_AUTH` ∈ `keycloak` | `apikey`; keycloak mode requires `AGENTRY_WEB_KEYCLOAK_ISSUER`, `AGENTRY_WEB_KEYCLOAK_CLIENT_ID`, `AGENTRY_WEB_KEYCLOAK_CLIENT_SECRET`; `AGENTRY_API_URL` is required and server-only. Missing or invalid values fail startup with a named error (`ConfigError`).
- Proxy allow-list only (spec §5); other paths answer `404`. State-changing calls need same-origin plus an `x-agentry-csrf` header matching the session's CSRF token.
- Reconnect backoff: 1s doubling to a 30s cap; always resend `Last-Event-ID`.
- UI from astryx components and tokens; StyleX only for layout glue; no other CSS framework. Branding "Agentry"; no Anthropic name, logo, mark, licensed fonts, or exact colors.
- Exact dependency versions (no `^`/`~`) for astryx (`0.7.17`) and StyleX (`0.19.1`, including the `@stylexswc/*` compiler packages).
- Prefix shells with `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH` (Node 24, pnpm 11).
- Work on `develop`; `main` only via a `develop` → `main` PR.
- Update `CHANGELOG.md` with every behavior change (dated bullet).
- Never add `Co-Authored-By` or any AI attribution to commits or PRs.

## Review Focus

- **Archived, unknown, or foreign Project id:** starting a chat with such an id must not attach the chat; API answers 409 `project_archived` / 404 and web ignores the bad preset. Task 3 tests the API guards; Task 7 tests the NewChat preset.
- **One-off chats:** a chat created without a Project must stay `project_id: null` and appear under Recent/Unfiled date groups, not in a Project. Task 5 tests grouping; Task 6 tests sidebar rendering.
- **Explicit create overrides:** choosing a different agent/environment on a Project-started chat must win for that chat while keeping `project_id` on the session. Task 3 tests API precedence; Task 7 tests client payload.
- **Projects with history:** deleting a Project with sessions must return 409 `project_has_sessions`; archiving must hide the Project from active groups without hiding its sessions. Task 2 tests delete; Task 6 tests archive UI.
- **Pagination and cross-owner access:** Project session lists must filter before paging, and another owner's Project/session should look unknown. Task 1 tests store filters; Task 2 tests owner-scoped routes; Task 4 tests BFF allow-list.

---

## File Structure

API repository: `/home/mffaiz/code/dsh-agents-api`

- `src/store/migrations/0005-projects.sql` — `projects` table, session `project_id`, indexes.
- `src/types.ts` — `OAIProject`, Project create/update params, `project_id` on session wire types.
- `src/store/store.ts` / `src/store/postgres.ts` — owner-scoped `Store.projects`, session column plumbing.
- `tests/support/memory-store.ts` / `tests/store.spec.ts` — in-memory parity and store contracts.
- `src/gateway.ts` / new `src/session-project.ts` — Project routes, session defaults/precedence, move/filter.
- `tests/projects.spec.ts` / `tests/session-project.spec.ts` — gateway and pure helper coverage.
- `openapi/agentry.yaml` — Project schemas/routes and session `project_id`.
- `docs/changes/2026-11-27-projects.md`, `docs/README.md`, `CHANGELOG.md` — docs.

Web repository: this worktree

- `src/api/types.ts` / `src/api/client.ts` — Project types and client methods.
- `src/server/allowlist.ts` — `/agents/projects` proxy rules.
- `src/ui/shell/project-events.ts` — `PROJECTS_CHANGED` event.
- `src/ui/shell/project-groups.ts` — pure sidebar grouping helpers.
- `src/ui/shell/Sidebar.tsx` / `src/ui/shell/project-actions.tsx` — sidebar sections and dialogs.
- `src/ui/chat/NewChat.tsx` — `?project=` inheritance and create payload.
- `mock/agentry-mock.ts` — mock Projects and `project_id` filters.
- `tests/unit/**`, `tests/component/**` — tests; `CHANGELOG.md` — behavior log.

---

### Task 1: API Project storage and session column

**Files:**
- Create: `/home/mffaiz/code/dsh-agents-api/src/store/migrations/0005-projects.sql`
- Modify: `/home/mffaiz/code/dsh-agents-api/src/types.ts`
- Modify: `/home/mffaiz/code/dsh-agents-api/src/store/store.ts`
- Modify: `/home/mffaiz/code/dsh-agents-api/src/store/postgres.ts`
- Modify: `/home/mffaiz/code/dsh-agents-api/tests/support/memory-store.ts`
- Test: `/home/mffaiz/code/dsh-agents-api/tests/store.spec.ts`

**Interfaces:**
- Consumes: existing `OwnerId`, `OAIListResponse<T>`, `SessionIndexRow`, `SessionListQuery`, `OwnedCollection<T>`.
- Produces:
  - `OAIProject` with `id`, `object: 'project'`, `name`, `status: 'active' | 'archived'`, `pinned: boolean`, `agent_id: string | null`, `environment: OAIEnvironmentConfig | null`, `archived_at: number | null`, `created_at: number`, `updated_at: number`.
  - `ProjectListQuery` with `owner`, `status?: 'active' | 'archived' | 'all'`, `limit?: number`, `after?: string`, `order?: 'desc' | 'asc'`.
  - `Store.projects` with `create`, `get`, `update`, `delete`, `list`, `countSessions`.
  - `SessionIndexRow.projectId: string | null`, `SessionListQuery.projectId?: string | null`.

- [ ] **Step 1: Write the failing store tests**

In `tests/store.spec.ts`, add a `describe('projects')` block with tests named:
- `creates and reads a project within its owner`
- `treats another owner's project as absent`
- `lists active, archived and all projects with correct paging`
- `counts sessions attached to a project`
- `filters sessions by projectId without dropping later pages`

Use `store.projects.create()`, `store.projects.get()`, `store.projects.list()`, `store.sessions.insert()` and `store.sessions.list()` directly. Assert that archived Projects are excluded from `status: 'active'` and included in `status: 'all'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run from `/home/mffaiz/code/dsh-agents-api`:

```bash
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
pnpm exec vitest run tests/store.spec.ts -t projects
```

Expected: FAIL with missing `projects` property / type errors.

- [ ] **Step 3: Add the migration and types**

Create `0005-projects.sql` with:
- `create table projects (id text primary key, owner_id text not null references owners(id), body jsonb not null, name text not null, status text not null default 'active', pinned boolean not null default false, archived_at timestamptz, created_at timestamptz not null, updated_at timestamptz not null)`.
- Indexes `projects_owner_created_idx` and `projects_owner_status_pinned_created_idx`.
- `alter table sessions add column project_id text references projects(id)`.
- Index `sessions_owner_project_created_idx` on `(owner_id, project_id, created_at desc)`.

Add the exact interfaces from the Interfaces block to `src/types.ts` and the session fields to `SessionIndexRow` / `SessionListQuery`.

- [ ] **Step 4: Implement the store collection**

In `src/store/store.ts`, add `ProjectCollection` and `Store.projects`; include `projects` in `guardStore()`. In `src/store/postgres.ts`, add a `PROJECTS` owned-table spec with copied columns `name`, `status`, `pinned`, a custom `list()` that applies `status` before cursor/limit, `countSessions()`, and `project_id` in the session columns/insert/list. In `tests/support/memory-store.ts`, mirror the same contract.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
pnpm exec vitest run tests/store.spec.ts
```

Expected: PASS, including the new `projects` block.

- [ ] **Step 6: Commit**

```bash
cd /home/mffaiz/code/dsh-agents-api
git add src/store/migrations/0005-projects.sql src/types.ts src/store/store.ts src/store/postgres.ts tests/support/memory-store.ts tests/store.spec.ts
git commit -m "feat(store): add projects and session project_id"
```

---

### Task 2: API Project CRUD routes

**Files:**
- Modify: `/home/mffaiz/code/dsh-agents-api/src/gateway.ts`
- Test: `/home/mffaiz/code/dsh-agents-api/tests/projects.spec.ts`
- Modify: `/home/mffaiz/code/dsh-agents-api/openapi/agentry.yaml`
- Modify: `/home/mffaiz/code/dsh-agents-api/docs/changes/2026-11-27-projects.md` (create)
- Modify: `/home/mffaiz/code/dsh-agents-api/docs/README.md`
- Modify: `/home/mffaiz/code/dsh-agents-api/CHANGELOG.md`

**Interfaces:**
- Consumes: `Store.projects`, `ProjectListQuery`, `OAIProject` from Task 1.
- Produces:
  - `POST /v1/agents/projects`
  - `GET /v1/agents/projects`
  - `GET /v1/agents/projects/{project_id}`
  - `POST /v1/agents/projects/{project_id}`
  - `POST /v1/agents/projects/{project_id}/archive`
  - `POST /v1/agents/projects/{project_id}/unarchive`
  - `DELETE /v1/agents/projects/{project_id}`
  - Error codes: 400 `bad_request`, 404 `resource_not_found`, 409 `project_has_sessions`.

- [ ] **Step 1: Write failing gateway tests**

Create `tests/projects.spec.ts` using the existing gateway test harness with two owners. Add tests named:
- `creates a project with name agent environment and pinned`
- `rejects an empty project name`
- `answers 404 for another owner's project`
- `updates name agent environment and pinned without losing other fields`
- `archives and unarchives a project`
- `deletes an empty project`
- `refuses to delete a project with sessions`

Assert delete-with-sessions returns status 409 and body code `project_has_sessions`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
pnpm exec vitest run tests/projects.spec.ts
```

Expected: FAIL with 404 `Cannot POST /agents/projects`.

- [ ] **Step 3: Implement Project routes**

Register the literal `/agents/projects` route group in `src/gateway.ts` before `/agents/:agent_id`. Implement handlers with existing `json`, `badRequest`, and `notFound` helpers. Create answers 201; update/archive/unarchive answer 200 with the updated `OAIProject`; delete answers `{ id, object: 'project.deleted', deleted: true }`. Foreign and unknown ids both answer 404. Delete checks `store.projects.countSessions(owner, id) > 0` before deleting.

- [ ] **Step 4: Update OpenAPI and docs**

Add Project paths/schemas to `openapi/agentry.yaml`, including `Project`, `CreateProjectRequest`, `UpdateProjectRequest`, and `ProjectListResponse`. Add a dated CHANGELOG bullet, a `docs/README.md` Changes row, and `docs/changes/2026-11-27-projects.md` describing the owner-scoped model and delete refusal.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
pnpm exec vitest run tests/projects.spec.ts tests/openapi-drift.spec.ts tests/openapi-contract.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/mffaiz/code/dsh-agents-api
git add src/gateway.ts tests/projects.spec.ts openapi/agentry.yaml docs/changes/2026-11-27-projects.md docs/README.md CHANGELOG.md
git commit -m "feat(api): add project routes"
```

---

### Task 3: API session project attachment and defaults

**Files:**
- Create: `/home/mffaiz/code/dsh-agents-api/src/session-project.ts`
- Modify: `/home/mffaiz/code/dsh-agents-api/src/types.ts`
- Modify: `/home/mffaiz/code/dsh-agents-api/src/gateway.ts`
- Modify: `/home/mffaiz/code/dsh-agents-api/src/session-resource.ts`
- Modify: `/home/mffaiz/code/dsh-agents-api/src/history/projector.ts`
- Modify: `/home/mffaiz/code/dsh-agents-api/src/session-registry.ts`
- Test: `/home/mffaiz/code/dsh-agents-api/tests/session-project.spec.ts`
- Test: `/home/mffaiz/code/dsh-agents-api/tests/projects.spec.ts`
- Modify: `/home/mffaiz/code/dsh-agents-api/openapi/agentry.yaml`

**Interfaces:**
- Consumes: `OAIProject`, `Store.projects`, `SessionIndexRow.projectId` from Tasks 1–2.
- Produces:
  - `resolveProjectDefaults(body: CreateSessionParams, project: OAIProject): CreateSessionParams`
  - `CreateSessionParams.project_id?: string | null`
  - `UpdateSessionParams.project_id?: string | null`
  - `OAIAgentSession.project_id: string | null`
  - `GET /v1/agents/sessions?project_id=<id>`
  - `POST /v1/agents/sessions/{id}` accepting `project_id`
  - Error code: 409 `project_archived`.

- [ ] **Step 1: Write failing pure helper tests**

Create `tests/session-project.spec.ts` with tests named:
- `uses project agent and environment when request omits them`
- `keeps explicit agent and environment over project defaults`
- `normalizes a null project id to unfiled`

Assert exact field values, especially that explicit `body.agent_id` and `body.environment` are unchanged.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
pnpm exec vitest run tests/session-project.spec.ts
```

Expected: FAIL because `src/session-project.ts` does not exist.

- [ ] **Step 3: Implement the pure helper and wire types**

Create `src/session-project.ts` exporting `resolveProjectDefaults`. Add `project_id` to `CreateSessionParams`, `UpdateSessionParams`, `OAIAgentSession`, `SessionConfig`, and `ProjectionBase` with the exact types in the Interfaces block. Update `sessionFromRow()`, `WireProjector.snapshot()`, and `SessionRegistry.applyConfig()` to carry `project_id`.

- [ ] **Step 4: Write failing gateway integration tests**

Append to `tests/projects.spec.ts`:
- `creates a session on a project using its defaults`
- `keeps explicit create overrides while attaching the project`
- `refuses a session on an archived project`
- `moves a session into a project and back to unfiled`
- `lists sessions by project_id with pagination`

- [ ] **Step 5: Implement gateway session integration**

In `POST /agents/sessions`, load `project_id` from the request, require owner-scoped active Project, call `resolveProjectDefaults()`, and store `projectId` in the session index insert. Archived Projects answer 409 `project_archived`. In `POST /agents/sessions/{id}`, accept `project_id?: string | null` and validate non-null values as active owner-scoped Projects. In `GET /agents/sessions`, parse `project_id` and pass `projectId` to `store.sessions.list()`.

- [ ] **Step 6: Update OpenAPI**

Add `project_id` to `CreateSessionRequest`, `UpdateSessionRequest`, `AgentSession`, and the session list query. Add the `project_archived` 409 response to session create.

- [ ] **Step 7: Run tests to verify they pass**

```bash
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
pnpm exec vitest run tests/session-project.spec.ts tests/projects.spec.ts tests/openapi-drift.spec.ts tests/openapi-contract.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /home/mffaiz/code/dsh-agents-api
git add src/session-project.ts src/types.ts src/gateway.ts src/session-resource.ts src/history/projector.ts src/session-registry.ts tests/session-project.spec.ts tests/projects.spec.ts openapi/agentry.yaml
git commit -m "feat(api): attach sessions to projects"
```

---

### Task 4: Web BFF allow-list and API client

**Files:**
- Modify: `src/api/types.ts`
- Modify: `src/api/client.ts`
- Modify: `src/server/allowlist.ts`
- Create: `src/ui/shell/project-events.ts`
- Test: `tests/unit/allowlist-projects.spec.ts`
- Test: `tests/unit/api-client-projects.spec.ts`

**Interfaces:**
- Consumes: API routes from Tasks 2–3.
- Produces:
  - Web `OAIProject`, `CreateProjectParams`, `UpdateProjectParams` matching the API wire shape.
  - `listProjects(params?)`, `getProject(id)`, `createProject(params)`, `updateProject(id, params)`, `archiveProject(id)`, `unarchiveProject(id)`, `deleteProject(id)`, `setSessionProject(id, projectId)`.
  - `listSessions({ projectId })` and `createSession({ projectId })`.
  - `PROJECTS_CHANGED = 'agentry:projects-changed'`, `announceProjects()`, `useProjectChanges()`.

- [ ] **Step 1: Write failing allow-list tests**

Create `tests/unit/allowlist-projects.spec.ts` with tests named:
- `allows project read and state-changing proxy paths`
- `rejects unknown project paths and methods`
- `requires csrf for project state changes`

Assert `GET /agents/projects`, `POST /agents/projects`, `GET /agents/projects/p_1`, `POST /agents/projects/p_1/archive`, `POST /agents/projects/p_1/unarchive`, `DELETE /agents/projects/p_1` are allowed; `PATCH /agents/projects/p_1` and `GET /agents/projects/p_1/nope` are not.

- [ ] **Step 2: Write failing client tests**

Create `tests/unit/api-client-projects.spec.ts` with tests named:
- `lists projects with status and paging params`
- `creates and deletes projects with csrf header`
- `lists sessions by projectId`
- `creates a session with projectId`
- `moves a session to a project and to unfiled`

Mock `fetch`; assert the URL path, query keys (`status`, `after`, `limit`, `project_id`), JSON body, `credentials: 'same-origin'`, and `x-agentry-csrf` header.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
pnpm exec vitest run tests/unit/allowlist-projects.spec.ts tests/unit/api-client-projects.spec.ts
```

Expected: FAIL with missing exports/paths.

- [ ] **Step 4: Implement types, client, allow-list, and events**

Add the exact types/methods from the Interfaces block. In `src/server/allowlist.ts`, add `projects` to `RESERVED_AGENT_IDS` and explicit rules for the paths from Step 1. In `src/ui/shell/project-events.ts`, follow the `SKILLS_CHANGED` pattern: a string constant, `announceProjects()`, and `useProjectChanges()`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
pnpm exec vitest run tests/unit/allowlist-projects.spec.ts tests/unit/api-client-projects.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/types.ts src/api/client.ts src/server/allowlist.ts src/ui/shell/project-events.ts tests/unit/allowlist-projects.spec.ts tests/unit/api-client-projects.spec.ts
git commit -m "feat(api-client): add projects client and proxy rules"
```

---

### Task 5: Web pure sidebar grouping helpers

**Files:**
- Create: `src/ui/shell/project-groups.ts`
- Test: `tests/unit/project-groups.spec.ts`

**Interfaces:**
- Consumes: web `OAIProject` and `OAIAgentSession` from Task 4.
- Produces:
  - `isUnfiledSession(session: OAIAgentSession): boolean`
  - `groupSessionsForSidebar(projects: OAIProject[], sessions: OAIAgentSession[], now?: Date): SidebarSection[]`
  - `SidebarSection = { type: 'project'; project: OAIProject; sessions: OAIAgentSession[] } | { type: 'date'; title: string; sessions: OAIAgentSession[] }`
  - Date titles reuse the existing `Today`, `Yesterday`, `Previous 7 days`, `Previous 30 days`, `Older` values from `src/ui/shell/group.ts`.

- [ ] **Step 1: Write failing tests**

Create `tests/unit/project-groups.spec.ts` with tests named:
- `puts pinned projects before active projects`
- `keeps project sections in project list order and sessions newest first`
- `places unfiled sessions in date buckets`
- `does not place a project session in recent date buckets`
- `treats a null project_id as unfiled`

Use fixed timestamps and deterministic Project ids.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
pnpm exec vitest run tests/unit/project-groups.spec.ts
```

Expected: FAIL because `src/ui/shell/project-groups.ts` does not exist.

- [ ] **Step 3: Implement the helpers**

Create `src/ui/shell/project-groups.ts`. Reuse or mirror the date-bucket logic in `src/ui/shell/group.ts`; do not change existing `groupSessions()` behavior. Sort pinned Projects before non-pinned within their original `projects` order. Sort sessions by `created_at` descending.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
pnpm exec vitest run tests/unit/project-groups.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/shell/project-groups.ts tests/unit/project-groups.spec.ts
git commit -m "feat(sidebar): add project grouping helpers"
```

---

### Task 6: Sidebar project sections and actions

**Files:**
- Modify: `src/ui/shell/Sidebar.tsx`
- Create: `src/ui/shell/project-actions.tsx`
- Test: `tests/component/sidebar.spec.tsx`

**Interfaces:**
- Consumes: `listProjects`, `listSessions({ projectId })`, `setSessionProject`, `PROJECTS_CHANGED` from Task 4; `groupSessionsForSidebar` from Task 5.
- Produces:
  - `ProjectDialog` for create/edit with fields `name`, `agent_id`, `environment`, `pinned`.
  - `MoveProjectDialog` with options Unfiled plus active Projects.
  - Sidebar sections in this order: pinned Projects, active Projects, Starred, Recent/Unfiled.
  - Archived menu/dialog that lists archived Projects with Unarchive actions.

- [ ] **Step 1: Write failing sidebar component tests**

Add to `tests/component/sidebar.spec.tsx`, with mocked API responses:
- `renders pinned and active project sections before starred and recent`
- `loads filtered sessions only when a project section is expanded`
- `moves a chat to a project and back to unfiled`
- `hides an archived project from active sections`
- `links new chat here to /?project=<id>`
- `shows one-off chats under recent date groups`

Assert section text/order, mock call args (`project_id` query), and that row menus contain the exact action labels.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
pnpm exec vitest run tests/component/sidebar.spec.tsx
```

Expected: FAIL because project sections do not exist.

- [ ] **Step 3: Implement project actions and sidebar sections**

Create `src/ui/shell/project-actions.tsx` with astryx `Dialog`, `TextInput`, `Selector`, `Button`, and `MoreMenu`; follow `session-actions.tsx` for optimistic events and rollback/toast. Modify `Sidebar.tsx` to load active Projects on mount and on `PROJECTS_CHANGED`, keep the global paged session list for Recent/Starred/search, and load `listSessions({ projectId })` only for expanded project sections. Render pinned/active sections above Starred and Recent.

- [ ] **Step 4: Run astryx self-check and tests**

```bash
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
pnpm exec astryx doctor --built src/ui/shell
pnpm exec vitest run tests/component/sidebar.spec.tsx
```

Expected: doctor clean; tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/shell/Sidebar.tsx src/ui/shell/project-actions.tsx tests/component/sidebar.spec.tsx
git commit -m "feat(sidebar): group chats by project"
```

---

### Task 7: NewChat project inheritance

**Files:**
- Modify: `src/ui/chat/NewChat.tsx`
- Test: `tests/component/new-chat-seed.spec.tsx`

**Interfaces:**
- Consumes: `getProject(id)`, `createSession({ projectId })`, web `OAIProject` from Task 4.
- Produces: `?project=<id>` preset that preselects Project agent/environment/model/effort and sends `project_id` on create.

- [ ] **Step 1: Write failing NewChat tests**

Add tests named:
- `preselects agent environment model and effort from a project preset`
- `keeps explicit agent and environment overrides while sending projectId`
- `ignores an archived project preset`
- `creates an unfiled chat when no project preset is present`

Mock `getProject`, `listAgents`, `listEnvironments`, and `createSession`. Assert the Composer selection and the exact `createSession` payload.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
pnpm exec vitest run tests/component/new-chat-seed.spec.tsx
```

Expected: FAIL because `?project=` is ignored.

- [ ] **Step 3: Implement the preset**

In `NewChat.tsx`, read `project` from `useSearchParams()` once using the existing preset-clearing pattern. Load the Project after projects/agents/environments are available. If absent or `status !== 'active'`, ignore it. Otherwise preselect `agent_id`, `environment`, `model`, and `reasoning.effort` from the saved agent or current defaults. Pass `projectId` into `api.createSession()` while leaving the user's visible Agent/Environment selectors able to override.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
pnpm exec vitest run tests/component/new-chat-seed.spec.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/chat/NewChat.tsx tests/component/new-chat-seed.spec.tsx
git commit -m "feat(chat): start new chats from projects"
```

---

### Task 8: Mock API, docs, and whole-feature verification

**Files:**
- Modify: `mock/agentry-mock.ts`
- Modify: `CHANGELOG.md` (web)
- Modify: `/home/mffaiz/code/dsh-agents-api/CHANGELOG.md` if not already complete
- Test: `tests/component/sidebar.spec.tsx`
- Test: `tests/component/new-chat-seed.spec.tsx`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a mock API that can create/list/get/update/archive/unarchive/delete Projects and honor `project_id` on session create/list/update.

- [ ] **Step 1: Write failing mock tests**

Extend the existing component tests with one case that starts from an empty mock, creates a Project through the web client, starts a chat from `?project=<id>`, and asserts the chat is listed by `GET /agents/sessions?project_id=<id>`. Extend another case where a one-off chat is not returned by that filtered list.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
pnpm exec vitest run tests/component/sidebar.spec.tsx tests/component/new-chat-seed.spec.tsx
```

Expected: FAIL because the mock has no Project routes.

- [ ] **Step 3: Implement mock Projects**

In `mock/agentry-mock.ts`, add Project records with status/pinned/agent/environment and routes for all Project endpoints. Make `list()` honor `project_id` as well as existing `metadata[...]` filters. Preserve `body.project_id` on session create and update. Keep `/__mock/reset` clearing Projects.

- [ ] **Step 4: Run full verification**

Web:

```bash
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
pnpm typecheck
pnpm test
pnpm build
```

API:

```bash
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
cd /home/mffaiz/code/dsh-agents-api
pnpm typecheck
pnpm test
```

Expected: all clean.

- [ ] **Step 5: Manual live check**

With the mock or a live API: create Project “Website work” pinned with a saved agent and sandbox; start a chat from it; confirm agent/environment preselected; send a message; confirm the chat appears under the Project; move it to Unfiled; confirm it appears under Recent; archive the Project; confirm it leaves active sections but can be unarchived.

- [ ] **Step 6: Docs and commit**

Add a dated CHANGELOG bullet in both repos if not already present. Commit any remaining mock/docs changes:

```bash
git add mock/agentry-mock.ts tests/component/sidebar.spec.tsx tests/component/new-chat-seed.spec.tsx CHANGELOG.md
git commit -m "test(mock): cover project grouping flow"
```

```bash
cd /home/mffaiz/code/dsh-agents-api
git add CHANGELOG.md docs/changes/2026-11-27-projects.md docs/README.md
git commit -m "docs: describe projects resource"
```

---

## Self-review notes

- Each spec section has a task: data model/API in Tasks 1–3, BFF/client in Task 4, sidebar grouping/UX in Tasks 5–6, NewChat inheritance in Task 7, mock/docs/verification in Task 8.
- The Review Focus items are pinned by tests in Tasks 1–7; cross-owner and pagination are covered in the store/gateway tasks.
- Type names are consistent across tasks: `OAIProject`, `ProjectListQuery`, `project_id` / `projectId`, `resolveProjectDefaults`, `PROJECTS_CHANGED`.
- No task includes a full implementation transcript; code blocks only pin files, signatures, routes, and exact assertions.
