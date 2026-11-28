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

## Follow-up (2026-11-28): Finder-style folder picker

The user does not want the quick-pick chips under the Folder field (with many folders it gets ugly).
Instead: a button that opens a macOS Finder–style **column view** of the environment's folders.

### API: list one folder's sub-folders
`GET /agents/environments/{environment_id}/folders?path=<relative folder>` (owner-scoped like the
files routes). `path` empty or missing = workspace root; validated with `normalizeWorkspaceSubdir`
(400 on a bad path). Answers `{ object: 'list', path: '<normalized>', data: [{ name, path }] }` with the
immediate sub-directories only, sorted by name (case-insensitive), at most 500 (`has_more: true` beyond).
Dot-folders are included; the web hides them. A missing folder → 404 `resource_not_found`.
- `agentry-sandbox`/remote providers: start a stopped sandbox like `ensureFolder` does, then `exec`
  a script such as `cd -- '<dir>' && find . -mindepth 1 -maxdepth 1 -type d -printf '%f\n'` (shell-quote; check
  `find -printf` exists in the image, else use a portable loop). Exit code ≠ 0 because the folder is missing → 404.
- `local` provider: `readdir(dir, { withFileTypes: true })`, directories only (no symlink following).
- OpenAPI, contract test, `docs/http-api.md`, CHANGELOG. Tests: root listing, nested path, bad path 400,
  missing 404, local provider on a temp dir.

### Web
- Proxy allow-list: `GET agents/environments/{env_…}/folders` (+ unit test). Client
  `listEnvironmentFolders(id, path)`.
- Remove the quick-pick chips (and `topLevelFolders` if unused). The Folder field becomes a row:
  a button showing the choice — folder icon + `/workspace/biology/notes`, or "Whole workspace" when empty —
  that opens the picker, plus a small "Clear" icon button when a folder is set.
- New `FolderPicker` dialog (`src/ui/sandboxes/FolderPicker.tsx`), astryx components only:
  - Title "Choose a folder"; under it the current path as a breadcrumb (`/workspace › biology › notes`),
    each crumb clickable to go back up.
  - Column view: columns side by side, horizontally scrollable; column 1 = root's sub-folders. Clicking a
    folder selects it (highlighted) and opens its sub-folders as the next column (columns to the right of it
    are replaced). Each column loads lazily from the API, shows a spinner while loading, "No folders" when
    empty, and an inline error with Retry on failure. Hide dot-folders. Rows: folder icon + name, chevron
    on the right (as Finder).
  - "New folder" button: an inline text input in the selected column (validated with
    `normalizeWorkspaceFolder` on the full path); on Enter the new name is added to that column and selected
    (it is created for real when the first chat starts; nothing is written now).
  - Footer: "Use whole workspace" (choose empty), Cancel, and "Choose" (selected path; disabled until a
    folder is selected). Keyboard: arrow keys move within/between columns if cheap; Esc closes.
  - On a narrow screen the columns still scroll horizontally; the dialog fits the width.
- Tests: picker lists root, opens a sub-folder column, breadcrumb goes back, new folder adds and selects,
  whole workspace returns '', choose returns nested path; project dialog shows the button label and saves
  the picked folder.
