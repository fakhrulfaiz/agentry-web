# Projects sidebar — working review log

Purpose: give a later reviewer/full-review Claude a chronological record of the decisions, research, and design work for the sidebar grouping / Projects feature. This is a log, not the approved design. No product code has been changed for Projects yet.

## 2026-11-27 — request and framing

- User request: the sidebar is hard to use because every web chat requires choosing an agent and workspace again; they asked to look at how DeepSeek web groups chats by environment/project, and to "group it by that first." They were unsure whether an agent should still need to be selected.
- Skill used: `brainstorming`. No implementation was started before design approval.
- First response to user: reported that official DeepSeek web does not appear to have first-class Projects; most "group by project" behavior comes from a Chrome extension/feature request. Reported that Agentry sessions have `environment`, `agent`, and `metadata`, but no `project` field; default local chats have unique workspace directories and default-agent chats have generated ids with `name: null`.
- Asked the user to define whether a group is a named reusable environment/project record or just automatic sidebar sections derived from existing environment data.

## 2026-11-27 — long-term direction

- User asked: "for long term?"
- Recommended long-term target: first-class Projects. A Project is a named group that remembers a default agent and environment/workspace; sidebar groups chats by project; new chats from a project inherit context; per-chat overrides remain.
- Offered three long-term choices: Full Projects, metadata projects, auto environment only.
- User selected: **Full Projects (Recommended)**.

## 2026-11-27 — delivery approach

- Laid out three ways to get there:
  1. Minimal full Projects slice (recommended): real Project resource first, small but end-to-end.
  2. Environment grouping first, Projects later: fastest, but temporary and does not solve agent/workspace repetition.
  3. Metadata Projects MVP: cheap shortcut, not the long-term model.
- User selected: **Minimal full Projects (Recommended)**.
- Current design target: first-class Projects with id/name/owner/default agent/environment binding, sessions attached to a project, sidebar grouped by project, NewChat from a project inherits defaults, and creation-time overrides still available. Mid-chat agent/environment changes remain out of scope because the wire contract only supports mid-chat model/effort changes.

## 2026-11-27 — exploration: sidebar/web integration

Read-only subagent exploration (session `ses_de444b28bffd4zCYM2lbBajSqp`) of Agentry Web. Key findings:

- Sidebar: `src/ui/shell/Sidebar.tsx` loads paged sessions and a separate starred list, filters by search, calls `groupSessions()` from `src/ui/shell/group.ts`, and renders sections `Starred`, `Today`, `Yesterday`, `Previous 7 days`, `Previous 30 days`, `Older`. Project sections would slot between Starred and date groups.
- NewChat: `src/ui/chat/NewChat.tsx` reads URL presets (`?seed`, `?schedule`, `?prompt`, `?environment=`), loads models/agents/environments/providers/templates, and creates a session with `api.createSession({ text, model, files, agentId?, environmentId? })`. A `?project=` preset and project-default resolution would fit here.
- Composer: `src/ui/chat/Composer.tsx` shows Agent and Environment selectors only for new chats; open chats only have model/effort. Per-chat override is therefore a creation-time concern in the minimal slice.
- Client/types: `src/api/client.ts` already supports metadata filtering, `metadata_merge`, agents CRUD, schedules CRUD, and CSRF; `src/api/types.ts` has list/agent/session types but no project types.
- BFF: `src/server/allowlist.ts` has `RESERVED_AGENT_IDS` and explicit proxy rules; adding `/agents/projects` requires adding `projects` and CRUD rules. The catch-all route already handles auth/CSRF/relay.
- Session actions: `src/ui/shell/session-actions.tsx` has `SESSIONS_CHANGED`, optimistic Star/Rename/Delete, and dialogs. Moving a chat between projects can reuse `api.updateMetadata(id, { project_id })` and `announceSessions({ id, metadata })`.
- Tests/mock: `tests/component/sidebar.spec.tsx`, `tests/component/new-chat-seed.spec.tsx`, and `mock/agentry-mock.ts` are the relevant places; the mock currently ignores `metadata[...]` filters.
- Astryx: use `SideNavSection`/`SideNavItem`, `Selector`, `MoreMenu`, `Dialog`, `EntityCard`/table templates; no raw divs/hex/px. Read astryx component props before implementation.

## 2026-11-27 — exploration: API resource design

Read-only subagent exploration (session `ses_de444b28bffeEZCF5NXSW0whiy`) of `~/code/dsh-agents-api`. Key findings:

- No Project resource exists. Storage is Postgres with forward-only migrations in `src/store/migrations/`; next would be `0005-projects.sql`.
- `Store` in `src/store/store.ts` has owner-scoped collections for agents/templates/environments and an indexed sessions collection. A `projects` collection should be added there and to `guardStore()`.
- Route registration in `src/gateway.ts` is order-sensitive; `/agents/projects` must be registered before `/agents/:agent_id`.
- Sessions are created in `POST /agents/sessions` via `provisionSession()`. `SessionConfig` is `{ agent, environment, metadata, vault_ids }`; `SessionIndexRow` has agent/environment ids but no project id. Adding `project_id` requires store columns, wire type changes, and projector/snapshot updates if exposed on the wire.
- Session list supports `metadata[key]=value` filters and could also support a `project_id` query filter. Existing `metadata_merge` is atomic but is for metadata only.
- Projects should be owner-scoped with CRUD similar to agents/environments. Archive state should be a real field, not just metadata, if filtering must be correct across pages.
- Minimal backend shape: `projects` table with `id`, `owner_id`, `name`, `status`, `archived_at`, `body jsonb`, timestamps; `sessions.project_id` nullable FK and index. Project record can hold `default_agent_id` and an `environment`/workspace binding.
- Suggested API routes: create/list/get/update/delete plus archive/unarchive. Archived projects refuse new sessions; delete should refuse when sessions exist to avoid hard-delete cleanup.
- Tests: new `tests/projects.spec.ts`, extend `tests/store.spec.ts`, memory store, OpenAPI drift/contract specs, `openapi/agentry.yaml`, `docs/changes/2026-11-27-projects.md`, and CHANGELOG.
- Important inheritance caveat: the web client currently sends explicit `agent.model` on create; if a Project is supposed to inherit a saved agent's model, the web must omit that explicit model or resolve the saved agent model client-side.

## 2026-11-27 — user raised everyday vs one-time use

- User asked: "btw, what if it just for like everyday use, one time use and so on, how to handle this?" and asked to log everything for later full review.
- Interpretation to confirm: everyday work should have durable named projects; one-time work should not clutter the project list. Current recommendation to include in the design: do not create a Project for every chat; keep one-off chats in an unfiled/recent area, let users pin/favorite everyday projects, and archive finished/temporary projects. Avoid a separate "project kind" in the minimal model; use `active`/`archived` status plus pinning and an unfiled bucket unless the user wants automatic temporary projects.
- User selected **Unfiled recents (Recommended)**: one-off chats do not create a Project; they stay in Recent/Unfiled and can be promoted later. Everyday projects are named/pinned. This decision belongs in the design doc's UX and lifecycle sections.
- Wrote the proposed full design at `docs/superpowers/specs/2026-11-27-projects-sidebar-design.md`. It covers: first-class Projects, pinned/active/archived lifecycle, unfiled recents for one-off chats, sidebar grouping, NewChat inheritance, API/storage/migration, BFF allow-list, tests, and risks. Status is proposed, not approved. No product code has been changed.
- User approved the design as the basis for the implementation plan. Used the `writing-plans` skill.
- Wrote the implementation plan at `docs/superpowers/plans/2026-11-27-projects-sidebar.md`: 8 tasks covering API storage/routes/session integration, web client/BFF, grouping helpers, sidebar UI, NewChat inheritance, mock/docs/full verification. The plan includes Global Constraints, Review Focus, TDD steps, commits, and self-review notes. No product code has been changed.
- User chose **Subagent-driven** execution. Used `subagent-driven-development` and `using-git-worktrees`; confirmed the current OpenCode linked worktree is already isolated (detached HEAD), so no new worktree was created. Created the SDD workspace and ledger at `.superpowers/sdd/2026-11-27-projects-sidebar/progress.md`, with pre-flight scan and rulings. Baseline test runs started in both repos before Task 1. API HEAD before implementation: `81ef26e60a807e0b7be29473243a6c0a137ce254`.
- Baselines clean: web 97 files / 852 tests; API 94 passed + 1 skipped files, 985 passed + 1 skipped tests with `DSH_ROOT=/home/mffaiz/code/dsh-pinned`.
- Task 1 complete: API Project storage and session `project_id`, commit `9e71781` on `develop` in `~/code/dsh-agents-api`. Review clean (spec ✅, no Critical/Important). Three minor findings carried forward: memory-store project cursor drift, FK hard-delete semantics for Task 2, owner validation for Task 3. No product code changed in the web worktree yet.
- Task 2 complete: API Project CRUD/archive routes, OpenAPI and docs, commit `4a92a76`. Review clean. Minor notes carried forward: delete check/delete non-atomicity after sessions can attach, shallow project-default validation, permissive list-status parsing, and a few untested edge cases.
- Task 3 complete: API session attachment, project defaults/moves/filtering, OpenAPI and docs, commit `6c63f36`. Review clean. Minor notes carried forward: index column as sole authority after move, 4xx error precedence, and shared OpenAPI 409 response breadth. API side of the feature is now implemented and reviewed.
- Task 4 complete: web project types/client, BFF allow-list, `PROJECTS_CHANGED` event, tests and CHANGELOG, commit `e4d6d63`. Review clean. Minor notes carried forward: empty `projectId` cannot reach the client filter (Unfiled stays client-side), omitted `order`, undocumented `{}` archive bodies, and no DELETE CSRF test.
- Task 5 complete: pure sidebar grouping helpers (`src/ui/shell/project-groups.ts`) and five tests, commit `0e1c385`. Review clean. Minor notes carried forward: duplicate date-title constants and untested archived/absent-Project paths; Task 6 must pass all active Projects to the helper.
- Task 6 complete: sidebar Project sections, create/edit/move/archive dialogs, filtered loads, row actions, tests, commit `5ebd32c`. Initial review found one Important bug: chats loaded into an expanded Project section were not filtered by the search query and leaked into Search results. Fix round 1 (`849bb0d`) applied `.filter(matches)` with a new focused test; scoped re-review confirmed ADDRESSED with no new breakage. Five Minor UI findings deferred to the final whole-branch review: stale dialog fields on reopen, archived dialog only one page, swallowed filtered-load errors, no double-submit guard, first-page-only Selector options.
- Task 7 complete: NewChat `?project=` preset, saved agent/environment/model/effort preselection, `projectId` on create, four named tests plus an added unknown-id test, commits `e6dc596` and `0de251a`. Review clean. Minor notes deferred to final review: saved agent id not validated against loaded list, archived/unknown tests do not await async settle, and the theoretical early-model-change race. Web CHANGELOG bullet still owed by Task 8.
- Task 8 complete: full mock Project API and flow tests through the real web client, web CHANGELOG bullet, commit `9213ac9`; no API commit needed (docs already committed). Review Approved with three Minor mock-fidelity gaps deferred to final review: empty `project_id` handling, `Request` bridging in the test helper, and loose `pinned` validation. Manual browser check was not performed in this harness; the checklist remains owed. Full verification exposed one genuine flaky API assertion (`updated_at` compared across a second boundary in the archive/unarchive test) plus unrelated environment timeouts; a focused fix is being dispatched before final review.
- This log was created at `docs/superpowers/reviews/2026-11-27-projects-sidebar-review-log.md` for later review.
- API flaky assertion fix: commit `7ba2ccb`, three focused `tests/projects.spec.ts` runs 12/12 each; scoped re-review ADDRESSED with no new breakage. No other API change.
- Final whole-branch review (both repos): no Critical and no API findings. Verdict "With fixes" for four Important web issues: Project delete has no confirmation, filtered Project session-load errors are swallowed, MoveProjectDialog can send an archived `project_id` absent from active options, and the archived dialog loads only one page. All deferred minors were triaged OK TO DEFER except the archived paging and swallowed-load-error items (already in the Important list). Dispatched one consolidated fix wave; no second fix wave is allowed after its scoped re-review.
- Final fix wave: commit `4247919 fix(sidebar): harden project actions and loads`; four new tests RED→GREEN, focused gate 47/47, typecheck and build passed. The single scoped re-review verdict: all four findings ADDRESSED, no new Critical/Important breakage. Two residual Minor effects were parked with rulings in the ledger (Retry on a failed later page resets to page 1; in-dialog target selection can reset on a rare Projects reload). No API changes in the fix wave.
