# Projects sidebar (2026-11-27)

Status: proposed 2026-11-27. Awaiting design approval. This spec covers both repositories: Agentry Web in this worktree and the Agentry API in `~/code/dsh-agents-api`. A chronological decision log is kept at `docs/superpowers/reviews/2026-11-27-projects-sidebar-review-log.md`.

## Why

Creating a web chat currently means choosing an agent and workspace/environment every time. The sidebar groups chats only by date, so repeated work has no durable home. The user asked for a DeepSeek-like grouping by environment/project, with the long-term goal of named Projects that remember their context.

The design target chosen in conversation is a **minimal full Projects slice**, not temporary environment-only grouping and not a metadata shortcut.

## Decisions already made

- Long-term target: **first-class Projects**. A Project is a named, owner-scoped record with a default agent and environment/workspace. New chats from a Project inherit those defaults; per-chat overrides remain available.
- First slice: **minimal full Projects**. Build the real model end to end, but keep project management in sidebar dialogs rather than adding a full Projects page.
- Everyday vs one-time use: **unfiled recents**. One-off chats do not create a Project. They stay in Recent/Unfiled and can be promoted into a Project later. Everyday Projects can be pinned.
- Mid-chat agent/environment changes remain out of scope. The current input event wire supports only model and effort changes for a running session. Overrides happen at creation time.
- Existing chats start unfiled. No automatic backfill or inferred projects in the first slice.

## Goals / non-goals

### Goals

- Group sidebar chats by Project, with pinned Projects first and one-off chats under Recent/Unfiled.
- Let a user create, rename, pin, archive, and delete Projects from the sidebar.
- Let a user start a chat from a Project and inherit its saved agent, environment, model, and effort.
- Let a user override agent/environment while creating that chat without changing the Project.
- Let a user move an existing chat into a Project or back to Unfiled.
- Keep owner scoping, BFF allow-listing, CSRF, and existing metadata/star behavior intact.

### Non-goals

- No official DeepSeek imitation beyond the useful grouping idea; official DeepSeek web does not appear to have first-class Projects.
- No project hierarchy/folders, tags, sharing, or team-owned Projects.
- No separate “one-time Project kind”; one-off chats are simply unfiled.
- No automatic archive after inactivity.
- No mid-chat agent/environment switch.
- No deleting a reusable sandbox environment when its Project is deleted.
- No changing the chat reducer, stream reducer, or first-send handoff.

## Approaches considered

- **Environment-only sidebar sections.** Fast and backend-free, but not a real Project, cannot remember an agent, and would be replaced later. Rejected.
- **Metadata-only Projects.** Uses `metadata.project_id` and browser-local project definitions. Cheap, but renaming/moving is awkward and defaults are not durable/cross-device. Rejected.
- **Minimal full Projects slice.** Chosen. Adds a real owner-scoped Project resource, with the smallest useful UI surface.

## UX design

### Sidebar sections

The sidebar keeps its existing Starred smart view and date grouping, with these changes:

1. **Pinned projects** — one collapsible `SideNavSection` per pinned active Project, newest chat first.
2. **Projects** — one collapsible `SideNavSection` per other active Project, newest chat first.
3. **Starred** — unchanged smart view backed by `metadata[starred]=true`. Starred chats may also appear in their Project section so the Project view stays complete.
4. **Recent / Unfiled** — the current `Today`, `Yesterday`, `Previous 7 days`, `Previous 30 days`, and `Older` buckets, containing only sessions with no `project_id`.
5. **Archived projects** — reachable from a “Archived” menu/dialog in the sidebar, not as permanent sidebar sections.

Each Project section header has a `MoreMenu` with: New chat here, Rename, Pin/Unpin, Archive, Delete. A top-level “New project” action opens a small `Dialog`.

Search shows a flat list of matching sessions across loaded Project, Starred, and Recent groups. This avoids confusing partial sections during search.

### Everyday vs one-time chats

- Starting a chat from `/` with no `?project=` leaves it `project_id: null`. It appears under Recent/Unfiled.
- Starting from a Project section, a Project row action, or `?project=<id>`, attaches the chat to that Project.
- A chat can be promoted into a Project later from its sidebar row `MoreMenu` → “Move to project…”, or moved back to “Unfiled”.
- Archiving removes a Project from the active sidebar but keeps its chats and history. Archived Projects can be unarchived. New chats cannot start on an archived Project.

### New chat inheritance

`NewChat.tsx` gains a `?project=<id>` preset alongside the existing `?environment=` preset. When present:

1. Load the Project with `api.getProject(id)`.
2. Preselect `project.agent_id` in the Agent selector. If it is null, keep the current default agent behavior.
3. Preselect `project.environment` in the Environment selector. If it is null, use the current default workspace behavior.
4. Preselect the saved agent's model and effort, or the current defaults when there is no saved agent.
5. Send `project_id` in `api.createSession()`.

If the user changes Agent or Environment before sending, that override applies only to the new chat; the Project record is not changed.

### Project management dialogs

Use astryx `Dialog`, `TextInput`, `Selector`, `Switch`/checkbox equivalent, and `Button` components. A Project form has:

- Name (required, non-empty after trim).
- Default agent: “Default agent” plus saved agents.
- Environment: “Default workspace” plus existing sandbox environments.
- Pinned toggle.

Delete is refused by the API while the Project has sessions. Archive is preferred for finished Projects with history.

## Data model

### Project record (API wire)

```ts
interface OAIProject {
  id: string
  object: 'project'
  name: string
  status: 'active' | 'archived'
  pinned: boolean
  agent_id: string | null
  environment: OAIEnvironmentConfig | null
  archived_at: number | null
  created_at: number
  updated_at: number
}
```

`environment` uses the existing `OAIEnvironmentConfig` shape. `null` means default workspace. A Project binds at most one reusable environment in this slice.

### Session attachment

- `SessionIndexRow` gains `projectId: string | null`.
- `OAIAgentSession` gains `project_id: string | null`.
- `CreateSessionParams` gains `project_id?: string | null`.
- `UpdateSessionParams` gains `project_id?: string | null` so a chat can move between a Project and Unfiled.
- `SessionListQuery` gains `projectId?: string | null`; the list endpoint accepts `?project_id=<id>`.

A null `project_id` means Unfiled. Existing sessions are unfiled; no backfill.

### Precedence on session create

1. If `project_id` is absent or null: resolve agent/environment exactly as today.
2. If `project_id` is present: load the Project, require it to be owner-scoped and active, then:
   - use request `agent_id`/`agent` if supplied, otherwise `project.agent_id`;
   - use request `environment` if supplied, otherwise `project.environment`;
   - store `project_id` on the session.

The web sends explicit preselected values, so the user's visible overrides win naturally. The backend still applies its own defaults if a caller omits them.

### Migration

Add `~/code/dsh-agents-api/src/store/migrations/0005-projects.sql`:

- `projects` table: `id`, `owner_id`, `body jsonb`, `name`, `status`, `pinned`, `archived_at`, `created_at`, `updated_at`.
- Indexes for `(owner_id, created_at desc)` and `(owner_id, status, pinned, created_at desc)`.
- `sessions.project_id text references projects(id)` with an index on `(owner_id, project_id, created_at desc)`.

Keep mutable fields in `body jsonb` following the existing owned-resource convention; copy `name`, `status`, and `pinned` into columns for filtering/sorting.

## API design

Add `projects` to `Store`, `guardStore()`, the Postgres store, and the memory store used in tests.

Routes, registered before `/agents/:agent_id`:

- `POST /v1/agents/projects` — create; 201 with `OAIProject`.
- `GET /v1/agents/projects?status=active|archived|all&limit=&after=` — owner-scoped list.
- `GET /v1/agents/projects/{project_id}` — get.
- `POST /v1/agents/projects/{project_id}` — partial update of name/agent/environment/pinned.
- `POST /v1/agents/projects/{project_id}/archive` — set `status=archived`, `archived_at`.
- `POST /v1/agents/projects/{project_id}/unarchive` — restore `status=active`.
- `DELETE /v1/agents/projects/{project_id}` — 409 `project_has_sessions` if any session references it; otherwise delete.
- `GET /v1/agents/sessions?project_id=<id>` — sessions in a Project.
- `POST /v1/agents/sessions/{id}` with `project_id` — move a session into a Project or back to Unfiled.

Foreign and unknown Project ids answer 404. Archived Projects answer 409 `project_archived` on new-session create. Deleting a Project does not delete its environment.

Update `openapi/agentry.yaml` for all Project routes/schemas, `project_id` on session create/update/get, and the session list query parameter. The OpenAPI drift/contract tests must pass.

## Web design

### Client and BFF

- Add `OAIProject`, `CreateProjectParams`, and `UpdateProjectParams` to `src/api/types.ts`.
- Add `listProjects`, `createProject`, `getProject`, `updateProject`, `archiveProject`, `unarchiveProject`, `deleteProject`, and `setSessionProject` to `src/api/client.ts`.
- Extend `listSessions()` with `projectId` and `createSession()` with `projectId`.
- Add `projects` to `RESERVED_AGENT_IDS` and allow-listed CRUD rules in `src/server/allowlist.ts`. The existing catch-all proxy supplies auth and CSRF.
- Add a `PROJECTS_CHANGED` window event following the `SKILLS_CHANGED` pattern.

### Sidebar data loading

- Load active Projects on mount and on `PROJECTS_CHANGED`.
- Keep the global paged session list for Recent/Unfiled and search.
- For each expanded Project section, load sessions with `api.listSessions({ projectId })`; paginate that section independently with a small “More” control. Do not load every Project's sessions on mount.
- On `SESSIONS_CHANGED`, reload the affected Project list and the global Recent list. Plain changes reload the first page, matching today's behavior.
- Grouping helpers move to `src/ui/shell/group.ts` or a sibling pure module so they can be unit-tested without rendering.

### Files likely touched

Web:

- `src/ui/shell/Sidebar.tsx`
- `src/ui/shell/group.ts`
- `src/ui/shell/project-actions.tsx` (new: event, dialogs, row menu additions)
- `src/ui/chat/NewChat.tsx`
- `src/api/client.ts`, `src/api/types.ts`
- `src/server/allowlist.ts`
- `tests/component/sidebar.spec.tsx`, `tests/component/new-chat-seed.spec.tsx`
- `tests/unit/` for pure grouping helpers
- `mock/agentry-mock.ts` for Projects and `project_id` filters
- `CHANGELOG.md`

API:

- `src/store/store.ts`, `src/store/postgres.ts`, `src/store/migrations/0005-projects.sql`
- `src/types.ts`, `src/gateway.ts`, `src/session-resource.ts`, `src/history/projector.ts`, `src/session-registry.ts`
- `openapi/agentry.yaml`
- `tests/store.spec.ts`, `tests/support/memory-store.ts`, new `tests/projects.spec.ts`
- `docs/changes/2026-11-27-projects.md`, `docs/README.md`, `CHANGELOG.md`

Astryx conventions apply: use `SideNavSection`, `SideNavItem`, `MoreMenu`, `Dialog`, `Selector`, `TextInput`, and tokens; no raw `<div>`, `className`, hex, or px. Read component props with `pnpm exec astryx component <Name>` before implementation, and run `astryx doctor --built` before delivery.

## Tests and verification

### API

- Project CRUD create/list/get/update/delete, owner-scoped 404s, archive/unarchive, archived new-session refusal, delete refusal with sessions.
- Session create with `project_id` uses Project defaults; explicit agent/environment overrides win.
- Session move with `project_id` update, including null → Unfiled.
- `GET /agents/sessions?project_id=` pagination.
- Store contract tests for the new collection and session column on memory and Postgres.
- OpenAPI drift and contract tests.

### Web

- Pure grouping tests: pinned/active project sections, unfiled date groups, starred interaction, search flattening.
- Sidebar component tests: project sections, expanded-section filtered loading, move to project/unfiled, project row actions, archive hides section.
- NewChat tests: `?project=` preselects agent/environment/model, `createSession` carries `project_id`, overrides do not mutate the Project.
- BFF allow-list tests for `/agents/projects` GET/POST/DELETE and CSRF state-changing rules.
- Mock API updated so component/e2e tests can create/list/filter Projects.

### Commands

- Both repos: typecheck + full Vitest suite.
- Web: `pnpm build`; e2e if the Projects flow is added to the mock e2e suite.
- Manual check in a real browser: create a Project from the sidebar, start a chat from it, confirm the agent/environment are preselected, confirm the chat appears under the Project, move it to Unfiled, archive the Project, and confirm Recent is unaffected.

## Risks

- **Pollution of active sidebar:** if every chat created a Project, the sidebar would fill up. Mitigated by unfiled recents; Projects are explicit.
- **Environment lifecycle:** Project environments are reusable and survive Project deletion. Users must delete them from the Sandboxes page if unwanted.
- **Archive with live sessions:** archived Projects keep their sessions; they only block new chats. Moving a session out remains allowed.
- **Inheritance correctness:** the web must preselect the saved agent's model/effort or omit explicit values; otherwise a Project could appear to remember an agent while overriding its model with a global default.
- **Pagination:** project sections must not issue a request per Project on mount; only expanded sections load filtered sessions.
- **Star duplication:** Starred is a smart view; a starred chat can appear both in Starred and in its Project. This is intentional and should be documented in UI copy/tests.

## Follow-ups after this slice

- Full `/projects` management page with search and Archived view.
- Automatic archive rules for inactive Projects.
- Project-level model/effort defaults independent of saved agents.
- Moving a running chat's Project without changing its agent/environment.
- Project-scoped tools/permissions or environment templates.
