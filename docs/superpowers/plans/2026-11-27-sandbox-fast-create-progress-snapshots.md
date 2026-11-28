# Sandbox: template image cache, create progress, snapshots — plan

Date: 2026-11-27. Picked by the user from the sandbox improvement check. Three agents in parallel worktrees; merged into `develop` at the end.

## Task 1 — Template image cache + progress stages (agentry-sandbox, branch `feat/template-cache`, worktree `~/code/wt/sbx-template-cache`)

**Problem.** Every create re-runs the whole bootstrap (`src/places/bootstrap.ts`): make the `agent` user (may `apt-get install sudo`), install template packages (apt/apk), copy the DSH runtime tar through envd, then files and setup commands. Nothing is reused between sandboxes from the same template, so a create takes minutes (a GPU-box create timed out at 180 s).

**Cache (Docker-backed places: `docker`, and `docker-ssh` if it shares the driver code).**
1. Cache key = sha256 of: resolved base image (digest when known, else ref), sorted packages, DSH runtime ref, and a bootstrap-script version constant (bump it whenever `ensureAgent`/`installScript` change).
2. On create, if the driver's daemon has image `agentry-template-cache:<key[:24]>` (labels `org.agentry.cache.key`, `org.agentry.cache.base`), create the container from it and skip the agent-user, package and runtime steps (bootstrap must detect this, e.g. by a marker file `/opt/agentry/.bootstrap-<key>` or a `handle` flag). Template files and setup commands still run (they live in the workspace volume, which is not in the image).
3. On a cache miss, after agent user + packages + runtime succeed and BEFORE files/setup commands, `docker commit` the container (pause is fine) to that tag, in the background, without failing the create if the commit fails (log it). Never commit anything with secrets: template `env` is set at container create (not baked), the workspace is a volume (not committed). Check nothing else secret lands in the image layers (envd token is derived, not stored — confirm).
4. Prune: keep at most `AGENTRY_SANDBOX_TEMPLATE_CACHE_MAX` (default 10) cache images per daemon, newest used first (label `org.agentry.cache.used_at` or image created time); remove the others when a new one is made. Never remove an image a container still uses.
5. `AGENTRY_SANDBOX_TEMPLATE_CACHE=off` disables. Config in `src/config.ts` + `tests/config.spec.ts`. Admin page: a "Template cache" line per place with count and size and a Clear button if cheap; otherwise list it as a follow-up below.
6. Templates with no packages on the standard image still benefit (runtime copy + agent user).

**Progress stages.** While a sandbox is `provisioning`, its record carries `progress` (persisted on the record — store memory + postgres, add a migration if needed — and returned by `GET /v1/sandboxes/{id}` and the list):

```json
"progress": { "stage": "pulling_image" | "starting" | "preparing" | "installing_packages" | "copying_runtime" | "writing_files" | "running_setup" | "finishing",
              "step": 2, "steps": 3, "detail": "npm install", "updated_at": 1764230000 }
```

`step`/`steps`/`detail` only for `running_setup` (`detail` = the command, cut to 120 chars, never env values). `progress` is removed when the sandbox leaves `provisioning`. A cache hit goes `starting` → `writing_files`/`running_setup` → `finishing`. Update the OpenAPI file (drift test), the client types, README, CHANGELOG.

**Tests.** Fake driver: second create of the same template skips package/runtime steps; a changed package list misses; commit failure does not fail the create; prune keeps N; off switch; progress stages appear in order and clear. Docker suite (skips without Docker): a real commit + reuse round trip.

## Task 2 — Progress in the API and web (branches `feat/create-progress`, worktrees `~/code/wt/api-create-progress`, `~/code/wt/web-create-progress`)

Depends only on the wire shape above (build against it with fakes; Task 1 lands in parallel).

- **API** (`~/code/dsh-agents-api`): `src/sandbox/agentry-sandbox-provider.ts` reads `progress` from the sandbox record; `environmentJson` exposes it as `sandbox.progress` (same shape) while `state` is `provisioning`. Note: since the background environment create (merged today), a `pending` record may have no sandbox id yet — then no progress (or `{ stage: "starting" }`). Docs: `docs/http-api.md`, `openapi/agentry.yaml`, CHANGELOG. Tests with the fake sandbox service.
- **Web** (`~/code/agentry-web`): `src/api/types.ts`; the Sandboxes card's "Setting up…" line and the detail page banner show plain words: "Downloading the image…", "Starting…", "Preparing the sandbox…", "Installing packages…", "Copying the agent runtime…", "Adding files…", "Running setup (2 of 3): npm install", "Finishing…". The list/detail already poll every 3 s while settling. Component tests. CHANGELOG.

## Task 3 — Snapshots in the sandbox service (agentry-sandbox, branch `feat/snapshots`, worktree `~/code/wt/sbx-snapshots`)

Spec `~/code/agentry-sandbox/docs/superpowers/specs/2026-11-26-sandbox-next-design.md` § 2; plan `~/code/agentry-sandbox/docs/superpowers/plans/2026-11-26-sandbox-next.md` Tasks 3.1–3.7, with these decisions (spec defaults, operator chose them 2026-11-27):

- Snapshot store: a folder on the service host (`AGENTRY_SANDBOX_SNAPSHOT_DIR`); no object storage now.
- Phase 1 (audit log, metrics) is NOT built: skip every audit event and metric the snapshot tasks mention; leave a `// audit: snapshot.create` style note only if useful, and list them under Follow-ups.
- E2B (Task 3.5): build against the fake E2B; the parts the plan says to "confirm on the live suite" stay unconfirmed — say so in the README and CHANGELOG, list under Follow-ups.
- Migration number: next free one (Task 1 may also add one; if both pick the same number the merge renumbers).

## Follow-ups (not possible now)

- Snapshots in the API and web (plan Task 3.8): after Task 3 merges.
- E2B snapshot live confirmation (template id create, delete path): needs the operator's E2B key.
- Audit log + metrics (sandbox-next Phase 1), then wire snapshot audit events and `op=snapshot|restore` metrics.
- Template cache for E2B / SSH-machine places (E2B: build an E2B template; SSH machine: packages are the operator's).
- A warm pool of pre-started sandboxes for the default template (per-owner networks make it harder; revisit after the cache is measured).
- Live checks: a real create twice from the same template (time both), progress seen in the web card, a snapshot round trip on Docker.

## Rules for every agent

- Work only in your worktree(s). Do not touch the main checkouts (`~/code/agentry-sandbox`, `~/code/dsh-agents-api`, `~/code/agentry-web`). Do not merge or push.
- `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH`. If `node_modules` is missing, `pnpm install --frozen-lockfile`. In API worktrees, `node_modules/@agentry/sandbox` may point at a missing relative path: re-link it to `/home/mffaiz/code/agentry-sandbox` (untracked).
- Tests: sandbox `pnpm typecheck && pnpm test`; API `DSH_ROOT=~/code/dsh-pinned pnpm vitest run` + `pnpm typecheck` (`tests/sandbox-remote.spec.ts`, `tests/schedule-resolve.spec.ts` are known flaky); web `pnpm typecheck && pnpm vitest run` (reveal and schedule-detail save tests are known pre-existing timeouts).
- Commit as `fakhrulfaiz <fakhrulfaiz2003@gmail.com>` (`git -c user.name=fakhrulfaiz -c user.email=fakhrulfaiz2003@gmail.com commit`). Never add Co-Authored-By, "Generated with", or any AI attribution anywhere. CHANGELOG bullet per behaviour change. Exact dependency versions.
- Follow each repo's AGENTS.md (web: astryx components only, no raw div/className/hex).

## Snapshots: API and web (next)

Decided by the user 2026-11-28: deleting an environment KEEPS its snapshots (they can still start a new environment).

Written 2026-11-28 after the sandbox service finished snapshots (`agentry-sandbox`, branch `feat/snapshots` merged to `develop`; not yet in a release). Not implemented. Two small plans, API first, then web. This is plan Task 3.8 of `agentry-sandbox/docs/superpowers/plans/2026-11-26-sandbox-next.md`.

### What the service offers (the contract to build on)

Sandbox service routes (all owner-scoped; another owner's id answers 404; `SandboxApi` in `@agentry/sandbox/client` already has `snapshot`, `listSnapshots`, `getSnapshot`, `deleteSnapshot`, `restore`, and `create` takes `snapshot`):

- `POST /v1/sandboxes/{id}/snapshots {name?, level?: 'workspace'|'disk'|'memory', stop_first?}` answers 202 with a snapshot in `saving`; poll `GET /v1/snapshots/{id}` until `ready` or `failed` (`error` says why).
- `GET /v1/snapshots[?sandbox=]`, `GET /v1/snapshots/{id}`, `DELETE /v1/snapshots/{id}`.
- `POST /v1/sandboxes/{id}/restore {snapshot}`: workspace snapshots replace the files in place (a stopped sandbox is started for it and stopped again); `disk`/`memory` rebuild the sandbox, only on the place that took them.
- `POST /v1/sandboxes {snapshot}`: a new sandbox from a snapshot (workspace: files unpacked over the template, any place; disk/memory: same place only).
- Snapshot wire shape: `{id: 'snap_<32 hex>', object: 'snapshot', sandbox_id, place ('service' or a place id), level, name, state: 'saving'|'ready'|'failed', size_bytes|null, error|null, created_at, expires_at|null}`. No handles or secrets.
- `GET /v1/backends` lists each place's `snapshots` levels (what the place can take: `workspace` needs `AGENTRY_SANDBOX_SNAPSHOT_DIR` on the service; Docker places add `disk`; E2B has `disk`+`memory`; SSH machines only the generic `workspace`).
- Errors: 400 `snapshots_off` (no folder set), 400 on a level the place lacks (names the levels it has), 409 `snapshot_not_ready`, 429 quota (default 10 per owner), 404 for another owner's id. A snapshot outlives its sandbox; it expires after `AGENTRY_SANDBOX_SNAPSHOT_DAYS` (default 30).

### API (`~/code/dsh-agents-api`)

Files: `src/sandbox/agentry-sandbox-provider.ts` (provider contract in `src/sandbox/contract.ts`: add optional `snapshot`, `listSnapshots`, `getSnapshot`, `deleteSnapshot`, `restore` that call the service client for the environment's owner; `createEnvironment` passes `snapshot` through), `src/gateway.ts` (routes and handlers next to `environmentAction`), `openapi/agentry.yaml`, `docs/changes/2026-11-xx-environment-snapshots.md`, tests beside the existing environment tests, `AGENTS.md` mirror.

Routes (environment ids are the API's; map to the sandbox id as the other environment calls do; the owner is the session owner, never taken from the body):

- `POST /agents/environments/{environment_id}/snapshots {name?, level?, stop_first?}` -> 202 `EnvironmentSnapshot` (saving).
- `GET /agents/environments/{environment_id}/snapshots` -> `{object: 'list', data: EnvironmentSnapshot[]}`, newest first. The environment's own snapshots are those whose `sandbox_id` equals its sandbox (the list route filters with `?sandbox=`; a snapshot of a deleted environment is not listed here).
- `GET /agents/environments/snapshots` -> every snapshot of the owner (for the "new environment from a snapshot" picker). Register it before `/agents/environments/:environment_id`.
- `GET /agents/environments/snapshots/{snapshot_id}` -> one (poll target).
- `DELETE /agents/environments/snapshots/{snapshot_id}` -> `{id, object: 'snapshot.deleted', deleted: true}`.
- `POST /agents/environments/{environment_id}/restore {snapshot_id}` -> the environment (as `start`/`reset` answer), 409 while the environment has a running chat turn if the existing actions refuse then (match `environmentAction`).
- `POST /agents/environments {..., snapshot_id}` -> creates from a snapshot (pass `snapshot` to the service; the "Setting up..." progress path is unchanged).
- Provider list (`GET /agents/environments/providers`) gains `snapshot_levels: ('workspace'|'disk'|'memory')[]` per provider, from the service's `/v1/backends`.
- `EnvironmentSnapshot` = the service wire shape with `environment_id` in place of `sandbox_id` (null when the environment was deleted) and `source_name` (the environment's name at the time, kept so a snapshot of a deleted environment still reads well; store it in the API's snapshot index only if the service cannot give it, otherwise leave it out and show the id).
- Pass the service's 400/409/429 messages through unchanged (they are plain words). Map `snapshots_off` to 400 `snapshots_off` with "Snapshots are not set up on this service."
- Tests: provider unit tests with the fake service client; gateway tests for each route, owner scoping (another owner's snapshot id is 404), the level list in providers, create-from-snapshot.

Open question for the API plan: does an environment need its snapshots removed when it is deleted? The service says no (snapshots outlive sandboxes, which is how "new environment from snapshot" works after a delete). Recommended: keep them, show them in the all-snapshots list, let expiry clean up.

### Web (`~/code/agentry-web`)

Files: `src/api/types.ts` (`EnvironmentSnapshot`, `snapshot_levels` on the provider row), `src/api/client.ts` (create/list/get/delete snapshot, restore, `snapshot_id` on create), `src/server/allowlist.ts` (the routes above; state-changing ones keep the CSRF rule), `src/ui/sandboxes/EnvironmentDetail.tsx` plus a new `src/ui/sandboxes/SnapshotsSection.tsx`, `src/ui/sandboxes/NewEnvironmentDialog` (or wherever "Runs on" lives: a "Start from" choice), component tests in `tests/component/environment-detail.spec.tsx` and a new `snapshots-section.spec.tsx`, CHANGELOG.

UI placement and behaviour (astryx components only; match the machine-room detail page):

- A "Snapshots" section on the environment detail page, below the files/templates blocks and above the danger zone. Header row: title, count, and a "Save snapshot" button (icon + label like the other actions).
- Save dialog: Name (optional, placeholder "Before the refactor"), Level as a choice list built from the provider's `snapshot_levels` with plain words: "Files only" (workspace: "The files in the workspace; software comes from the template"), "Files and installed software" (disk), "Everything, including running programs" (memory). Hide levels the place lacks; if none are offered show "Snapshots are not set up on this service." Level defaults to Files only. A checkbox "Stop the sandbox while saving" only for disk/memory.
- List rows (dense `List`/`Item`, not cards): name, level word, size (`formatBytes`), age, state. `saving` shows a spinner and "Saving..." and the list polls every 2 s while any row is saving (same polling hook pattern as the settling environments); `failed` shows the error text in the row with only Delete.
- Row menu (icon menu): Restore, New environment from this snapshot, Delete. Restore confirms: "Replaces the files in this sandbox with the snapshot. Changes made since are lost." (disk/memory: "Rebuilds this sandbox from the snapshot. Programs running now stop."). Delete confirms and says it cannot be undone.
- "New environment from snapshot": opens the existing new-environment dialog with `snapshot_id` set and the "Runs on" locked to the snapshot's place when its level is disk/memory (a workspace snapshot works on any place); show "Starting from snapshot <name>" in the dialog.
- The sandboxes list page shows snapshots of deleted environments? Not in this pass. The all-snapshots route is only used by the new-environment dialog's "Start from a snapshot" picker.
- Empty state: "No snapshots yet. Save one before a risky change."
- Not in this pass: scheduled or automatic snapshots, renaming, export/download, snapshot of a chat's environment from the chat header.

Order of work: API provider + routes + OpenAPI (one agent), then web client/types/allow-list and the section (one agent). Live check after both: save a files-only snapshot on a Docker place, change a file, restore, create a new environment from it, delete; repeat with a disk snapshot (install a package, restore, package still there).

### Sandbox service follow-ups (not built)

- Audit events (`snapshot.create`, `.delete`, `sandbox.restore`) and metrics (`op=snapshot|restore`): wait for sandbox-next Phase 1.
- E2B snapshot routes unconfirmed against live E2B (the snapshot call, `templateID` = snapshot id, template delete).
- SSH-machine native workspace snapshot kept on the machine (plan Task 3.6): not built; machines use the generic snapshot kept on the service host. Needs a fake-machine `tar` command.
- Postgres store path for snapshots is untested here (no database in the test run).
- Object storage for the snapshot folder (single host only today).
