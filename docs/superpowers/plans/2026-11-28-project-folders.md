# Project folders inside a sandbox (2026-11-28)

A Project on a sandbox environment can name a folder inside that environment's workspace
(`/workspace/<folder>`). Every chat started from the Project runs there: its working directory
(DSH session `cwd`) is that folder, so relative paths, `ls`, and new files land there.

Decided with the user: this is a **starting folder, not isolation**. The agent may still `cd ..` or
`ls` the rest of the workspace; that is by design. Hard separation = a separate environment.

Scope: Projects first. One-off chats choosing a folder in the composer is later (not in this plan).

## API (`~/code/dsh-agents-api`)

1. Types (`src/environment-types.ts`): add `directory?: string` to `OAISandboxEnvironment` and to
   `OAISandboxSessionEnvironment`. Meaning: a path relative to the environment's workspace root.
2. Validation helper (new, small, unit-tested), e.g. `src/sandbox/workspace-subdir.ts`:
   `normalizeWorkspaceSubdir(input: unknown): string | undefined | { error: string }`.
   - `undefined`, `null`, `''`, `'.'`, `'/'`-only after trim → `undefined` (workspace root).
   - Trim; strip leading `./` and trailing `/`; collapse repeated `/`.
   - Refuse: absolute paths (leading `/`), any `..` segment, `\`, NUL or control characters,
     more than 200 characters, more than 8 segments. Error code `bad_request`, message names the rule.
3. `Gateway.sandboxWorkspace` (`src/gateway.ts`, the `environment_id` branch and the
   provision-from-template branch): when `spec.directory` normalizes to a folder,
   - `cwd = posix.join(root, folder)` where `root` is the environment's workspace directory;
   - create it inside the sandbox before the session starts: if the provider has `exec`, make sure the
     sandbox runs (a stopped `agentry-sandbox` sandbox is started the same way `sandbox_start` /
     `sandbox_exec` do in `src/mount-sandbox-tools.ts`; reuse, don't duplicate, if a helper exists) and run
     `mkdir -p -- '<cwd>'` as the agent user (shell-quote it). Exit code ≠ 0 or a failure → 409
     `directory_unavailable` with the stderr tail in the message;
   - the stored session environment is `{ type: 'sandbox', environment_id, directory: folder }`.
   Without `directory` nothing changes (same cwd, same stored config).
   The `local` provider (host folders): `mkdir(join(root, folder), { recursive: true })` on the host.
4. Projects: `project.environment` is stored as JSON, so `directory` flows through
   `resolveProjectDefaults` unchanged. Validate it on project create/update with the same helper
   (400 on a bad folder) so a Project cannot save one that every chat would then refuse.
5. Resume after an API restart already uses the session log's `cwd`; check that a resumed session
   on a folder keeps that folder (add a test if the store/gateway tests make that cheap).
6. OpenAPI (`openapi/agentry.yaml`: both sandbox environment schemas and the project schema),
   contract/drift tests, `docs/http-api.md`, a `docs/changes/2026-11-28-project-folders.md`, CHANGELOG.

Tests: the helper (accept/refuse table); session create with `directory` on a sandbox environment
(cwd is the subfolder, mkdir script ran, stored environment keeps `directory`); bad folder → 400;
exec failure → 409; project create with a bad folder → 400; project default flows into the session.

## Web (`~/code/agentry-web`)

1. `src/api/types.ts`: `directory?: string` on the sandbox environment config types.
2. Project dialog (`src/ui/shell/project-actions.tsx`, `ProjectDialog`): when an environment is chosen,
   show a **Folder** field (optional) under it. Description: "Inside /workspace. Chats in this project
   start here; it is created if missing. Leave empty for the whole workspace." Offer the environment's
   existing top-level folders as quick picks (list `''` with the existing environment files client, dirs
   only, skip names starting with `.`; a failed list just shows no picks). Validate with the same rules
   as the API (mirror them in a tiny shared client helper) and show the error inline. Save sends
   `environment: { type: 'sandbox', environment_id, directory }` (omit `directory` when empty). Editing
   a Project pre-fills it. Clearing the environment clears the folder.
3. New chat from a Project (`src/ui/chat/NewChat.tsx`, `?project=` preset): the project's
   `environment` (with `directory`) is what the session inherits; make sure the preset does not drop
   `directory` when it sends the environment explicitly. Show the folder next to the environment choice
   as plain supporting text (e.g. "in /workspace/biology").
4. CHANGELOG bullet. Tests: dialog sends/pre-fills/clears `directory`, rejects `../x`; NewChat keeps
   `directory` from the project.

Use astryx components (read props with `pnpm exec astryx component <Name>`); no raw divs beyond what
the file already does.

## Done when

Both repos: typecheck and tests green (API: `DSH_ROOT=$HOME/code/dsh-pinned`), committed on `develop`.
