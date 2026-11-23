# Agentry General Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `@agentry/api` plugin present as Agentry, a general agent with every DSH capability. Add per-agent skills (built-in, library, private) with four install paths, a curated `/` catalog, Composio grants/approvals/connect cards, and a web Plugins page.

**Architecture:** The backend (`~/code/dsh-agents-api`) adds its own `agentry` agent preset (a copy of DSH's `standard` preset with an Agentry persona and no developer skill roots), mounted for every Agentry session. An agent-scoped `agentry` skill provider serves each agent's resolved skill set from repo built-ins plus Postgres-indexed skill folders on disk. A `tools.guard` and a `tools/pre-execute` handler enforce Composio grants and send approvals. The web app (`~/code/agentry-web`) adds `/plugins` (Connectors + Skills) and agent-form sections, and talks to new routes through the BFF allow-list.

**Tech Stack:** TypeScript, DSH plugin APIs (Cordis, `dsh-skill`, `dsh-system-prompt`, `dsh-agent-preset`), Postgres (forward-only SQL migrations), Vitest + Testcontainers, `fflate` (zip read), Next.js App Router, astryx 0.7.17, StyleX.

**Spec:** `docs/superpowers/specs/2026-11-23-agentry-general-agent-design.md` (in agentry-web).

## Global Constraints

- No edit to the DSH checkout (`~/code/dsh-pinned`, `~/code/deepseek-harness`): no files, no branches, no worktrees, no `pnpm install` inside it. All backend changes live in `~/code/dsh-agents-api`. A missing DSH seam is recorded as a follow-up, never patched.
- Pluggable: everything Agentry adds lives in the `@agentry/api` package (its `cordis.patch.yml` rows, its own preset row, its providers, tools, routes). Removing the plugin from a profile (`dsh plugin remove @agentry/api`) leaves stock DSH unchanged, DSH's own presets included. Every Agentry behaviour is a config field with a default: `preset` (`agentry`), `catalog.commands.allow`, `catalog.workspaceSkills`, `skills.dir`, `composio.approvalSlugs`, `composio.serverLabel`.
- Composio credentials and auth unchanged. The per-owner key stays in the web BFF (`src/server/connectors-store.ts`) and is injected on session create.
- Commit as `fakhrulfaiz <fakhrulfaiz2003@gmail.com>`; no `Co-Authored-By` or AI attribution in commits or code.
- Both trees carry uncommitted work from other sessions. Stage only the files your task lists (`git add <paths>`), never `git add -A` or `.`.
- Backend: every route or wire-type change updates `openapi/agentry.yaml` in the same commit; `tests/openapi-drift.spec.ts` and `tests/openapi-contract.spec.ts` pass. Every behaviour change adds a `CHANGELOG.md` bullet. Commands need `export DSH_ROOT=$HOME/code/dsh-pinned` and `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH`. `pnpm test` needs Docker.
- Web: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH`; `CHANGELOG.md` dated bullet per behaviour change. UI from astryx components and tokens; no raw `<div>`, hex or px in new code. UI copy never says "Composio".
- Existing agents keep working: `skills` absent means the default; `metadata.connectors` (comma list) means `"all"` for each listed toolkit; `apps` absent means unrestricted.
- Persona text (verbatim): `You are Agentry, a general-purpose AI agent running on the {{model}} model. You help with research, writing, analysis, documents and spreadsheets, working in the user's connected apps, scheduling recurring tasks, creating and managing other agents, and software work: reading, writing and running code in your workspace. Pick the approach the task needs; do not assume every request is a coding task. When asked who or what you are, say you are Agentry.`
- Saved-agent line (verbatim): `You are {name}, an agent built on Agentry.`
- Skill limits: name `^[a-z0-9]+(-[a-z0-9]+)*$`, at most 64 characters; description at most 1024 characters; at most 5 MB total (5,242,880 bytes); at most 200 files; staged skills expire after 24 hours.
- Default command allow-list: `["goal", "plan", "compact", "export"]`.

## Review Focus

1. **The same name is installed twice concurrently** (two uploads racing) → exactly one succeeds, the other gets 409 `skill_name_taken`. Pinned by the DB unique index test in Task 4.
2. **A skill is deleted while a live session has it selected** → the next `/name` or skill load says it is unknown and does not crash the turn. The agent record keeps a dangling id until edited, and the resolver ignores it. Pinned in Task 6.
3. **A GitHub path that points at a single file or at a folder without `SKILL.md`** → 400 `skill_invalid` naming "SKILL.md not found", not 502. Pinned in Task 8.
4. **`COMPOSIO_MULTI_EXECUTE_TOOL` with a malformed `tools` argument** (not an array, missing `tool_slug`) under a restricted grant → refused (fail closed), not allowed. Pinned in Task 10.
5. **A legacy agent whose `metadata.connectors` is an empty string** → treated as unrestricted, same as absent, not as "no apps". Pinned in Task 10.

---

## File Structure

**Backend (`~/code/dsh-agents-api`)**

| File | Responsibility |
|---|---|
| `cordis.patch.yml` | system-prompt identity off, `harness-dev-context` disabled, `preset-agentry` inserted, `skill-agentry` row removed |
| `src/preset.ts` (new) | `AGENTRY_PRESET_ID` and its mount helper |
| `src/mount-instructions.ts` | saved-agent name line |
| `src/host-tools.ts` | always-denied host tools (`plugin_manager`) |
| `src/commands.ts` | command allow-list filter on list and execute |
| `src/store/migrations/0004-skills.sql` (new), `src/store/store.ts`, `src/store/postgres.ts` | `skills` table and `SkillCollection` |
| `src/skills/package.ts` (new) | read zip or files into a validated `SkillPackage` |
| `src/skills/disk.ts` (new) | skill folder paths, write and remove |
| `src/skills/resolve.ts` (new) | an agent's effective skill set |
| `src/skills/provider.ts` (new) | agent-scoped `agentry` skill provider |
| `src/skills/install.ts` (new) | stage, activate, edit, delete, expiry (shared by routes and tools) |
| `src/skills/github.ts` (new) | GitHub zipball fetch and commit pinning |
| `src/skills/routes.ts` (new) | `/agents/skills…` install routes |
| `src/skills/tools.ts` (new) | `skill_install`, `skill_create` tools and approvals |
| `src/skills.ts` | catalog entries gain `kind`, `id`, `has_scripts`, `enabled` |
| `src/composio-grants.ts` (new) | grant model, legacy read, call check, clamp |
| `src/mount-composio.ts` (new) | guard, send approvals, guidance section |
| `src/connect-request.ts` (new) | detect connect links in `COMPOSIO_MANAGE_CONNECTIONS` output |
| `src/types.ts`, `src/agent-records.ts`, `src/agent-service.ts`, `src/mount-agent-tools.ts`, `src/items.ts`, `src/gateway.ts` | new agent fields and wiring |
| `skills/composio/` | moved from `.agents/skills/composio` |

**Web (`~/code/agentry-web`)**

| File | Responsibility |
|---|---|
| `app/(app)/plugins/page.tsx` (new), `src/ui/plugins/PluginsPage.tsx` (new) | Plugins page with tabs |
| `app/(app)/settings/connectors/page.tsx` | redirect |
| `src/ui/settings/SettingsNav.tsx`, `src/ui/shell/Sidebar.tsx` | nav changes |
| `src/api/types.ts`, `src/api/client.ts`, `src/server/allowlist.ts` | skill wire types, client calls, proxy rules |
| `src/ui/plugins/SkillsTab.tsx`, `SkillReviewSheet.tsx`, `SkillEditor.tsx`, `AddSkillMenu.tsx` (new) | Skills UI |
| `src/agents/form.ts`, `src/ui/agents/AgentForm.tsx` | Skills and Apps sections |
| `src/ui/chat/slash-menu.ts`, `src/ui/chat/ToolCard.tsx`, `src/ui/chat/ApprovalCard.tsx` | grouping, connect card, manifest |
| `app/api/agentry/connectors/connected/route.ts` (new) | account inventory |

---

### Task 1 (web): Plugins page with Connectors moved out of Settings

**Files:**
- Create: `app/(app)/plugins/page.tsx`, `src/ui/plugins/PluginsPage.tsx`
- Modify: `app/(app)/settings/connectors/page.tsx` (becomes a redirect), `src/ui/settings/SettingsNav.tsx` (drop Connectors), `src/ui/shell/Sidebar.tsx` (add "Plugins" after Artifacts), `src/ui/agents/AgentForm.tsx:179` (link to `/plugins?tab=connectors`), every other `/settings/connectors` reference (`grep -rn "/settings/connectors" src app`)
- Test: `tests/component/plugins-page.spec.tsx`

**Interfaces:**
- Produces: `PluginsPage({ tab, connectors, skills }: { tab: 'connectors' | 'skills'; connectors: ReactNode; skills: ReactNode })`. The server page loads today's connectors content (key check plus `loadDirectory()`, moved from the settings page) and passes it as `connectors`; `skills` is an empty state in this task ("Skills arrive with the next backend update.").

- [ ] **Step 1: Write failing tests** in `tests/component/plugins-page.spec.tsx` (`// @vitest-environment jsdom`):
  - `renders Connectors tab by default`: `render(<PluginsPage tab="connectors" connectors={<p>dir</p>} skills={<p>sk</p>} />)`; expect `getByRole('tab', { name: 'Connectors', selected: true })` and text `dir`.
  - `switching to Skills updates the URL`: click tab `Skills`; expect the mocked `router.replace` called with `'/plugins?tab=skills'`.
  - `settings nav has no Connectors entry`: `render(<SettingsNav />)`; `queryByRole('link', { name: 'Connectors' })` is null.
- [ ] **Step 2: Run** `pnpm vitest run tests/component/plugins-page.spec.tsx`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.** Use astryx `TabList` (check props with `pnpm exec astryx component TabList`). The page reads `searchParams.tab` (`'skills'` or else `'connectors'`) and renders `TopBar title="Plugins"`. `app/(app)/settings/connectors/page.tsx` becomes `redirect('/plugins?tab=connectors')` from `next/navigation`. Sidebar item: label `Plugins`, `href="/plugins"`, selected when `pathname.startsWith('/plugins')`, with a heroicons puzzle-piece icon.
- [ ] **Step 4: Run** `pnpm vitest run tests/component/plugins-page.spec.tsx tests/component/connector-directory.spec.tsx tests/component/connectors-form.spec.tsx && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.** CHANGELOG bullet: "Plugins page (`/plugins`): Connectors moved out of Settings; `/settings/connectors` redirects." Then `git add` the listed files plus `CHANGELOG.md` and run `git commit -m "feat: plugins page with connectors moved out of settings"`.

---

### Task 2 (backend): Agentry identity preset and `plugin_manager` hidden

**Files:**
- Modify: `cordis.patch.yml`, `src/mount-instructions.ts`, `src/host-tools.ts`, `src/gateway.ts:1268-1270` (`buildAgentSetup`) and `mountDefaultPreset` (`src/gateway.ts:2183`)
- Create: `src/preset.ts`
- Test: `tests/agentry-identity.spec.ts`, extend `tests/mount-instructions.spec.ts` (create it if absent)

**Interfaces:**
- Produces: `export const AGENTRY_PRESET_ID = 'agentry'` (`src/preset.ts`). `mountAgentInstructions(agentCtx, instructions, name?: string | null)` registers section `agents-api:identity` at order 9 with `You are {name}, an agent built on Agentry.` when `name` is a non-empty string. `ALWAYS_DENIED_HOST_TOOLS: readonly string[] = ['plugin_manager']` is exported from `src/host-tools.ts` and merged into the deny list by `applyHostToolsRestrict` for every session.
- `mountDefaultPreset(agentCtx, id = AGENTRY_PRESET_ID)` calls `presets.mount(agentCtx, id)`.

Patch rows to add to `cordis.patch.yml`:
- `id: system-prompt` with `config: { includeHarnessIdentity: false, personaPrefix: '' }`. The row's whole config is replaced; base sets only `personaPrefix: ''`, and the web-app layer's persona prefix is intentionally dropped.
- `id: harness-dev-context` with `disabled: true`.
- An `insert` of `id: preset-agentry`, `name: '@deepseek-ai/dsh-agent-preset'`, `config.id: agentry`, `config.order: 0`. Its `config.plugins` is copied verbatim from `$DSH_ROOT/packages/bundle/web-app/presets/standard.patch.yml` with exactly two changes:
  - the `persona` row's `config.prefix` is the persona text from Global Constraints;
  - the `skill-filesystem` row gets `config: { includeDefaultRoots: false }`.
- Delete the `skill-agentry` insert block. Task 6 serves built-ins through the scoped provider instead.

- [ ] **Step 1: Write failing tests** in `tests/agentry-identity.spec.ts`. Parse `cordis.patch.yml` with `yaml` and the standard preset file from `process.env.DSH_ROOT`:
  - `system-prompt drops the harness identity`: the row with `id: system-prompt` has `config.includeHarnessIdentity === false`.
  - `harness-dev-context is disabled`: the row has `disabled: true`.
  - `agentry preset persona is the Agentry text`: inside `preset-agentry`, the plugin with `id: persona` has `config.prefix` equal to the Global Constraints text and containing neither `coding agent` nor `DeepSeek Harness`.
  - `agentry preset hides developer skill roots`: plugin `skill-filesystem` has `config.includeDefaultRoots === false`.
  - `agentry preset matches standard except persona and skill roots` (drift guard): the plugin id lists are equal in order, recursively through `cordis:group` children. Each non-persona, non-`skill-filesystem` plugin deep-equals standard's (compare `!!js` values as their source strings).
  - `no skill-agentry row remains`.
  - In `tests/mount-instructions.spec.ts`: `registers the saved agent identity line`: with a fake `systemPrompt.section` spy, `mountAgentInstructions(ctx, 'Be brief.', 'Research Assistant')` registers `{ name: 'agents-api:identity', order: 9, text: 'You are Research Assistant, an agent built on Agentry.' }`; with `name` `null` there is no identity section.
  - `plugin_manager is always denied`: `applyHostToolsRestrict` with `undefined` config calls `restrict` with a deny list that includes `'plugin_manager'`; with `{ allow: ['plugin_manager'] }` it is still denied.
- [ ] **Step 2: Run** `pnpm vitest run tests/agentry-identity.spec.ts tests/mount-instructions.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the patch rows, `src/preset.ts`, the `name` parameter (gateway passes `resolved.name`), and `ALWAYS_DENIED_HOST_TOOLS`. YAML tip: a persona string with `{{model}}` goes in a `>-` block scalar.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm test`. Expected: PASS (the Loader composition test now also boots `preset-agentry`).
- [ ] **Step 5: Live check.** `pnpm build`, restart the "Agentry API" terminal, and ask the default chat "Who are you?". Expected: the answer names Agentry, not DeepSeek or a coding agent. Then check a subagent: ask it to delegate "say who you are" to a subagent; the child answers Agentry. If the child does not, record that in `docs/changes/` as a known gap; do not patch DSH.
- [ ] **Step 6: Commit.** CHANGELOG bullet; `git add cordis.patch.yml src/preset.ts src/mount-instructions.ts src/host-tools.ts src/gateway.ts tests/agentry-identity.spec.ts tests/mount-instructions.spec.ts CHANGELOG.md`; `git commit -m "feat: Agentry identity preset; hide plugin_manager"`.

---

### Task 3 (backend): Command allow-list

**Files:**
- Modify: `src/commands.ts`; the plugin `Config` schema (where `uploads` is declared, `src/index.ts`); `cordis.patch.yml` (`catalog.commands.allow`); `src/gateway.ts` (pass the allow-list into `CommandsApiDeps`)
- Test: `tests/commands.spec.ts` (extend)

**Interfaces:**
- Produces: config `catalog: { commands: { allow: string[] }, workspaceSkills: boolean }`, defaults `allow: ['goal','plan','compact','export']` and `workspaceSkills: false`. `CommandsApiDeps.allow: ReadonlySet<string>`.

- [ ] **Step 1: Failing tests:**
  - `lists only allowed commands`: the registry returns `goal`, `permission`, `feedback` and `export`; the response `data.map(c => c.name)` equals `['export', 'goal']`.
  - `executing a hidden command answers 404`: POST `/agents/sessions/{id}/commands/permission` → 404 with error code `command_not_found` (reuse the existing unknown-command code if one exists).
- [ ] **Step 2: Run** `pnpm vitest run tests/commands.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the filter in `CommandsApi` list and execute. Apply it before caching, so the ETag reflects the filtered body.
- [ ] **Step 4: Run** `pnpm vitest run tests/commands.spec.ts tests/openapi-drift.spec.ts`. Expected: PASS.
- [ ] **Step 5: Commit** with a CHANGELOG bullet, staging only the listed files: `git commit -m "feat: command allow-list for the / catalog"`.

---

### Task 4 (backend): Skills table and store

**Files:**
- Create: `src/store/migrations/0004-skills.sql`
- Modify: `src/store/store.ts` (types, `Store.skills`, the outage guard as `guardFiles` does), `src/store/postgres.ts`
- Test: extend the store contract spec (`grep -ln "files.insert" tests/` finds it)

**Interfaces:**
- Produces:
  ```ts
  type SkillScope = 'library' | 'agent'
  type SkillSource = 'upload' | 'github' | 'editor' | 'chat'
  interface SkillOrigin { repo: string; path: string; ref: string; commit: string }
  interface SkillRow {
    id: string            // `skill_${uuid without dashes}`
    owner: OwnerId; scope: SkillScope; agent_id: string | null
    name: string; description: string; source: SkillSource; origin: SkillOrigin | null
    content_hash: string; has_scripts: boolean; status: 'pending_review' | 'active'
    created_at: number; updated_at: number   // epoch seconds, like agents
  }
  interface SkillCollection {
    insert(row: SkillRow): Promise<void>                       // throws SkillNameTakenError on (owner, name)
    get(id: string, owner: OwnerId): Promise<SkillRow | undefined>
    list(owner: OwnerId, filter?: { scope?: SkillScope; agentId?: string; status?: SkillRow['status'] }): Promise<SkillRow[]>
    update(id: string, owner: OwnerId, patch: Partial<Pick<SkillRow, 'description' | 'content_hash' | 'has_scripts' | 'status' | 'origin' | 'updated_at'>>): Promise<SkillRow | undefined>
    delete(id: string, owner: OwnerId): Promise<SkillRow | undefined>
    deleteStagedBefore(cutoff: number): Promise<SkillRow[]>   // all owners; status pending_review, updated_at < cutoff
  }
  class SkillNameTakenError extends Error {}
  ```
- Migration: table `skills` with the columns above (`owner_id` references `owners (id)`, `origin` jsonb, timestamps `timestamptz`), `unique (owner_id, name)`, and index `(owner_id, scope, agent_id)`.

- [ ] **Step 1: Failing tests:**
  - insert then get round-trips every field.
  - Owner isolation: `get(id, 'other')` is `undefined`.
  - `list` filters by scope and agentId.
  - **Review Focus 1:** `Promise.allSettled` of two inserts with the same `(owner, name)` yields one fulfilled and one rejected with `SkillNameTakenError`.
  - `deleteStagedBefore` removes only `pending_review` rows older than the cutoff.
- [ ] **Step 2: Run** the store spec. Expected: FAIL.
- [ ] **Step 3: Implement** the SQL, the types and the Postgres collection. Map unique-violation code `23505` to `SkillNameTakenError`.
- [ ] **Step 4: Run** the store spec. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: skills table and store"`.

---

### Task 5 (backend): Skill package validation

**Files:**
- Create: `src/skills/package.ts`, `src/skills/disk.ts`
- Modify: `package.json` (add `fflate` at an exact version; check the current one with `npm view fflate version`)
- Test: `tests/skill-package.spec.ts` (build fixture zips in-test with `fflate.zipSync`)

**Interfaces:**
- Produces:
  ```ts
  interface SkillFile { path: string; bytes: Uint8Array }
  interface SkillPackage { name: string; description: string; files: SkillFile[]; hasScripts: boolean; contentHash: string; skillMd: string }
  class SkillInvalidError extends Error {}   // message names the rule
  class SkillTooLargeError extends Error {}
  const SKILL_LIMITS = { maxBytes: 5_242_880, maxFiles: 200, nameMax: 64, descriptionMax: 1024, maxRatio: 100 }
  function readSkillZip(bytes: Uint8Array, reserved: ReadonlySet<string>): SkillPackage
  function packageFromFiles(files: SkillFile[], reserved: ReadonlySet<string>): SkillPackage
  function packageFromEditor(input: { name: string; description: string; body: string }, reserved: ReadonlySet<string>): SkillPackage
  // disk.ts
  function skillDir(root: string, row: Pick<SkillRow, 'owner' | 'scope' | 'agent_id' | 'name'>): string  // <root>/<owner>/library/<name> | <root>/<owner>/agents/<agentId>/<name>
  async function writeSkill(dir: string, pkg: SkillPackage): Promise<void>   // writes to `${dir}.tmp-<rand>` then renames
  async function removeSkill(dir: string): Promise<void>
  ```
- Rules:
  - When every entry shares one top-level folder, strip that folder (GitHub and most zips).
  - Frontmatter is parsed with `yaml`; `name` must equal the folder-less skill name. `reserved` holds the built-in names.
  - `hasScripts` is true when any path starts with `scripts/` or ends with `.sh`, `.py`, `.js`, `.mjs`, `.ts` or `.ps1`.
  - `contentHash` is the sha256 over the sorted `path\0bytes` entries.
  - Read sizes from the zip directory before inflating; refuse when a declared size exceeds the limits or exceeds `maxRatio` times its compressed size.

- [ ] **Step 1: Failing tests** (each asserts the error class plus a message substring):
  - valid zip → `name`, `description` and `files.length` as built; `hasScripts` true when `scripts/run.sh` is present.
  - missing SKILL.md → `SkillInvalidError` /SKILL.md not found/.
  - `../evil` entry → /path/.
  - absolute path entry → /path/.
  - symlink entry (external attrs `0o120000 << 16`) → /symlink/.
  - `.ssh/x` → /hidden/.
  - 201 files → `SkillTooLargeError`.
  - declared size over 5 MB → `SkillTooLargeError`.
  - ratio bomb (1 MB of zeros) → `SkillTooLargeError`.
  - `name: Bad_Name` → /name/.
  - `name: create-agent` with reserved `{'create-agent'}` → /reserved/.
  - frontmatter name differs from the folder → /name/.
  - description over 1024 characters → /description/.
  - `packageFromEditor` produces exactly one `SKILL.md` whose frontmatter round-trips.
  - `writeSkill` then a read of `SKILL.md` gives the same bytes.
- [ ] **Step 2: Run** `pnpm vitest run tests/skill-package.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with `fflate.unzipSync(bytes, { filter })`, where the filter enforces the limits per entry before inflation.
- [ ] **Step 4: Run** the spec. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: skill package validation"`.

---

### Task 6 (backend): Agent `skills` field, resolver, scoped provider, catalog

**Files:**
- Move: `.agents/skills/composio/` → `skills/composio/` (`git mv`; update `skills-lock.json` `skillPath` if it is repo-relative)
- Create: `src/skills/resolve.ts`, `src/skills/provider.ts`
- Modify: `src/types.ts` (`AgentSkillSelection`, `skills` on `OAIAgent` / `CreateAgentParams` / `UpdateAgentParams`, `AgentSkill` fields), `src/agent-records.ts` (copy `skills` in `optionalAgentFields`), `src/agent-service.ts` (validate `skills`), `src/skills.ts` (catalog enrichment), `src/gateway.ts` (register the provider in `buildAgentSetup` after the preset; config `skills.dir`), the plugin config (`skills.dir` default `${HOME}/.dsh/agentry-skills`, env `AGENTRY_SKILLS_DATA_DIR` in `cordis.patch.yml`), `openapi/agentry.yaml`
- Test: `tests/skill-resolve.spec.ts`, `tests/skill-provider.spec.ts`, extend `tests/skills.spec.ts`

**Interfaces:**
- Consumes: `SkillRow`, `SkillCollection` (Task 4); `skillDir` (Task 5).
- Produces:
  ```ts
  interface AgentSkillSelection { builtin: string[]; library: string[] }   // library = skill ids
  // OAIAgent / params: skills?: AgentSkillSelection | null
  interface BuiltinSkill { name: string; description: string; dir: string }
  function loadBuiltins(root: string): Promise<BuiltinSkill[]>             // root = AGENTRY_SKILLS_DIR ?? <repo>/skills
  interface ResolvedSkills { builtins: BuiltinSkill[]; installed: SkillRow[] }
  function resolveAgentSkills(input: { agent: OAIAgent | undefined; isDefaultChat: boolean; owner: OwnerId; store: Store; builtins: BuiltinSkill[] }): Promise<ResolvedSkills>
  function createAgentrySkillProvider(deps: { resolve: () => Promise<ResolvedSkills>; root: string }): (control: SkillProviderControl) => SkillProvider & { invalidate(): void }
  // AgentSkill (wire) gains: kind: 'builtin' | 'library' | 'private' | 'bundled'; id?: string; has_scripts?: boolean; enabled: boolean
  ```
- Resolution rules (spec §2):
  - `skills` null or absent on a saved agent → every built-in, no library skills.
  - Default chat (`isDefaultChat`) → every built-in plus every active library row.
  - An explicit selection → the listed built-ins plus the library rows whose ids are listed and active. Unknown names and ids are ignored (**Review Focus 2**).
  - Always add the active private rows whose `agent_id` is the agent's id.
- Provider: `name: 'agentry'`, candidate `source` `custom`, `rank` 50. `locator` is the skill dir; `get()` reads `SKILL.md`, strips the frontmatter, and sets `resourceBase: { kind: 'directory', path: dir }`.
- Registered with `agentCtx.skills.registerProvider(...)` in `buildAgentSetup`. Keep a per-session handle so Tasks 7–9 can call `invalidate()` after any install, edit or delete for that owner (a map `owner → Set<invalidate>`, removed on dispose).
- Catalog:
  - `office-*` entries (provider not `agentry`) get `kind: 'bundled'` and `enabled: true`.
  - Without `session_id`, the catalog lists the built-ins plus the owner's active library rows, with `enabled` per the default chat.
  - Hide `source` values of `project-agents`, `project-dsh`, `user-dsh` and `user-agents` unless `catalog.workspaceSkills`, which re-allows only the `project-*` ones.
- Validation: `skills.builtin` entries must be known built-in names; `skills.library` entries must match `^skill_[a-f0-9]{32}$`. An error names the bad entry (`AgentInputError`, 400 on routes).

- [ ] **Step 1: Failing tests:**
  - **resolve:** saved agent with null `skills` → all built-ins, no library rows. Default chat → built-ins plus active library rows, without `pending_review` ones. Explicit `{ builtin: ['create-agent'], library: [id1] }` → exactly that set. Private rows apply only to their own agent id. **Review Focus 2:** an explicit `library` id that no longer exists is ignored.
  - **provider:** `list()` returns one candidate per resolved skill, with `provider: 'agentry'`. `get()` returns the body without frontmatter and a `resourceBase` directory. After `invalidate()` a new resolve result is visible on the next `list()`.
  - **catalog:** with a fake registry returning an `agentry` candidate, an `office` candidate and a `user-agents` candidate, the response holds the first two only, `kind` is set, and `enabled` is true.
  - **agent fields:** `POST /v1/agents` with `skills: { builtin: ['nope'], library: [] }` → 400 naming `nope`. A valid selection round-trips through GET.
- [ ] **Step 2: Run** these specs. Expected: FAIL.
- [ ] **Step 3: Implement.** Order in `buildAgentSetup`: `mountDefaultPreset`, then `registerProvider`, then `mountAgentInstructions`.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm test`. Expected: PASS, including OpenAPI drift.
- [ ] **Step 5: Live check:** `GET /v1/agents/skills` with the dev key lists `create-agent`, `composio` and `office-*`, and none of your `~/.agents/skills`.
- [ ] **Step 6: Commit:** `git commit -m "feat: per-agent skills resolver and scoped provider"`.

---

### Task 7 (backend): Skill install routes (upload, editor, review, edit, delete, expiry)

**Files:**
- Create: `src/skills/install.ts`, `src/skills/routes.ts`
- Modify: `src/gateway.ts` (routes before `/agents/:agent_id`; add `skills` to any reserved-id list), `openapi/agentry.yaml`
- Test: `tests/skill-routes.spec.ts`

**Interfaces:**
- Consumes: Tasks 4–6.
- Produces (`install.ts`, reused by Tasks 8 and 9):
  ```ts
  interface InstallTarget { scope: SkillScope; agentId?: string }
  function stageSkill(deps, owner, pkg: SkillPackage, target: InstallTarget, source: SkillSource, origin?: SkillOrigin, status?: 'pending_review' | 'active'): Promise<SkillRow>
  function activateSkill(deps, owner, id): Promise<SkillRow | undefined>
  function editSkill(deps, owner, id, input: { description?: string; body?: string }): Promise<SkillRow | undefined>   // editor-source skills only; else SkillInvalidError
  function deleteSkill(deps, owner, id): Promise<boolean>
  function sweepStaged(deps, now: number): Promise<number>   // cutoff now - 86_400
  function skillManifest(deps, row: SkillRow): Promise<{ skill: WireInstalledSkill; files: { path: string; bytes: number }[]; skill_md: string }>
  ```
  `WireInstalledSkill` is the row minus `owner`, plus `used_by: string[]` (ids of the owner's agents that select it).
- Routes (spec §4):
  - `GET /agents/skills/installed?scope=&agent_id=` lists rows. This path avoids a clash with the catalog route `GET /agents/skills`.
  - `POST /agents/skills` takes multipart (`file`, `scope`, `agent_id`), staging as `pending_review`, or JSON (`name`, `description`, `body`, `scope`, `agent_id`) from the editor, which is `active` at once.
  - `GET /agents/skills/{id}` returns the manifest.
  - `POST /agents/skills/{id}/activate`.
  - `POST /agents/skills/{id}` edits (JSON `description`, `body`).
  - `DELETE /agents/skills/{id}`.
  - An `agent_id` with `scope: 'agent'` must be one of the owner's agents, else 404.
- Errors: `SkillInvalidError` → 400 `skill_invalid`; `SkillNameTakenError` → 409 `skill_name_taken`; `SkillTooLargeError` or a body over 5 MB → 413 `skill_too_large`. Unknown or foreign id → 404.
- The sweeper runs at plugin start and then every hour through `ctx.effect` with an interval, the same way `src/files/sweeper.ts` runs.
- Every successful mutation calls the owner's provider invalidations from Task 6.

- [ ] **Step 1: Failing tests:**
  - **upload:** upload a fixture zip → 201 `status: pending_review`. `GET /agents/skills` (catalog) for the default chat does not list it. Activate → the catalog lists it with `kind: 'library'`.
  - **editor:** an editor create → 201 `active`, then an edit changes the description.
  - **rejected uploads:** invalid zip → 400 `skill_invalid`. A duplicate name → 409. A 6 MB body → 413.
  - **ownership:** other owner GET → 404. Private scope with a foreign `agent_id` → 404.
  - **delete:** removes the row and the folder (`existsSync` false).
  - **expiry:** `sweepStaged` with `now` 25 h after staging deletes the row and the folder; a row 23 h old survives.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use `busboy` the way `src/files/upload.ts` does. Write the folder first, then insert the row; if the insert throws, remove the folder.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: skill upload, editor, review and delete routes"`.

---

### Task 8 (backend): GitHub import and update

**Files:**
- Create: `src/skills/github.ts`
- Modify: `src/skills/routes.ts`, `openapi/agentry.yaml`
- Test: `tests/skill-github.spec.ts` (local `http.createServer` fake for the API and the codeload hosts, injected base URLs)

**Interfaces:**
- Produces:
  ```ts
  interface GithubDeps { apiBase: string; codeloadBase: string; fetch: typeof fetch }   // defaults https://api.github.com, https://codeload.github.com
  function resolveCommit(deps, repo: string, ref?: string): Promise<string>           // GET {apiBase}/repos/{repo}/commits/{ref ?? 'HEAD'} → sha
  function fetchSkillFromGithub(deps, input: { repo: string; path: string; ref?: string }, reserved): Promise<{ pkg: SkillPackage; origin: SkillOrigin }>
  class SkillImportError extends Error {}   // → 502 skill_import_failed
  ```
- Flow:
  - Validate `repo` against `^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$` and `path` (no `..`; leading and trailing `/` stripped).
  - Resolve the commit, download `{codeloadBase}/{repo}/zip/{sha}`, keep only the entries under `<top>/<path>/`, then `packageFromFiles`.
  - A network error, a non-200 or a 404 repo → `SkillImportError`. No entries under the path, or no `SKILL.md` → `SkillInvalidError` "SKILL.md not found" (**Review Focus 3**).
  - Timeout 30 s; download cap 50 MB.
- Routes:
  - `POST /agents/skills/import { repo, path, ref?, scope, agent_id? }` → 201 `pending_review`.
  - `POST /agents/skills/{id}/update` (github-source only) re-resolves `origin.ref`. A different `content_hash` rewrites the folder and sets `pending_review`; the same hash returns 200 with the row unchanged.

- [ ] **Step 1: Failing tests:**
  - **import:** an import pins `origin.commit` to the fake sha and keeps only the files under the path.
  - **update:** `update` with an unchanged zip → 200 and the status stays `active`. A changed zip → `pending_review` with a new hash.
  - **Review Focus 3:** a path to a folder without `SKILL.md` → 400 /SKILL.md not found/.
  - **unreachable GitHub:** the fake server is closed → 502 `skill_import_failed`. A bad `repo` string → 400.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: import skills from GitHub"`.

---

### Task 9 (backend): Chat tools `skill_install` and `skill_create`

**Files:**
- Create: `src/skills/tools.ts`
- Modify: `src/gateway.ts` (mount beside `mountAgentTools`)
- Test: `tests/skill-tools.spec.ts`

**Interfaces:**
- Consumes: `stageSkill`, `activateSkill` (Task 7); `fetchSkillFromGithub` (Task 8); `readSkillZip` (Task 5).
- Produces: `mountSkillTools(agentCtx, deps: { owner; store; root; github: GithubDeps; agentId?: string; invalidate: () => void })`, registering:
  - `skill_install`: args `{ repo?, path?, ref?, url?, scope: 'library' | 'agent' }`, exactly one of `repo+path` or `url` (an https `.zip`, max 5 MB).
  - `skill_create`: args `{ name, description, body, scope }`.
  - `scope: 'agent'` targets the session's saved agent; in the default chat it returns `{ error: 'this chat has no saved agent; use scope library' }`.
- Approval: a `tools/pre-execute` handler (same shape as `mount-agent-tools.ts:203-214`).
  - It prepares the package before asking: it fetches and validates, and on failure returns `{ error }` without asking.
  - It asks with reason `Install skill "<name>" (<n> files<, has scripts>): <description first 160 chars>`. The prepared package is cached by call id.
  - `execute` stages the skill as `active` with source `chat` (approval is the review).

- [ ] **Step 1: Failing tests** (fake agentCtx capturing `register` and `on`):
  - **skill_create:** the pre-execute handler returns `{ kind: 'ask' }` with the reason containing the name. `execute` creates an `active` row with `source: 'chat'`.
  - **skill_install:** with an invalid zip URL served by a fake server, `execute` returns an `error`, and no ask happens.
  - **scope agent:** `scope: 'agent'` without `agentId` → error.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Live check:** in chat, "make a skill called haiku-writer that writes haiku" → approval card → it appears on the Library tab after Task 12.
- [ ] **Step 6: Commit:** `git commit -m "feat: skill_install and skill_create chat tools"`.

---

### Task 10 (backend): Composio grants, guard, send approvals, clamp, guidance

**Files:**
- Create: `src/composio-grants.ts`, `src/mount-composio.ts`
- Modify: `src/types.ts` (`AgentAppGrants`, `apps`, `send_policy` on agent and params), `src/agent-records.ts`, `src/agent-service.ts` (validate; `AgentInput.apps` becomes `AgentAppGrants`; keep accepting `string[]` from tools as `"all"` each), `src/mount-agent-tools.ts` (`agent_get` returns `apps` from `effectiveGrants`; clamp in create and update), `src/gateway.ts` (mount after `mountMcpTools`), the plugin config (`composio.approvalSlugs: string[]`, `composio.serverLabel` default `composio`), `cordis.patch.yml` (the slug list), `openapi/agentry.yaml`
- Test: `tests/composio-grants.spec.ts`, `tests/mount-composio.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  type AgentAppGrants = Record<string, 'all' | string[]>   // toolkit slug → all or exact tool slugs (UPPER_SNAKE)
  // OAIAgent / params: apps?: AgentAppGrants | null; send_policy?: 'ask' | 'auto' | null
  function effectiveGrants(agent: OAIAgent | undefined): AgentAppGrants | null
  //   apps if set; else metadata.connectors non-empty → each slug 'all'; else null (unrestricted). Empty string → null (Review Focus 5).
  function toolkitOf(toolSlug: string, known: readonly string[]): string | undefined   // longest known toolkit whose UPPER prefix + '_' starts the slug
  function checkComposioCall(rawName: string, args: unknown, grants: AgentAppGrants | null): string | undefined   // refusal text or undefined
  function slugsInCall(rawName: string, args: unknown): string[] | 'malformed'
  function clampGrants(requested: AgentAppGrants | null, caller: AgentAppGrants | null): AgentAppGrants | null
  function mountComposio(agentCtx, deps: { grants: AgentAppGrants | null; approvalSlugs: ReadonlySet<string>; sendPolicy: 'ask' | 'auto'; serverLabel: string }): void
  ```
- Call rules (`rawName` is the part after `mcp__<label>__`):
  - `COMPOSIO_MULTI_EXECUTE_TOOL`: `args.tools` must be an array of objects with a string `tool_slug`, else `'malformed'` → refuse when grants are non-null (**Review Focus 4**). Each slug must be granted.
  - `COMPOSIO_MANAGE_CONNECTIONS`: every toolkit in `args.toolkits` (strings or `{ name }`) must be a granted key.
  - `COMPOSIO_SEARCH_TOOLS`, `COMPOSIO_GET_TOOL_SCHEMAS` and other `COMPOSIO_*` meta tools are allowed (read-only discovery).
  - Any other name is a direct app tool slug that must be granted.
  - Refusal text: `This agent is not allowed to use <Toolkit> (<SLUG>).`, never listing other grants.
- `mountComposio`:
  - `agentCtx.tools.guard` for `mcp__<label>__*` → `checkComposioCall`.
  - A `tools/pre-execute` handler asks when `sendPolicy === 'ask'` and any slug in the call is in `approvalSlugs`, with reason `Send on your behalf? <SLUG list>: <args excerpt 200 chars>`.
  - A systemPrompt section `agents-api:composio-guidance` (order 12), whose `text({ toolSet })` returns empty unless some tool name starts with `mcp__<label>__`. Text:
    `Connected apps: never write connection or sign-in URLs in your reply; the user sees a Connect button. If an app call fails with 401, USER_NOT_LOGGED_IN, or no connected account, call COMPOSIO_MANAGE_CONNECTIONS for that app so the user can reconnect. If it fails with 403 insufficient scope, tell the user which permission is missing instead of retrying.`
- Clamp: `agent_create` and `agent_update` from a session use `clampGrants(requested, effectiveGrants(callingAgent))`. When the caller is unrestricted (null), the requested grants pass through. Otherwise each toolkit must be in the caller's grant, and lists intersect (`'all'` ∩ list = list).
  - Skills clamp in the same handlers: requested `skills.library` ids must be the owner's library rows; `private` is never assignable through the tools.
  - The calling agent is the session's resolved agent, passed into `mountAgentTools` deps as `callerGrants`.
- `approvalSlugs` initial list: during this task, read the live tool list for gmail, googlecalendar, googledrive and github (`COMPOSIO_SEARCH_TOOLS` through a session, or the toolkit catalog) and put the send, create, update and delete slugs in `cordis.patch.yml`. Do not guess names; record the query used in the CHANGELOG note.

- [ ] **Step 1: Failing tests:**
  - **effectiveGrants:** apps set → apps. Legacy `metadata.connectors: 'gmail,github'` → `{ gmail: 'all', github: 'all' }`. **Review Focus 5:** `metadata.connectors: ''` → `null`.
  - **checkComposioCall, MULTI_EXECUTE:** a mixed batch with one ungranted slug → refusal naming that toolkit only. **Review Focus 4:** a `tools: 'x'` argument with non-null grants → refusal; with null grants → allowed.
  - **checkComposioCall, other calls:** a direct slug `GMAIL_SEND_EMAIL` under `{ gmail: ['GMAIL_FETCH_EMAILS'] }` → refused. Under `{ gmail: 'all' }` → allowed. `COMPOSIO_SEARCH_TOOLS` → allowed. `COMPOSIO_MANAGE_CONNECTIONS` for an ungranted toolkit → refused.
  - **clampGrants:** `{ gmail: 'all', slack: 'all' }` with caller `{ gmail: ['A'] }` → `{ gmail: ['A'] }`.
  - **mountComposio:** with a fake ctx, the pre-execute handler asks for a granted slug that is in `approvalSlugs` under policy `ask`, and passes under `auto`. The guidance section text is empty without composio tools in `toolSet` and non-empty with them.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm typecheck && pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: per-agent Composio grants, send approvals and clamp"`.

---

### Task 11 (backend): Connect request on MCP call items

**Files:**
- Create: `src/connect-request.ts`
- Modify: `src/types.ts` (`OAIMcpCallItem.connect_request?: ConnectRequest`), `src/items.ts` (attach it where `mcp_call` items are built), `openapi/agentry.yaml`
- Test: `tests/connect-request.spec.ts`

**Interfaces:**
- Produces: `interface ConnectRequest { toolkit: string; url: string; status: 'initiated' | 'active' | 'unknown' }`, and `connectRequestFrom(name: string, output: unknown): ConnectRequest | undefined`.
  - It applies only to names ending `COMPOSIO_MANAGE_CONNECTIONS`.
  - It parses a string output as JSON when possible and searches recursively for `redirect_url` or `connect_url` (a string URL whose host is `connect.composio.dev`, or any `https` URL under a `redirect_url` key), together with the nearest `toolkit` or `toolkit_slug`.
  - It returns the first match. It never throws.
  - This is a field on the existing item instead of a new item type; the spec is updated to say so.

- [ ] **Step 1: Failing tests:**
  - A real recorded output shape: capture one from the live backend with "connect my gmail" and save it under `tests/fixtures/composio-manage-connections.json` → `{ toolkit: 'gmail', url, status }`.
  - A plain-text output → `undefined`.
  - Another tool name → `undefined`.
  - Malformed JSON → `undefined`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**, and attach it in `items.ts`.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit.** Also add the backend docs here: `docs/changes/2026-11-23-agentry-general-agent.md` (identity preset, skills, catalog, grants; known gaps: `office` is always on, search results are not filtered, a subagent's persona if Task 2's check found a gap), a `docs/README.md` row, and the `AGENTS.md` Status and Backlog updates. `git commit -m "feat: connect requests on MCP call items; docs"`.

---

### Task 12 (web): Skill wire types, client, proxy rules, Skills tab

**Files:**
- Modify: `src/api/types.ts` (`AgentSkill` gains `kind`, `id?`, `has_scripts?`, `enabled`; new `InstalledSkill`, `SkillManifest`, `AgentSkillSelection`, `AgentAppGrants`; `Agent` gains `skills?`, `apps?`, `send_policy?`; `McpCallItem.connect_request?`), `src/api/client.ts`, `src/server/allowlist.ts`, `src/ui/plugins/PluginsPage.tsx` (real Skills tab)
- Create: `src/ui/plugins/SkillsTab.tsx`, `src/ui/plugins/AddSkillMenu.tsx`, `src/ui/plugins/SkillReviewSheet.tsx`, `src/ui/plugins/SkillEditor.tsx`
- Test: `tests/unit/allowlist.spec.ts` (extend), `tests/component/skills-tab.spec.tsx`

**Interfaces:**
- Consumes: the backend routes from Tasks 7–8 (shapes in `openapi/agentry.yaml`).
- Produces client calls:
  - `listInstalledSkills(scope?: 'library' | 'agent', agentId?: string)`
  - `getSkill(id)`
  - `uploadSkill(file: File, scope, agentId?)` (multipart)
  - `createSkill({ name, description, body, scope, agentId? })`
  - `importSkill({ repo, path, ref?, scope, agentId? })`
  - `activateSkill(id)`, `updateSkill(id)`, `editSkill(id, { description?, body? })`, `deleteSkill(id)`
  - Each returns the parsed type and throws `ApiError` like the existing calls.
- Allow-list rules:
  - `GET` `['agents','skills','installed']`
  - `POST` `['agents','skills']`
  - `POST` `['agents','skills','import']`
  - `GET, POST, DELETE` `['agents','skills', SKILL]`
  - `POST` `['agents','skills', SKILL, 'activate'|'update']`
  - `SKILL` matches `^skill_[a-f0-9]{32}$`. The multipart POST goes through the same upload path as `agents/files`.
- UI (spec §6):
  - Sub-tabs Built-in and Library. The rows are `List`/`Item` (name, description, source label, a "Has scripts" marker, "Used by N agents"; "Always on" for `kind: 'bundled'`).
  - Add skill → menu: Upload .zip / Import from GitHub / Write a skill.
  - Upload and Import open `SkillReviewSheet` (manifest, file tree, `SKILL.md` rendered with the existing `Markdown`, a warning `This skill includes scripts that run in your agent's sandbox.` when `has_scripts`) with Install (activate) and Discard (delete).
  - Row actions: Edit (editor source), Check for update (github source; a changed result reopens review), Delete (confirm text lists `used_by` agent names).

- [ ] **Step 1: Failing tests:**
  - **allowlist:** each new rule allows its method, and `PUT agents/skills/skill_…` is denied. A bad id is denied.
  - **library list:** with a mocked client, the Library tab lists rows and shows "Has scripts".
  - **upload:** upload → the review sheet shows the scripts warning → Install calls `activateSkill(id)`. Discard calls `deleteSkill(id)`.
  - **delete:** the delete confirm names the agents in `used_by`.
  - **editor:** saving calls `createSkill` with the entered fields.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/allowlist.spec.ts tests/component/skills-tab.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Read the props of `List`, `Item`, `Sheet`/`Drawer`, `DropdownMenu`, `TextInput`, `TextArea` and `AlertDialog` with `pnpm exec astryx component <Name>` first.
- [ ] **Step 4: Run** `pnpm typecheck && pnpm vitest run --no-file-parallelism`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: skills tab with upload, GitHub import, editor and review"`.

---

### Task 13 (web): Agent form Skills and Apps sections

**Files:**
- Modify: `src/agents/form.ts`, `src/ui/agents/AgentForm.tsx`
- Test: `tests/unit/agent-form.spec.ts` (extend or create), `tests/component/agent-form.spec.tsx` (extend)

**Interfaces:**
- Consumes: `AgentSkillSelection`, `AgentAppGrants` (Task 12 types); `listInstalledSkills`; the `GET agents/skills` catalog; `/api/agentry/connectors/status` (exists).
- Produces: `AgentFormState` gains `skills: AgentSkillSelection | null`, `apps: AgentAppGrants | null` and `sendPolicy: 'ask' | 'auto'`.
  - `formFromAgent(agent)` reads `apps` with the same legacy rule as the backend `effectiveGrants`.
  - `agentFromForm(form)` writes `skills`, `apps` and `send_policy`, and stops writing `metadata.connectors`. It removes that key, and `instructionsWithConnectors` is no longer used for saved agents (the backend enforces grants). Delete the now-unused helper and its tests.
- UI:
  - **Skills:** a radio "Use all built-in skills" / "Choose skills". Choose shows a `CheckboxList` grouped Built-in and Library, with `office-*` checked, disabled and marked "Always on".
  - **Private skills** (saved agents only): `listInstalledSkills('agent', id)` rows plus the `AddSkillMenu` scoped to the agent.
  - **Apps:** for each connected toolkit, a `SegmentedControl` All tools / Choose tools / Off. Choose shows a searchable `CheckboxList` of that toolkit's tool slugs, from the catalog entry's tools if the catalog has them, else a text field of comma-separated slugs.
  - "Sending on your behalf": Ask every time / Send without asking.

- [ ] **Step 1: Failing tests:**
  - **legacy apps:** `formFromAgent` with legacy `metadata.connectors: 'gmail'` → `apps: { gmail: 'all' }`.
  - **save:** `agentFromForm` writes `apps` and drops `metadata.connectors`.
  - **skills selection:** choosing skills and ticking one library skill saves `skills: { builtin: [...all built-ins], library: [id] }`.
  - **office:** the office checkbox is disabled.
  - **apps grants:** setting Gmail to Off saves `apps` without `gmail`. Choose tools saves the ticked slugs.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm typecheck && pnpm vitest run --no-file-parallelism`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: agent skills and app grants in the agent form"`.

---

### Task 14 (web): `/` grouping, connect card, approval manifest, account inventory

**Files:**
- Modify: `src/ui/chat/slash-menu.ts` (and its component), `src/ui/chat/ToolCard.tsx` (connect card), `src/ui/chat/ApprovalCard.tsx`, `src/chat/reducer.ts` (keep `connect_request` on items)
- Create: `app/api/agentry/connectors/connected/route.ts`, `src/server/connector-inventory.ts`
- Test: `tests/component/slash-menu.spec.tsx` (extend), `tests/component/connect-card.spec.tsx`, `tests/unit/connector-inventory.spec.ts`

**Interfaces:**
- Consumes: `AgentSkill.kind` (Task 12), `McpCallItem.connect_request` (Task 11); `src/server/connector-status.ts` (its `list` call).
- Produces:
  - `groupSlashEntries(commands, skills): { label: 'Commands' | 'Built-in' | 'Library' | 'This agent'; entries }[]`. Built-in includes `bundled`; private maps to This agent; empty groups are dropped; no client filtering.
  - `ConnectCard({ request }: { request: ConnectRequest })`: the toolkit name (from the catalog, else the slug), a primary Button `Connect <Name>` that opens the URL in a new tab with `noopener noreferrer`, and a status line.
  - In `ToolCard`, an mcp_call with `connect_request` renders `ConnectCard` above the normal details.
  - `getConnectedAccounts(owner): Promise<Record<string, { connected: boolean; accounts: { id: string; alias: string | null; status: string }[] }>>`, with a 60-second per-owner cache dropped on key change, the same as `connector-status.ts`. The route is a GET, same-origin, needs a session and answers `{ data }`.
  - In `ApprovalCard`, a reason starting `Install skill` renders the reason text plus the "has scripts" warning line when present.

- [ ] **Step 1: Failing tests:**
  - **grouping:** `groupSlashEntries` puts an `office` (bundled) skill under Built-in and a private skill under This agent, and drops empty groups.
  - **connect card:** renders `Connect Gmail` with `href` equal to the URL and `rel` containing `noopener`.
  - **inventory:** with a mocked MCP fetch it maps the list output to the record shape, and a second call within 60 s does not fetch.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm typecheck && pnpm vitest run --no-file-parallelism && pnpm test:e2e`. Expected: PASS (stop the running dev servers before e2e).
- [ ] **Step 5: E2E journey.** Add `tests/e2e/skills.spec.ts` against the mock API (extend `mock/` with the skill routes): open `/plugins?tab=skills`, upload a fixture zip, Install, open an agent, Choose skills, tick it, save, open a chat with that agent, type `/`, and see the skill under Library. Run `pnpm test:e2e tests/e2e/skills.spec.ts`. Expected: PASS.
- [ ] **Step 6: Commit.** CHANGELOG bullets; `docs/live-check.md` additions (spec §7 live checks); `AGENTS.md` Status line for this work. `git commit -m "feat: grouped / menu, connect cards, skill approvals, account inventory"`.

---

## Execution order

Run Task 1 first; it has no backend dependency. Then Tasks 2–11 in order (backend), then Tasks 12–14 (web). Tasks 12–14 need Tasks 6–11 merged and the backend rebuilt (`pnpm build` in `dsh-agents-api`, restart the "Agentry API" terminal).
