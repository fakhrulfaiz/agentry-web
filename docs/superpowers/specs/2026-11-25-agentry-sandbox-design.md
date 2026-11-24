# Agentry Sandbox — design

Date: 2026-11-25. Supersedes the in-process Docker design of the same date (commit `ddbb77b`).
Repos: a new `~/code/agentry-sandbox`, plus `dsh-agents-api` (Agentry API) and `agentry-web`. The DeepSeek Harness (DSH) repository is never modified.

## Intent

A personal project built to a production standard. Agents should be able to work in a real sandbox with full freedom: install anything, become root, use the network, run long processes. That must never put the host at risk. Sandboxes should be able to live anywhere: Docker on this machine now, a cloud service or own VMs later.

To get there, sandboxes become their own service, **Agentry Sandbox**. It creates sandboxes on demand and runs commands and file operations inside them. The Agentry API and the web app reach it through one protocol. Agentry's existing `local` environments stay exactly as they are.

## Words

- **Provider (Agentry):** where an Agentry environment lives. `local` is a folder on the Agentry host and stays the default. `sandbox` is a sandbox in Agentry Sandbox.
- **Backend (Agentry Sandbox):** what actually runs a sandbox. `docker` now; later E2B, Daytona, Kubernetes or own VMs.
- **Template:** the recipe for a sandbox: image, packages, setup commands, environment variables, network, files, resources.
- **Environment / sandbox:** one running or stopped machine made from a template. An Agentry environment on the `sandbox` provider is exactly one sandbox.
- **Runtime:** what is installed inside it (Node, Python, packages). On `local` it is the server bundle; in a sandbox it comes from the image plus whatever the agent installs.

## Goals

1. **The Agentry Sandbox service.** It has an authenticated HTTP API for sandbox lifecycle and templates. A WebSocket connects a client to a sandbox's in-sandbox daemon. A backend interface sits behind it, with `docker` as the first backend.
2. **`agentry-envd`, a daemon in every sandbox.** It is one static Go binary that works in any Linux image. It runs processes (pipes and terminals, stdin, signals, resize, exit status) and file operations (resolve, stat, read, range read, list, atomic write, edit, delete, move, mkdir, watch) over one multiplexed WebSocket protocol.
3. **Every DSH tool runs inside the sandbox when a chat uses a sandbox environment.** This covers bash, file tools with their diff cards, search, terminals, background jobs, `run_code` and subagents. Agentry swaps DSH's `subprocess`, `shell`, `terminals` and `fs` services, for those chats only, with remote versions that talk to `agentry-envd`. It does this through an isolated group in a dedicated preset; the spike proved this mechanism.
4. **Persistent sandboxes.** A sandbox stops after an idle time and starts again on the next chat, with installed software and files intact. "Reset to template" rebuilds it. The workspace can be kept or wiped on reset; keeping it is the default.
5. **Full freedom inside, a hard wall outside.** No DSH per-command confinement inside a sandbox. The agent runs as a non-root user with passwordless sudo. A sandbox has no access to the host filesystem, Docker socket or Agentry credentials. Network is on unless the template turns it off.
6. **Ready for external backends.** A new backend implements one interface: create, start, stop, destroy, status, and how to reach its `agentry-envd`. Nothing in Agentry or the web app changes.
7. **`local` unchanged.** Without Agentry Sandbox configured, or with it down, Agentry behaves as today. The `sandbox` provider shows as unavailable, with the reason.
8. **Refined Sandboxes UI** with Environments, Templates and Providers. Environment status and actions, a template editor, provider availability, and environment choice in new chats.

## Non-goals

- No external backend is built now: only the interface, plus a fake backend used in tests.
- No change to the DSH repository.
- No per-user harness containers (the hosting plan in AGENTS.md stays separate and compatible).
- No GPU, billing or image registry management. Public images, plus private images through a configured registry login on the service host.
- The web browser never talks to Agentry Sandbox directly.

## Anti-goals (failures even if it works)

- A sandbox process reaching host files, the Docker socket, Agentry's database or credentials.
- A chat on a sandbox environment running anything on the Agentry host, including a silent fallback when the sandbox is down. The tool call fails with a clear error instead.
- Chats on `local` environments changing behaviour.
- Agentry Sandbox credentials reaching the browser.
- A sandbox the user cannot see, stop or delete from the UI (no orphans): every container is labelled, and the service reconciles labels with its records at start.

## Approaches considered

How the agent's DSH tools reach a sandbox on another server:

1. **Remote DSH services over Agentry Sandbox's own protocol (chosen).** Agentry provides remote `subprocess`, `fs` (and dependants) inside an isolated preset group. These speak to `agentry-envd` through the service, so every DSH tool works and the sandbox can be anywhere. Cost: the most code (protocol, daemon, two remote services). It is our own design and the same for every backend.
2. **Each sandbox exposes SSH, and Agentry reuses DSH's SSH plugins.** Less code, but those plugins are configured with one fixed host per profile and do not reconnect (AGENTS.md warns against them). That fights per-chat sandboxes.
3. **The service exposes MCP tools instead of run and files.** Agents would lose DSH's own bash, edits with diff cards, terminals and `run_code`. Rejected.

Where the code lives: a separate service (chosen) rather than inside the Agentry API. This keeps the Docker socket and future cloud credentials out of the process that runs model output, and lets sandboxes run on other machines.

## Architecture

```
agentry-web ──BFF──▶ Agentry API (DSH + @agentry/api) ──HTTP/WS + key──▶ Agentry Sandbox ──Docker API──▶ container
                         │  local provider (unchanged)                       │                              └─ agentry-envd
                         └─ sandbox provider + remote fs/subprocess ─────────┘ WS relay ────────────────────────▲
```

### 1. Agentry Sandbox (`~/code/agentry-sandbox`, TypeScript, Node 24, pnpm)

- **HTTP API** under `/v1`, authenticated with a bearer API key. Keys are stored as SHA-256 hashes, as in Agentry API's `apiKeys` mode. Every request carries an `owner` header that the trusted caller sets. Records and container labels are scoped by owner.
  - Sandboxes: `POST /sandboxes` (template id or inline template, name, owner), `GET /sandboxes`, `GET /sandboxes/{id}`, `POST /sandboxes/{id}/start|stop|reset`, `DELETE /sandboxes/{id}`.
  - Templates: CRUD under `/templates`. Agentry keeps its own template records; the service accepts the template inline at create and reset. So the service's templates exist for other clients, and Agentry may use either.
  - `GET /backends`: availability, version and capabilities.
  - `GET /health`.
  - `GET /sandboxes/{id}/connect` (WebSocket): the service relays frames to that sandbox's `agentry-envd`, and starts the sandbox first if it is stopped.
- **State:** a Postgres database `agentry_sandbox` on the existing Postgres, with forward-only migrations. It holds sandbox records (id, owner, name, backend, template snapshot, status, backend handle, created/started/last-used times, error) and templates.
- **Backend interface:** `create(spec) → handle`, `start`, `stop`, `destroy`, `status`, `connect(handle) → duplex stream to envd`, `exec bootstrap` (to install envd), plus `capabilities` (persistent, network control, resource limits, template fields).
- **Docker backend:**
  - Uses the Docker Engine API over the local socket or `DOCKER_HOST`.
  - Pulls without a credential helper by default, because the Windows helper fails in WSL on this machine; a registry login can be configured.
  - One container per sandbox, named `agentry-sbx-<id>`, labelled with owner and sandbox id.
  - `agentry-envd` is copied in at create and started as the container's main process through `--init`.
  - A named volume holds the workspace (`/workspace`), so Reset can keep it.
  - Template packages are installed with the image's package manager (apt or apk detected), then setup commands run.
  - Resource defaults: 2 CPUs, 4 GiB memory, a pids limit; configurable.
  - Network: the default bridge, or `none` when the template turns it off.
  - No host mounts, no privileged mode, and no Docker socket inside.
- **Default image:** Debian slim plus Node, Python 3 with the Office packages Agentry's skills use, pnpm, git, curl, build tools and sudo, with a non-root `agent` user that has passwordless sudo. It is built from a Dockerfile in the repo and tagged `agentry/sandbox:<version>`.
- **Lifecycle:**
  - An idle timer stops sandboxes with no connection for N minutes (default 30).
  - On start, the service reconciles its records with labelled containers: it adopts or marks missing ones, and reports unknown containers.
  - Reset recreates the container from the template, keeps or wipes the workspace volume, and leaves files in the volume owned by the `agent` user.
- **Runs** under herdr in development (`agentry-sandbox` terminal), and as its own container on the Docker host in deployment, holding the Docker socket.

### 2. `agentry-envd` (Go, a static binary in the same repo)

- It listens on a Unix socket inside the sandbox, and the service reaches it through the backend's connect path. For Docker, that is an exec attach to a relay; the builder picks the most robust Docker path. Every sandbox serves the same protocol, so external backends only need to reach it.
- **Protocol:** WebSocket with multiplexed channels. JSON control frames carry request id, op and args; binary frames carry stream data per channel id. It versions with a `hello` exchange. Operations:
  - **Process:** `spawn` (argv, cwd, env, stdio modes, terminal size), `stdin` writes and close, `signal`, `resize`, `wait` (exit code or signal), output with backpressure, and `resolveExecutable`. It also reports `terminalEnvironment` (platform and preferred shell).
  - **Files:** `resolve` (realpath with cwd), `stat`, `lstat`, `readBytes` (with a cap), `readRange`, `streamText`, `listDir`, `writeAtomic`, `delete`, `move`, `mkdirp`, and `watch`. Edits and patches are done by the Agentry side (read, then compare-and-write with the version it read), so stale-write guards behave as DSH expects.
- Processes run as the `agent` user, in their own process group, so kill reaches children. Everything is subject only to the container's limits.

### 3. Agentry API (`dsh-agents-api`, inside `@agentry/api`)

- **`sandbox` provider in the `SandboxRegistry`.** It is registered when `sandbox.url` and `sandbox.key` are configured. It maps environment create, delete, files, start, stop and reset to Agentry Sandbox, and reports availability (with the reason when the service is unreachable or the key is refused).
- **`agentry-sandbox` preset.** It has the same plugins as `agentry`, with one isolated group for `subprocess`, `shell`, `terminals` and `fs`, plus their consumers: bash, file tools, search, terminals, jobs and `run_code`'s runtime. The builder confirms the full set of services that touch processes or files. Inside the group:
  - `@agentry/api`'s `RemoteSubprocessRuntime` (a DSH `SubprocessRuntime`).
  - `RemoteFileSystem` (a DSH `FileSystem`).
  - `@deepseek-ai/dsh-bash-local`, unconfined.
  - The stock consumers.

  These ship as named exports of `@agentry/api`, not as file paths.
- **Routing:** a chat on a sandbox environment gets its working directory set to that sandbox's workspace, under a per-sandbox root such as `/workspace` mapped by sandbox id. The remote services find the sandbox from the call's `cwd`, which every spawn and every `fs.resolve`/`lstat` carries, using a registry Agentry keeps. `FsTarget.targetKey` encodes the sandbox id, so later file operations stay on that sandbox. A call that cannot be routed fails; it never runs on the host. The builder verifies that every DSH call path carries a cwd or target.
- **Connection pool:** one WebSocket per active sandbox, with reconnect and backoff. Live processes fail with a clear error if the connection drops. A connect starts a stopped sandbox, and the chat shows "Starting sandbox…".
- **Session start:** a chat whose environment is on the `sandbox` provider mounts the `agentry-sandbox` preset (`mountDefaultPreset(agentCtx, 'agentry-sandbox')`, with the matching `acquireScope`). All other chats keep `agentry`.
- **Host-only data:**
  - Skills with scripts, and the agent's selected skills, are synced into the sandbox under `/opt/agentry/skills/...`. The skill tool shows that path for sandbox chats. The builder settles how, either a skill-provider path mapping or a copy at session start.
  - Artifacts, deliverables and the web file viewer read sandbox files through the provider's files API instead of the host disk.
- **API:**
  - Environments gain `provider`, `name`, `status` (`provisioning`, `running`, `stopped`, `failed`), `image` and `last_used_at`.
  - New routes: `POST /agents/environments/{id}/start|stop|reset` (with a `keep_workspace` flag).
  - `GET /agents/environments/providers` reports per-provider `available` and `reason`.
  - OpenAPI is updated.

### 4. Agentry Web

- **Sandboxes page:** Environments, Templates and Providers tabs.
  - **Environment cards:** name, provider badge, status (running, stopped, provisioning, failed), template, image, last used.
  - **Environment detail:** files, a "New chat here" button, and Start, Stop, Reset (keep or wipe workspace) and Delete. Reset and Delete ask for confirmation.
  - **New environment dialog:** name, provider (unavailable ones are disabled with the reason) and template.
  - **Template editor:** image, packages, setup commands, environment variables, network on/off, resources and files. Fields a provider does not support are disabled, with the reason.
  - **Providers tab:** `local` with the bundled runtimes; `sandbox` with availability, the service version, its backends and the default image's runtimes.
- **New chat:** the composer's existing Environment menu shows provider and status. Choosing a stopped sandbox starts it on send.
- All of this goes through the BFF and the Agentry API; new allow-list rules cover the new routes.

## Constraints

- Plugin-only on the Agentry API side: DSH is used through its public service contracts and preset isolation.
- Owner scoping everywhere: Agentry records, service records and container labels.
- Secrets: the service key lives only in the Agentry API config. The browser and the BFF never hold it.
- astryx UI with StyleX layout only; CHANGELOG entries in all three repos; OpenAPI drift tests for both APIs.
- Testing:
  - Unit and contract tests per change.
  - Protocol conformance tests for `agentry-envd`.
  - Docker integration tests that run when Docker is present.
  - A fake backend for Agentry-side tests.
  - One e2e run before merge.
- Tooling: Go is not installed on this machine. Installing a user-local Go toolchain (`~/.local/go`) is part of the first plan.

## Delivery (three plans, in order)

1. **Agentry Sandbox + `agentry-envd` + Docker backend.** Service API, protocol, daemon, Docker backend, default image, lifecycle and reconciliation. Done when a test client can create a sandbox, run an interactive process and read and write files.
2. **Agentry API integration.** `sandbox` provider, remote `subprocess` and `fs` services, `agentry-sandbox` preset, routing, skills sync, files through the provider, API routes. Done when a real chat on a sandbox environment runs bash, edits files with diff cards and uses a terminal inside the container, and `local` chats are unchanged.
3. **Agentry Web.** The Sandboxes UI and the composer changes above.

## Left to the builder

- The exact Docker transport to `agentry-envd` (exec attach or a socket relay) and the protocol's frame details.
- The full list of DSH services to isolate, and confirmation that every call path carries a cwd or target.
- How skills reach the sandbox (path mapping or sync).
- The default image's exact package list and tag scheme.
- How the idle timer and `last_used_at` work.
- UI copy.
