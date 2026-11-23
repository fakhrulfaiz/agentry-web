# Agentry as a general agent: identity, per-agent skills, curated `/` catalog, Composio grants (design)

Status: 2026-11-23, approved in conversation section by section; awaiting review of this written spec. Spans both repositories: `~/code/dsh-agents-api` (`@agentry/api`, "backend") and `~/code/agentry-web` ("web").

## Goal

Installing the `@agentry/api` plugin into a DSH profile gives every DSH capability, but the product presents itself as **Agentry**, a general-purpose agent (not a coding agent) that also works in connected apps (Composio) and creates and manages other agents. Every agent has its own selected skills, owners install their own skills four ways, and the `/` menu shows only what belongs to Agentry. The API alone is enough to define any general agent, so it can be deployed for other products later.

## Constraints

- Plugin, not fork: every change lives in `@agentry/api` (its `cordis.patch.yml`, providers, routes) or the web app. No edit to the DSH checkout (backend `AGENTS.md` decision 1). A missing DSH seam becomes a follow-up upstream PR.
- Composio credentials and auth do not change in this work: the per-owner consumer key stays in the web BFF and is injected on session create, as today (`2026-11-10-composio-connected-apps-design.md`). Only Composio *behaviour* changes (grants, cards, hints, approvals).
- Existing agents and sessions keep working unchanged (`skills: null`, `apps` list read as all-tools).
- Backend rules apply: OpenAPI spec and drift tests change with each route; CHANGELOG plus `docs/changes/` note; Postgres migrations forward-only; owner scoping on every record.

## 1. Identity and prompt

All in the backend `cordis.patch.yml`:

| Row | Today | Agentry |
|---|---|---|
| `system-prompt.includeHarnessIdentity` | `You are an AI agent powered by DeepSeek Harness.` (order −1000) | `false` |
| `system-prompt.personaPrefix` | `You are a coding agent powered by the {{model}} model.` (from `dsh-web-app`) | the Agentry persona below |
| `harness-dev-context` | DSH Web GUI and checkout sections and context | `disabled: true` |
| agent preset | sessions mount DSH's default preset (`standard`), whose own `persona` row also says "coding agent" | sessions mount Agentry's own preset row `preset-agentry` (id `agentry`): DSH's `standard` plugin list with the Agentry persona and `skill-filesystem` `includeDefaultRoots: false`; a drift test keeps it aligned with `standard`. DSH's own presets stay untouched for the DSH GUI. |

Agentry persona (order 0, interpolated):

> You are Agentry, a general-purpose AI agent running on the {{model}} model. You help with research, writing, analysis, documents and spreadsheets, working in the user's connected apps, scheduling recurring tasks, creating and managing other agents, and software work: reading, writing and running code in your workspace. Pick the approach the task needs; do not assume every request is a coding task. When asked who or what you are, say you are Agentry.

- **Saved agents** introduce themselves by their own name on Agentry. `mountAgentInstructions` (`src/mount-instructions.ts`) registers an agent-scoped section before the instructions: `You are {name}, an agent built on Agentry. When asked who or what you are, introduce yourself as {name}, an agent built on Agentry.` (the second sentence is needed: live, the persona's "say you are Agentry" otherwise wins) The default chat (no saved agent) gets only the persona.
- **Kept:** every tool and its guidance section (bash, fs, edit, subagents, skills, schedules, `present`, `ask_user_question`), plan mode, goals, compaction. Coding ability comes from those, not the persona line. The DSH web GUI at `/` keeps working for the operator.
- **`plugin_manager` is removed from every Agentry session's tool set** at agent setup (one deny entry beside the existing tool-restriction path). Reason: a plugin installs host-wide, runs unsandboxed in the server process, and affects every user; skills are the user-level extension point. The profile row stays enabled, so the operator still installs plugins from the DSH GUI or `dsh plugin add`; an admin plugins page belongs to F2.
- **Subagents** inherit the host persona; verify in `packages/subagent/subagent/src/child-agent.ts` during planning that children also present as Agentry.

## 2. Skill model and storage

| Kind | Source | Stored at | Visible to |
|---|---|---|---|
| Built-in | backend `skills/` (`create-agent`, and `composio` moved here from `.agents/skills`) plus `office-*` from `skill-office` | repo / `AGENTRY_SKILLS_DIR` | everyone |
| Library | installed by an owner | `<data>/skills/<owner>/library/<name>/` | that owner's agents |
| Private | installed onto one agent | `<data>/skills/<owner>/agents/<agentId>/<name>/` | that agent only |

`<data>` is a new plugin config field `skills.dir` (default `${HOME}/.dsh/agentry-skills`, env `AGENTRY_SKILLS_DATA_DIR`).

**Postgres table `skills`** (new migration): `id` (`skill_…`), `owner`, `scope` (`library` | `agent`), `agent_id` (nullable), `name`, `description`, `source` (`upload` | `github` | `editor` | `chat`), `origin` (JSON: `repo`, `path`, `ref`, `commit`; null except GitHub), `content_hash`, `has_scripts`, `status` (`pending_review` | `active`), `created_at`, `updated_at`. Unique `(owner, name)` across both scopes, so `/name` is never ambiguous. Files on disk are the content; the row is the index.

**Agent record** gains `skills`:
- `null` or absent: default. A saved agent gets every built-in; the default chat gets every built-in plus the owner's whole library.
- `{ builtin: string[], library: string[] }` (names and skill ids): exactly those built-ins and library skills.
- Private skills always apply to their agent.

**Resolution (Approach A):** at session agent setup, beside `mountAgentInstructions`, the backend resolves the agent's set and registers one provider named `agentry` on the agent's scope (`agentCtx.skills`) that serves exactly that set. DSH's registry is layered per scope, so the provider is visible only to that agent. Library and private changes invalidate the provider, and the next catalog read sees them without a session restart.

- The global `skill-agentry` row is removed; built-ins reach agents only through the scoped provider.
- `office-*` stays in the global layer in v1, so it is always on and cannot be deselected (shown as "always on"). The follow-up is an upstream per-scope skill filter in `dsh-skill`.
- Developer skill sources are hidden by config: the preset's `skill-filesystem` gets `includeDefaultRoots: false`, dropping `~/.agents/skills`, `$DSH_HOME/skills`, and workspace `.agents/skills`. One opt-in, `catalog.workspaceSkills` (default `false`), restores workspace skills.

## 3. `/` catalog curation

- `GET /v1/agents/skills` returns only the agent's resolved set plus `office-*`. Each entry adds `kind` (`builtin` | `library` | `private`), `id` (installed skills), `source`, `has_scripts`, and `enabled` for the session's agent. Without `session_id`, it lists built-ins and the owner's library with `enabled` per the default chat.
- Commands: plugin config `catalog.commands.allow` (default `["goal", "plan", "compact", "export"]`). `GET /v1/agents/commands` lists only allowed commands, and `POST /v1/agents/sessions/{id}/commands/{name}` answers 404 for others. `/permission` and `/feedback` are hidden. The model never sees commands as tools, so no prompt change is needed.
- The web `/` menu renders exactly what the backend returns, grouped Commands, Built-in, Library, This agent; no client filtering.

## 4. Installing skills

One pipeline for every way: **stage, validate, review, activate.**

**Validation** (all sources):
- Exactly one `SKILL.md` at the root, with frontmatter `name` (kebab-case, at most 64 characters, not a built-in name) and `description` (at most 1024 characters).
- Total size at most 5 MB, at most 200 files.
- Only relative paths: no `..`, absolute paths, symlinks, or hidden directories (except `.gitkeep`). Zip entries are checked before extraction (zip-slip) and against an expansion ratio cap (zip bombs).
- Executable content (`scripts/`, `*.sh`, `*.py`, `*.js`, …) is allowed and sets `has_scripts`, shown in review, because it runs in the session sandbox.

**Review:** a staged skill is `pending_review` and invisible to every model. `GET /v1/agents/skills/{id}` returns the manifest (name, description, file tree with sizes, `has_scripts`, full `SKILL.md`). `POST /v1/agents/skills/{id}/activate` sets `active`. Staged skills not activated within 24 hours are deleted.

| Way | Endpoint | Notes |
|---|---|---|
| Upload | `POST /v1/agents/skills` multipart: `file` (.zip), `scope`, optional `agent_id` | Limits as the attachments route |
| GitHub | `POST /v1/agents/skills/import` `{ repo: "owner/repo", path, ref?, scope, agent_id? }` | Fetches the tarball for `ref` (default branch), pins the resolved commit in `origin`, keeps only `path`. `POST /v1/agents/skills/{id}/update` re-imports the latest commit; changed content returns to `pending_review`. Public repositories only in v1. |
| Editor | `POST /v1/agents/skills` JSON `{ name, description, body, scope, agent_id? }` | Writes a single `SKILL.md`; active immediately (the author wrote all of it). `POST /v1/agents/skills/{id}` edits (the API uses POST for updates). |
| Chat | tools `skill_install` (`{ repo, path, ref?, scope }` or `{ url }` to a .zip) and `skill_create` (`{ name, description, body, scope }`) | Both go through the approval flow; the approval card shows the manifest, and approving activates. Mounted on every session beside the agent tools. |

Other routes: `GET /v1/agents/skills/installed?scope=library|agent&agent_id=` lists installed skills (separate from the catalog at `GET /v1/agents/skills`), and `DELETE /v1/agents/skills/{id}` deletes one. Built-ins cannot be edited or deleted through the API. Selection uses the existing agent update: `POST /v1/agents/{agent_id}` with `skills`, and `agent_update` / `agent_create` gain the same field. Everything is owner-scoped; another owner's id answers 404.

Errors: 400 `skill_invalid` (names the failed rule), 409 `skill_name_taken`, 413 `skill_too_large`, 502 `skill_import_failed` (GitHub unreachable or path not found).

## 5. Composio behaviour (credentials unchanged)

1. **Per-agent app grants.** Agent `apps` becomes `{ [toolkit]: "all" | string[] }` (exact tool slugs such as `GMAIL_SEND_EMAIL`). An existing list is read as `"all"` per listed toolkit, and `null` means unrestricted (today's behaviour). A `tools.guard` on `mcp__composio__*` (the seam `applyAllowedToolsGuard` in `src/mount-mcp-tools.ts` already uses):
   - checks every inner `tool_slug` of `COMPOSIO_MULTI_EXECUTE_TOOL` and refuses the whole call if any is outside the grant;
   - checks direct per-app tool slugs;
   - limits `COMPOSIO_MANAGE_CONNECTIONS` to granted toolkits; `COMPOSIO_SEARCH_TOOLS` and other read-only meta tools stay allowed and their results are not filtered in v1 (every call is still enforced);
   - names the refused app only, never what else is granted.
2. **Connect cards.** When a `COMPOSIO_MANAGE_CONNECTIONS` output carries a redirect URL, the `mcp_call` item carries a `connect_request` field `{ toolkit, url, status }` (a field on the existing item, not a new item type). The web renders it as a Connect card (reusing `is-connect-link`) instead of a raw link. A guidance section tells the model not to write connection URLs in replies.
3. **Error hints.** A prompt section, active only when Composio tools are mounted: 401, `USER_NOT_LOGGED_IN`, or no connected account means calling `COMPOSIO_MANAGE_CONNECTIONS` for that toolkit (a reconnect card); 403 insufficient scope means telling the user which permission is missing instead of retrying. If planning finds a DSH tool-result transform seam, the hint is attached to the failed result instead.
4. **Inheritance clamp.** `agent_create` and `agent_update` called from a session clamp `apps` to the calling agent's own grant, and `skills` to the caller's built-ins and library (another agent's private skills are never assignable). The web UI and direct API calls act as the owner and are not clamped.
5. **Imported agents start with `apps: {}`** (rule recorded for the future ECC/URL import).
6. **Approvals for sends.** Plugin config `composio.approvalSlugs`, a curated list of send, delete, and write slugs for Gmail, Google Calendar, Google Drive, and GitHub, taken from the live toolkit schemas during planning, never guessed. The guard routes those calls, including inside `MULTI_EXECUTE`, through the existing approval flow ("Send on your behalf?"). Per-agent `send_policy`: `ask` (default) or `auto`.
7. **Account inventory.** A BFF route `GET /api/agentry/connectors/connected` returns `{ [toolkit]: { connected, accounts: [{ id, alias, status }] } }` from the existing `COMPOSIO_MANAGE_CONNECTIONS` `list` call, with a 60-second per-owner cache. It stays in the BFF while the key does.

Deferred: multi-account and per-account grants, moving Composio into the backend with a project key, file uploads to Composio, app-event triggers.

## 6. Web UI

- **`/plugins` page: Connectors and Skills in one place** (sidebar entry "Plugins" beside Agents and Artifacts; no longer under Settings). Top-level tabs **Connectors** and **Skills**, selected by `?tab=connectors|skills` (default `connectors`).
  - **Connectors tab** is today's `/settings/connectors` content moved unchanged (key row, Connected section, Featured, search, category chips, catalog grid). `/settings/connectors` redirects to `/plugins?tab=connectors`; the Settings section nav drops its Connectors entry (Settings keeps General). Connect links and the `?prompt=` flow keep working; any internal link to `/settings/connectors` (callback URLs, chat hints) points at `/plugins?tab=connectors`.
  - "Plugins" is user-facing naming for connectors plus skills; it is unrelated to DSH plugins, which stay operator-only (section 1).
- **Skills tab**: sub-tabs Built-in and Library; rows (`List`/`Item`) show name, description, source, scripts marker, and agents using the skill. Add skill: Upload .zip, Import from GitHub, Write a skill. Upload and GitHub open a Review sheet (manifest, file tree, `SKILL.md`, scripts warning) with Install and Discard. The editor has name, description, Markdown body, and preview. Row actions: Edit (editor skills), Check for update (GitHub), Delete (names agents using it and confirms).
- **Agent form** (`src/ui/agents/AgentForm.tsx`):
  - **Skills** section: "Use all built-in skills" (default) or "Choose skills", a checklist grouped Built-in and Library, with `office` checked, disabled, and marked always on. A **Private skills** subsection on saved agents, with the same three add options.
  - **Apps** section, replacing the soft app limit: per connected toolkit All tools, Choose tools (searchable slug list from the catalog), or Off; plus "Sending on your behalf": Ask every time or Send without asking.
- **Composer `/` menu:** groups as in section 3.
- **Chat:** `connect_request` items render as Connect cards; `skill_install` and `skill_create` approvals show the manifest inside the approval card.
- **BFF:** allow-list entries for the skill routes; multipart upload through the existing upload proxy path with CSRF and size limits.
- UI from astryx components and tokens, built after the astryx upgrade to 0.7.17 (a separate task, done before this UI work).

## 7. Testing

**Backend (Vitest; Postgres through Testcontainers):**
- Prompt assembly with the patch layered on base and web-app: no "DeepSeek Harness", "coding agent", or harness-dev-context text; starts with the Agentry persona; a saved agent's prompt contains its name line. `plugin_manager` is absent from Agentry sessions.
- Skill validation fixtures: zip-slip, symlink, oversize, ratio cap, missing `SKILL.md`, bad name, built-in name clash. Stage, review, activate; staged expiry; owner isolation (404).
- GitHub import against a mocked tarball server, with commit pinning and update-to-review.
- Resolver: `null` vs explicit selection; private skills on their own agent only; a library change visible on the next catalog read.
- Catalog: developer roots hidden; command allow-list on list and execute.
- Composio guard: grant allow and deny, mixed `MULTI_EXECUTE` batches, search filtering, approval routing for curated slugs, the create/update clamp, legacy `apps` list read as all.
- OpenAPI: `openapi/agentry.yaml` updated; drift and contract tests pass.

**Web:** component specs for the Plugins page (tab switching by `?tab=`, the `/settings/connectors` redirect, the existing connector-directory and connectors-form specs moved under it), the Skills tab, Review sheet, editor, agent form Skills and Apps sections, `/` grouping, Connect card. An e2e journey on the mock API: upload, review, install, select on an agent, see it in `/`.

**Live check** (web `docs/live-check.md`, backend `docs/changes/`): "who are you?" answers Agentry, and a saved agent answers with its own name; "create an agent that…" creates a saved agent with clamped apps; a GitHub-imported skill appears and runs; an ungranted Gmail send is refused and a granted one shows an approval card.

## 8. Rollout

Each step ships on its own, backend first, with its web part alongside:

0. Web only: the `/plugins` page with the Connectors tab moved out of Settings, plus the redirect (no backend change; the Skills tab appears empty-state until step 3).
1. Identity and prompt; `plugin_manager` removed.
2. Catalog curation (developer roots off, command allow-list).
3. Skill storage, resolver, agent `skills` field.
4. Install pipeline: editor, upload, GitHub, then the chat tools.
5. Composio grants, guard, approvals, clamp.
6. Connect cards and error hints.

## Out of scope (follow-ups)

- Upstream `dsh-skill` per-scope filter, making `office-*` selectable.
- Multi-account Composio and per-account grants; Composio in the backend with a project key.
- Private GitHub repositories for skill import; a skill marketplace or search.
- Admin plugins page (F2).

## Docs to update when this lands

CHANGELOG in both repositories; a backend `docs/changes/2026-11-23-agentry-general-agent.md` plus its `docs/README.md` row; Status and Backlog in both `AGENTS.md` files (web backlog item 1 and backend backlog item 1 change from "catalog" to "per-agent skills").
