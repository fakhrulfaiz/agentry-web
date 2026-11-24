# Agentry API ↔ Agentry Sandbox Integration Plan (plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A chat on a `sandbox` environment runs every DSH tool inside its Agentry Sandbox container, while `local` chats stay exactly as they are. Tools covered: bash, file tools with diff cards, search, terminals, jobs, `run_code`, `present`, subagents.

**Architecture:**
- `@agentry/api` gains a `sandbox` provider in its `SandboxRegistry`. It talks to the Agentry Sandbox service over HTTP.
- `@agentry/api` also gains remote DSH services: `subprocess`, `fs`, `workingDirectory`, `sandbox`, `sandboxPolicy` and `ptcRuntime`. They reach the sandbox's `envd` through the service relay.
- For each active sandbox, Agentry registers a preset at runtime (`presets.register`), `agentry-sbx-<sandboxId>`. It is the `agentry` preset's rows with the process and file consumers moved into one isolated group, bound to that sandbox.
- A chat on that environment mounts that preset. No call is routed by path.

**Tech Stack:**
- TypeScript in `~/code/dsh-agents-api` (Cordis plugins, Vitest, Postgres).
- DSH service contracts: `@deepseek-ai/dsh-subprocess`, `-fs`, `-sandbox`, `-ptc-runtime`, `-working-directory`.
- The `@agentry/sandbox` client: the generated `envd` client and REST types.

**Spec:** `docs/superpowers/specs/2026-11-25-agentry-sandbox-design.md` (§3 Agentry API; Goals 3, 4, 7; Constraints; Delivery 2). Plan 1 shipped the service, at `~/code/agentry-sandbox`.

## Global Constraints

- Never modify the DSH repo. Everything lives in `@agentry/api`, as plugins and config.
- `local` environments and chats behave exactly as before; their tests stay green unchanged.
- **Configuration:** `sandbox.url` and `sandbox.key`. The key lives only in the Agentry API config, never in an API response, a log line or the web app. The `sandbox` provider is registered only when both are set, and reports `available: false` with a reason when the service is unreachable or refuses the key.
- **Fail closed:** a sandbox chat never runs anything on the host. An unreachable sandbox fails the tool call with "Sandbox <name> is not reachable: …".
- **Owner:** every call to the service carries `X-Agentry-Owner` = the Agentry owner id.
- **Users inside a sandbox:** tool processes run as `agent` (through the relay's `X-Envd-User`). The working directory is `/workspace` (or the Task 1 fallback path).
- **Wire compatibility:** environments keep their existing `status`, and gain `provider`, `name`, `state` (`provisioning`, `running`, `stopped`, `failed`; always `running` for `local`), `image` and `last_used_at`. New routes: `POST /agents/environments/{id}/start|stop|reset` (`{ keep_workspace?: boolean }`). OpenAPI is updated, with the drift test green.
- **Dependency:** `@agentry/sandbox` is consumed as `link:../agentry-sandbox` through a `./client` package export, built with `tsc` into `agentry-sandbox/dist`. Agentry never imports the service's server code, except in tests (see Task 2).
- **Tests and housekeeping:**
  - Unit and contract tests per task; Docker-backed tests are skipped when Docker or the service is absent.
  - One live chat check (Task 7) and one e2e run before merge.
  - CHANGELOG entries in both repos.

## Review Focus

1. **The sandbox service stops mid-chat:** the tool call fails with a clear message, and the chat continues and recovers on the next call once the service is back. Test in Task 4.
2. **A long-running bash command whose caller cancels** (the user presses Stop): the process inside the container is signalled and the relay stream closed, with nothing left running. Test in Task 4.
3. **A large file read or write** (10 MB) through the remote file service: it works within the DSH caps, and over-cap reads fail with DSH's normal error, not a crash. Test in Task 4.
4. **Two chats on the same sandbox environment:** they share one preset registration, which is released only when both end. Test in Task 5.
5. **A sandbox environment deleted while a chat is open:** the next tool call fails cleanly, and the per-sandbox preset is unregistered. Test in Task 5.

---

### Task 1: Spike: per-sandbox preset with isolated remote services (throwaway)

**Goal:** prove, in a real chat against the running service, the mechanism and the path model before building them properly.

- [ ] **Step 1:** on a scratch branch, write minimal throwaway remote services and register a per-sandbox preset at runtime.
  - Remote `subprocess`: only `spawn` via `process.Start`.
  - Remote `fs`: `resolve`, `stat`, `readText` and `writeText` via `envd`.
  - The preset is the `agentry` rows, with `tool-bash` and `tool-fs` in a group isolating `subprocess`, `shell`, `fs` and `workingDirectory`, plus `@deepseek-ai/dsh-bash-local` and `@deepseek-ai/dsh-working-directory` inside it.
  - Create a session whose cwd is `/workspace`.
- [ ] **Step 2:** ask the chat to run `pwd; whoami; uname -a` and to write then read `notes.txt`. Expected: Linux container output, user `agent`, cwd `/workspace`, and the file present inside the container.
- [ ] **Step 3: record the path model as a ledger ruling.**
  - If the host rejects a cwd that doesn't exist on the host (it is validated outside the isolated group), switch to the fallback: a per-sandbox host-mirror path `/agentry/sandboxes/<sandboxId>/workspace`, an empty directory created on the host. The remote services map that prefix to `/workspace` in every path in and out: `spawn` cwd, `processPath`, `displayPath`, and command output is not rewritten.
  - Also record which DSH services the isolated group must cover. That is everything the preset's tools inject that touches processes or files: `subprocess`, `shell`, `fs`, `workingDirectory`, `sandbox`, `sandboxPolicy`, `ptcRuntime` and `terminals`.
- [ ] **Step 4:** delete the spike, and keep only the ledger rulings.

### Task 2: `@agentry/sandbox` client package and Agentry config

**Files:**
- `agentry-sandbox`:
  - `src/client/index.ts`: exports the `envd` client, `runInEnvd`, the wire types, and `createSandboxApi(opts)`, a REST client for `/v1`.
  - `package.json` gets `exports["./client"]`; `tsconfig.build.json` emits `dist/`; `pnpm build`.
- `dsh-agents-api`:
  - `package.json` dependency `"@agentry/sandbox": "link:../agentry-sandbox"`.
  - Config `sandbox.url` and `sandbox.key` in the runtime config (`src/runtime-config.ts`), plus README rows.

**Interfaces:**
- `createSandboxApi({ url, key, owner }): SandboxApi`.
- `SandboxApi`: `{ backends(); list(); get(id); create({ name, template_id?, template? }); start(id); stop(id); reset(id, { keepWorkspace }); remove(id); envd(id): EnvdClient }`.
  - It returns the plan 1 wire objects.
  - It throws `SandboxApiError { status, code, message }`.
  - `envd(id)` is `createEnvdClient({ baseUrl: url + '/v1/sandboxes/' + id + '/envd', accessToken: '', headers: { Authorization, 'X-Agentry-Owner' }, userVia: 'header' })`.
- Tests in `agentry-sandbox` may start its own server with the fake backend. `dsh-agents-api` tests use the same through a test-only import of `@agentry/sandbox/testing` (`startTestService()`: the server, the memory store and the fake backend, returning `{ url, key, backend, close }`). Add that export too.

- [ ] Write failing tests: the client round-trips against `startTestService`; errors map to `SandboxApiError`; the config loader rejects a URL without a key.
- [ ] Implement; run both repos' suites; commit in both.

### Task 3: The `sandbox` environment provider

**Files:**
- `dsh-agents-api/src/sandbox/agentry-sandbox-provider.ts`
- Registration in `src/index.ts` next to `local`
- Migration `src/store/migrations/0005-environment-sandbox.sql`, adding environment columns `name`, `state` and `last_used_at` (`provider` and `image` already live in `provider_metadata`, so promote them to the wire fields only)
- `src/environment/environment-compat.ts` (wire mapping)
- `tests/sandbox-provider.spec.ts`

**Interfaces:**
- `createAgentrySandboxProvider(api: (owner) => SandboxApi): SandboxProvider`, with `kind: 'sandbox'`.
- `capabilities`: `{ templateFields: ['image', 'packages', 'setup_commands', 'env', 'network', 'files'], files: true, exec: true }`.
- Calls map onto the service:
  - `create` → `api.create`; `provider_metadata` = `{ sandbox_id, image }`;
  - `status` → `api.get` mapped to `EnvironmentStatus`;
  - `destroy` → `api.remove`;
  - `listFiles`, `readFile` and `writeFile` go through `api.envd(id)` as user `agent`, with paths relative to `/workspace`.
- New gateway methods and routes `POST /agents/environments/{id}/start|stop|reset` call `api.start`, `api.stop` and `api.reset`. They answer 409 for `local` ("This environment does not start or stop").
- `GET /agents/environments/providers` lists `sandbox` with `available`, `reason`, `version` and `backends` (from `api.backends()`).

- [ ] Write failing tests against `startTestService`:
  - create, status, files and destroy work;
  - start, stop and reset change `state`;
  - an unreachable URL gives `available: false` with a reason;
  - a wrong key gives `available: false` with "key refused";
  - the key never appears in any response body;
  - environments from another owner are 404.
- [ ] Implement; OpenAPI and the drift test; CHANGELOG; commit.

### Task 4: Remote DSH services

**Files:**
- `dsh-agents-api/src/sandbox/remote/{subprocess.ts,fs.ts,sandbox.ts,ptc.ts,paths.ts,plugin.ts}`
- Package export `@agentry/api/sandbox-runtime` (tsdown entry, plus `package.json` `exports`)
- `tests/sandbox-remote-*.spec.ts`

**Interfaces:**
- `plugin.ts` is the Cordis plugin, config `{ sandboxId: string; url: string; key: string; owner: string; workspace: string }`. It provides these services within its isolated group:
  - **`subprocess` (`RemoteSubprocessRuntime extends SubprocessRuntime`):**
    - `spawn` maps to `process.Start` (stdin via `StreamInput`, signals via `SendSignal`, `terminate`/`waitForExit` by pid). Outputs are offset readers over the streamed `stdout`/`stderr`, with the spill behaviour of `SubprocessOutputReader`.
    - `spawnTerminal` uses `process.Start` with `pty` (resize via `Update`).
    - `resolveExecutable` uses `command -v` through `envd`.
    - `terminalEnvironment` returns `{ platform: 'linux', shell: '/bin/bash' | '/bin/sh' }`.
  - **`fs` (`RemoteFileSystem extends FileSystem`):** all 18 abstract methods.
    - `resolve` does a `realpath` via `envd`, and the `targetKey` is `sbx:<sandboxId>:<path>`.
    - Reads go through `/files` and `stat`; writes through `/files` to a temp file plus `Move` (atomic).
    - `editText` and `patchText` read, apply DSH's edit/patch helpers locally, then write only if the content hash is unchanged (the stale guard).
    - `watch` uses `WatchDir`.
    - `sandboxMode` returns `undefined`.
  - **`sandbox`:** an unconfined pass-through, where `confine` returns the original argv (the container is the wall). **`sandboxPolicy`:** mode `danger-full-access` with no escalation.
  - **`workingDirectory`:** `@deepseek-ai/dsh-working-directory` mounted inside the group, so it validates paths with the remote `fs`.
  - **`ptcRuntime`:** `@deepseek-ai/dsh-ptc-runtime-node` mounted inside the group; it uses the remote `subprocess`, `fs` and `sandbox`. This needs Node in the image, which the default image has; other images report "run_code needs Node in this sandbox".
- `paths.ts` applies Task 1's path model (identity, or the host-mirror prefix mapping).

- [ ] Write failing tests:
  - Contract tests against a live sandbox (create one through `startTestService` with the Docker backend, skipped without Docker): spawn with exit code and signal; stdin round-trip; terminal resize; output readers past the spill threshold; `fs` stat/read/range/write/edit/patch/move/delete/list/watch.
  - Review Focus 1–3: service down → a clear error, then recovery; cancel → process gone (`ps` inside shows none); 10 MB round-trip, and an over-cap read returns DSH's cap error.
  - If DSH ships conformance suites for `SubprocessRuntime` or `FileSystem` (look in `packages/subprocess/*/tests` and `packages/fs/*/tests`), run them against the remote services too.
- [ ] Implement; commit.

### Task 5: Per-sandbox presets and session wiring

**Files:**
- `dsh-agents-api/src/sandbox/presets.ts`
- `src/gateway.ts` (`buildAgentSetup`, `resolveSessionWorkspace`, the subagent preset choice)
- `tests/sandbox-presets.spec.ts`

**Interfaces:**
- `createSandboxPresets(presets: AgentPresetRegistry, base: () => PresetDefinition['plugins'], config): { acquire(owner, sandboxId): Promise<{ presetId: string } & AsyncDisposable> }`.
  - It reference-counts per sandbox. The first `acquire` registers `agentry-sbx-<sandboxId>`.
  - The rows are the `preset-agentry` rows read from `@agentry/api`'s `cordis.patch.yml` at startup, with every consumer of the isolated services moved into one `group: true, isolate: { subprocess, shell, fs, workingDirectory, sandbox, sandboxPolicy, ptcRuntime, terminals }` row. That row also holds `@agentry/api/sandbox-runtime`.
  - The last dispose unregisters after a 5-minute grace period.
- Sessions:
  - A session on a `sandbox` environment gets cwd = Task 1's path. `buildAgentSetup` mounts `agentry-sbx-<id>` (`mountDefaultPreset(agentCtx, presetId)` plus the matching `acquireScope`).
  - Subagents inherit it; selecting another preset from inside is refused.
- Skills:
  - Selected skills are copied into the sandbox under `/opt/agentry/skills/<name>` at the first acquire, as root, read-only for `agent`.
  - The Agentry skill provider reports that path for sandbox sessions.

- [ ] Write failing tests:
  - Review Focus 4: two sessions, one registration, released after both end.
  - Review Focus 5: environment deleted → the next tool call fails cleanly and the preset is unregistered.
  - A `local` session still mounts `agentry`.
  - The rows of a registered preset contain exactly one isolated group holding `tool-bash`, `tool-fs`, `tool-fs-search`, `tool-jobs`, `tool-present`, `tool-workflow`/`workflow-ptc`, and the subagent tools that spawn processes.
- [ ] Implement; commit.

### Task 6: Workspace data through the provider

**Files:**
- `dsh-agents-api`: deliverables (`src/history/deliverables.ts` reads), session artifacts and environment file routes, plus any other code that reads a session workspace from host disk.
- Tests.

- [ ] Write failing tests: a sandbox session's deliverables, artifacts listing, file read and environment file listing come from the sandbox (through `provider.listFiles`/`readFile`) and match what the agent wrote. A `local` session still reads the host disk.
- [ ] Implement by routing every workspace read through `SandboxRegistry.require(record.provider)` when the session's environment is a sandbox; commit.

### Task 7: Live check, docs, review

- [ ] Start `agentry-sandbox` and the Agentry API in herdr, with `sandbox.url`/`sandbox.key` set from the dev launcher's key file. Then, with the web composer's Environment menu or `ask.mjs`, create a sandbox environment and a chat on it.
- [ ] **Live checks:**
  - bash `uname -a; whoami`: Debian, `agent`;
  - `sudo apt-get install -y cowsay` and run it;
  - write a file, then edit it (diff card);
  - `run_code`;
  - `present` a file, which shows under Artifacts;
  - stop the environment, send another message, and it starts again with `cowsay` still installed;
  - a `local` chat still works.
- [ ] Update AGENTS.md and README (provider, config, security notes) and both CHANGELOGs; run full suites plus one e2e run in `agentry-web`.
- [ ] Whole-branch review (one fresh reviewer, most capable model), the fix pass, merge to `main` in both repos.
