# Agentry Sandbox Service Implementation Plan (plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone Agentry Sandbox service that creates hardened Docker sandboxes on demand. Each sandbox runs E2B's `envd`, reached through an authenticated relay. A test client can create a sandbox, run a streaming process, read and write files, stop and start it with installs intact, and delete it.

**Architecture:** A TypeScript `node:http` service with Postgres state and a `Backend` interface. The Docker backend uses the Docker Engine API through `dockerode`. `envd` is built from a pinned upstream commit into a scratch image. The service extracts it and injects it into every container, whatever the image. Callers talk Connect-RPC to `envd` through `/v1/sandboxes/{id}/envd/*`. The service adds the per-sandbox access token and keeps `envd` reachable only on `127.0.0.1` (Docker Desktop) or the container IP (native Docker).

**Tech Stack:** Node 24, pnpm 11, TypeScript (strict, ESM), Vitest, `pg`, `dockerode`, `@connectrpc/connect` + `@connectrpc/connect-node`, `@bufbuild/protobuf` with `@bufbuild/buf` + `@bufbuild/protoc-gen-es` for code generation, Docker 29 (Docker Desktop on WSL2 here).

**Spec:** `docs/superpowers/specs/2026-11-25-agentry-sandbox-design.md` (sections Goals 1, 2, 4, 5, 6; Architecture §1 and §2; Constraints; Delivery 1).

## Global Constraints

- New repository `~/code/agentry-sandbox` (git; commits as `fakhrulfaiz <fakhrulfaiz2003@gmail.com>`; no AI attribution anywhere).
- Toolchain: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH`. Exact dependency versions (no `^`/`~`).
- `envd`:
  - upstream `https://github.com/e2b-dev/runtime.git`, tag `envd-v0.6.13`, commit `2acf2d51bd1e2fe146914f24c44f7ee07d2213c5` (verified at build);
  - built `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOWORK=off GOTOOLCHAIN=auto go build -ldflags="-s -w" -trimpath` in `golang:1.27.4`, so no Go on the host;
  - run as `/opt/agentry/envd --isnotfc --no-cgroups --port 49983`;
  - Apache-2.0 `LICENSE` and NOTICE kept in the repo (`third_party/envd/`) and in the image.
- `envd` port 49983 is never published on a non-loopback address. Every `envd` call carries `X-Access-Token`. The token is `hex(HMAC-SHA256(config.secret, sandboxId))`, never stored.
- Hardened containers:
  - default seccomp;
  - `CapDrop: ['ALL']` plus `CapAdd: ['CHOWN','DAC_OVERRIDE','FOWNER','FSETID','KILL','SETGID','SETUID','SETPCAP','NET_BIND_SERVICE','SYS_CHROOT','AUDIT_WRITE','MKNOD']`;
  - `Privileged: false`, `Init: true`, `PidsLimit: 4096`, `NanoCpus: 2e9`, `Memory: 4 GiB` (configurable);
  - no bind mounts, no Docker socket;
  - `Runtime` from config (`runc` default; `runsc` allowed).
- Network:
  - one bridge per owner, `agentry-sbx-<sha256(owner)[0..12]>`, with `com.docker.network.bridge.enable_icc=false`;
  - egress allowed to the internet, and dropped to `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`, and the host gateway;
  - a network-off template drops all new egress from that container.
- Names:
  - containers `agentry-sbx-<id>`;
  - workspace volumes `agentry-sbx-<id>-workspace`, mounted at `/workspace`;
  - labels `agentry.sandbox.id`, `agentry.sandbox.owner`, `agentry.managed=true`.
- Ids: sandboxes `sbx_` + 32 hex characters; templates `tpl_` + 32 hex characters.
- Sandbox user: `agent`, uid 1000, home `/home/agent`, passwordless sudo, created when the image lacks it. Default workdir `/workspace`. `envd` `defaultUser: 'agent'`.
- HTTP:
  - every route needs `Authorization: Bearer <key>` (keys configured as `sha256:<hex>` hashes) and `X-Agentry-Owner: <owner>`;
  - errors are `{ "error": { "code": string, "message": string } }`;
  - records are scoped by owner, and another owner's id answers 404.
- Image pulls use the empty auth config, never the Windows credential helper. Builds run with `DOCKER_CONFIG` pointing at a credential-free config.
- Every behaviour change gets a `CHANGELOG.md` bullet. Docker-dependent tests are skipped (`describe.skipIf(!dockerAvailable)`) when Docker is absent, and run here.

## Review Focus

1. **Docker down or restarted mid-life:** `GET /v1/backends` reports `available: false` with a reason, and sandbox operations answer 503 `backend_unavailable` instead of hanging or 500. Test in Task 7.
2. **Two start requests for one stopped sandbox at the same time** (a relay call and an explicit start): exactly one container start, and both callers get the running sandbox. Test in Task 6.
3. **A relay client disconnects mid-stream:** the upstream `envd` request is aborted, and the service keeps no dangling socket. The process inside keeps running (that is `envd`'s contract). Test in Task 7.
4. **Owner B asks for owner A's sandbox, template or relay path:** 404 `not_found`, identical to a missing id. Test in Task 7.
5. **`envd` never becomes healthy after start** (a bad image, or no `/bin/sh` for setup): the state becomes `failed` with the error text within the start timeout (60 s), and a later delete still cleans up. Test in Task 5.

---

### Task 1: Repository, config and conventions

**Files:**
- Create: `~/code/agentry-sandbox/{package.json,tsconfig.json,vitest.config.ts,.gitignore,AGENTS.md,README.md,CHANGELOG.md}`, `CLAUDE.md` → symlink to `AGENTS.md`
- Create: `src/config.ts`, `tests/config.spec.ts`

**Interfaces:**
- Produces: `loadConfig(env: NodeJS.ProcessEnv): SandboxConfig`, `class ConfigError extends Error`.
- `SandboxConfig`:
  - `{ port: number; databaseUrl: string; apiKeyHashes: string[]; secret: string; docker: { socketPath?: string; host?: string }; envdImage: string; defaultImage: string; idleStopMinutes: number; startTimeoutMs: number; resources: { cpus: number; memoryBytes: number; pids: number }; envdReach: 'loopback' | 'ip'; runtime: 'runc' | 'runsc'; egress: boolean }`.
- Env names: `AGENTRY_SANDBOX_PORT` (default 3090), `AGENTRY_SANDBOX_DATABASE_URL` (required), `AGENTRY_SANDBOX_API_KEYS` (required, comma-separated `sha256:<64 hex>`), `AGENTRY_SANDBOX_SECRET` (required, ≥ 32 bytes), `DOCKER_HOST` (optional), `AGENTRY_SANDBOX_ENVD_IMAGE` (default `agentry/envd:envd-v0.6.13`), `AGENTRY_SANDBOX_DEFAULT_IMAGE` (default `agentry/sandbox:1`), `AGENTRY_SANDBOX_IDLE_MINUTES` (30), `AGENTRY_SANDBOX_START_TIMEOUT_MS` (60000), `AGENTRY_SANDBOX_CPUS` (2), `AGENTRY_SANDBOX_MEMORY_MB` (4096), `AGENTRY_SANDBOX_PIDS` (4096), `AGENTRY_SANDBOX_ENVD_REACH` (`loopback`), `AGENTRY_SANDBOX_RUNTIME` (`runc`), `AGENTRY_SANDBOX_EGRESS` (`on`).

- [ ] **Step 1:** `git init`. Write `package.json` with `"type": "module"`, scripts `dev` (`tsx watch src/main.ts`), `start`, `build` (`tsc -p tsconfig.json`), `typecheck`, `test` (`vitest run`), `gen` (Task 3) and `images:build` (Task 2), plus exact pinned devDependencies. Write AGENTS.md: purpose, the Global Constraints above, commands, the herdr dev command (`hc run --bg --no-parent --outlive-parent --name agentry-sandbox -- pnpm dev`), "never modify DSH; never publish envd's port off loopback".
- [ ] **Step 2: failing tests** `tests/config.spec.ts`:
  - `loads defaults with the three required values`: expect `port` 3090, `idleStopMinutes` 30, `envdReach` `'loopback'`, `runtime` `'runc'`, `resources.memoryBytes` 4294967296.
  - `rejects a missing database url / key list / short secret` with a `ConfigError` naming the variable.
  - `rejects a key that is not sha256:<64 hex>`.
  - `rejects envdReach other than loopback|ip and runtime other than runc|runsc`.
- [ ] **Step 3:** run `pnpm vitest run tests/config.spec.ts`. Expect FAIL (module missing).
- [ ] **Step 4:** implement `src/config.ts`.
- [ ] **Step 5:** run it again. Expect PASS. Run `pnpm typecheck`; expect clean.
- [ ] **Step 6:** commit `chore: scaffold agentry-sandbox with config`.

### Task 2: `envd` image, default sandbox image, vendored spec

**Files:**
- Create: `images/envd/Dockerfile`, `images/sandbox/Dockerfile`, `scripts/images-build.sh`, `scripts/vendor-envd-spec.sh`, `third_party/envd/{LICENSE,NOTICE.md,spec/process/process.proto,spec/filesystem/filesystem.proto,spec/envd.yaml,UPSTREAM}`, `tests/support/docker.ts`, `tests/images.spec.ts`

**Interfaces:**
- Produces: image `agentry/envd:envd-v0.6.13` (`FROM scratch`, `/envd` plus `/LICENSE`); image `agentry/sandbox:1`; test helper `dockerAvailable: boolean` and `docker(): Docker`.

- [ ] **Step 1:** `images/envd/Dockerfile`:
  - stage `golang:1.27.4`: clone the upstream, check out the tag, verify `git rev-parse HEAD` equals the pinned commit (fail otherwise), build in `packages/envd` with the flags from Global Constraints;
  - final stage `FROM scratch`, copying `/out/envd` to `/envd` and the upstream `LICENSE` to `/LICENSE`.
- [ ] **Step 2:** `images/sandbox/Dockerfile`, `FROM debian:bookworm-slim`:
  - install `ca-certificates curl git sudo build-essential python3 python3-pip python3-venv unzip xz-utils procps`, Node 24 (official tarball), pnpm 11 (`npm i -g pnpm@11`), and Python `numpy pandas python-docx python-pptx openpyxl Pillow lxml XlsxWriter` (`pip --break-system-packages`);
  - `useradd -m -u 1000 -s /bin/bash agent`, plus `/etc/sudoers.d/agent` with `agent ALL=(ALL) NOPASSWD:ALL` (mode 0440);
  - `mkdir /workspace && chown agent:agent /workspace`;
  - no `envd` inside; it is injected at create.
- [ ] **Step 3:** `scripts/images-build.sh`: build both images with `DOCKER_CONFIG` set to a temp dir containing `{}`. Wire it to `pnpm images:build`.
- [ ] **Step 4:** `scripts/vendor-envd-spec.sh`: from a container (`alpine/git`), fetch the pinned commit and copy the files into `third_party/envd/`. Write `UPSTREAM` with the URL, tag and commit, and write `NOTICE.md`.
- [ ] **Step 5: failing test** `tests/images.spec.ts` (Docker only):
  - `envd image holds a static envd binary`: `docker create agentry/envd:envd-v0.6.13`, `getArchive('/envd')` is non-empty, `/LICENSE` exists.
  - `sandbox image has the agent user with passwordless sudo`: running `id -u agent && sudo -n true && node -v && python3 -c "import docx"` exits 0, and the output contains `1000` and `v24.`.
- [ ] **Step 6:** run `pnpm images:build && pnpm vitest run tests/images.spec.ts`. Expect PASS. Commit `feat: envd and sandbox images, vendored envd spec`.

### Task 3: Generated `envd` client

**Files:**
- Create: `buf.gen.yaml`, `src/envd/gen/**` (generated, committed), `src/envd/client.ts`, `src/envd/token.ts`, `tests/envd-token.spec.ts`, `tests/envd-client.spec.ts`

**Interfaces:**
- Consumes: the Task 2 images.
- Produces:
  - `envdToken(secret: string, sandboxId: string): string` (lowercase hex HMAC-SHA256);
  - `createEnvdClient(opts: { baseUrl: string; accessToken: string; fetch?: typeof fetch }): EnvdClient`;
  - `EnvdClient = { health(signal?): Promise<boolean>; init(body: { accessToken: string; defaultUser: string; defaultWorkdir: string; envVars?: Record<string,string> }): Promise<void>; process: Client<typeof Process>; filesystem: Client<typeof Filesystem>; readFile(path: string, user?: string): Promise<Uint8Array>; writeFile(path: string, bytes: Uint8Array, user?: string): Promise<void> }`;
  - the transport is `createConnectTransport({ httpVersion: '1.1', baseUrl })` with an interceptor setting `X-Access-Token`;
  - `readFile`/`writeFile` use `GET`/`POST /files?path=…&username=…`.

- [ ] **Step 1:** `buf.gen.yaml` with `@bufbuild/protoc-gen-es` (target `ts`, `import_extension=js`) over `third_party/envd/spec`. Script `pnpm gen`. Run it and commit the output.
- [ ] **Step 2: failing tests**
  - `tests/envd-token.spec.ts`: the same id and secret give the same 64-hex token; different ids give different tokens; the token never equals the id or the secret.
  - `tests/envd-client.spec.ts` (Docker only; helper `startBareEnvd()`):
    - setup: create a `debian:bookworm-slim` container, `putArchive` `envd` to `/opt/agentry/envd`, publish 49983 to `127.0.0.1` on an ephemeral port, start it, `init` with token `t` and user `root`;
    - `runs a process and streams its output`: `process.start({ process: { cmd: '/bin/sh', args: ['-c','echo hi; echo err >&2; exit 3'] } })` yields stdout `hi\n`, stderr `err\n` and exit code 3;
    - `writes and reads a file`: round-trip `/tmp/a.txt` = `hello`;
    - `refuses a call without the access token`: a client with token `wrong` gets an error (401 or Connect `unauthenticated`) on `filesystem.stat`.
- [ ] **Step 3:** run and see them FAIL.
- [ ] **Step 4:** implement.
- [ ] **Step 5:** run and see them PASS.
  - **If the token test fails because `envd` does not enforce tokens under `--isnotfc`:** stop and record a ledger ruling. The design then switches to one loopback port per sandbox, reachable only from the service, plus `envd`'s port never shared on the owner bridge (block 49983 between containers with the egress rules). Re-run the test as "a sibling container cannot reach 49983".
- [ ] **Step 6:** commit `feat: generated envd client with access token`.

### Task 4: Store and migrations

**Files:**
- Create: `migrations/0001_init.sql`, `src/store/{types.ts,postgres.ts,memory.ts,migrate.ts}`, `tests/store-contract.ts`, `tests/store-memory.spec.ts`, `tests/store-postgres.spec.ts`

**Interfaces:**
- Produces:
  - `SandboxState = 'provisioning' | 'running' | 'stopped' | 'failed' | 'deleting'`;
  - `TemplateSpec = { image?: string; packages?: string[]; setupCommands?: string[]; env?: Record<string,string>; network?: boolean; files?: { path: string; content: string }[]; resources?: Partial<{ cpus: number; memoryMb: number }> }`;
  - `SandboxRecord = { id; owner; name; backend: string; template: TemplateSpec; templateId: string | null; state: SandboxState; handle: Record<string,string>; error: string | null; createdAt: number; startedAt: number | null; lastUsedAt: number | null }` (times in epoch ms);
  - `TemplateRecord = { id; owner; name; spec: TemplateSpec; createdAt; updatedAt }`;
  - `Store = { sandboxes: { insert(r); get(id, owner); getAny(id); list(owner); update(id, owner, patch); delete(id, owner); listAll() }; templates: { insert; get; list; update; delete } }`;
  - `migrate(pool)`: forward-only, a `schema_migrations` table.
- Tests run against `AGENTRY_SANDBOX_TEST_DATABASE_URL`. Without it, the Postgres suite is skipped.
- Dev database: `createdb agentry_sandbox` on the existing Postgres (`127.0.0.1:55432`, user `agentry`).

- [ ] **Step 1: failing contract tests** `tests/store-contract.ts` (shared by the memory and Postgres suites):
  - `get by another owner returns undefined`;
  - `update patches state, handle and error and returns the row`;
  - `list is owner-scoped and ordered by createdAt`;
  - `listAll returns every owner` (used by reconciliation);
  - `template CRUD round-trips spec JSON exactly`.
- [ ] **Step 2:** run and see them FAIL.
- [ ] **Step 3:** implement both stores and the migration.
- [ ] **Step 4:** run and see them PASS (Postgres with the env var set).
- [ ] **Step 5:** commit `feat: sandbox and template store`.

### Task 5: Docker backend (lifecycle, hardening, `envd` bootstrap)

**Files:**
- Create: `src/backends/types.ts`, `src/backends/docker.ts`, `src/backends/envd-binary.ts`, `tests/docker-backend.spec.ts`

**Interfaces:**
- Consumes: `SandboxConfig`, `createEnvdClient`, `envdToken`, `TemplateSpec`.
- Produces:
  - `Backend = { kind: string; capabilities: { persistent: boolean; network: boolean; resources: boolean; templateFields: (keyof TemplateSpec)[] }; available(): Promise<{ ok: true; version: string } | { ok: false; reason: string }>; create(id: string, owner: string, spec: TemplateSpec): Promise<Record<string,string>>; start(id: string, handle: Record<string,string>): Promise<Record<string,string>>; stop(handle): Promise<void>; destroy(handle, opts: { keepWorkspace: boolean }): Promise<void>; status(handle): Promise<'running' | 'stopped' | 'missing'>; endpoint(handle): Promise<{ baseUrl: string }>; listManaged(): Promise<{ id: string; owner: string; handle: Record<string,string> }[]> }`;
  - `createDockerBackend(config: SandboxConfig, network: NetworkGuard): Backend`;
  - `loadEnvdBinary(docker, image): Promise<Buffer>` (cached).
- Behaviour:
  - `create` pulls the image with empty auth, creates the volume and the container (`Entrypoint` `['/opt/agentry/envd','--isnotfc','--no-cgroups','--port','49983']`, `Cmd` `[]`, `WorkingDir` `/workspace`, labels, hardening, network from `NetworkGuard.networkFor(owner)`, and `PortBindings` `{'49983/tcp': [{ HostIp: '127.0.0.1', HostPort: '' }]}` when `envdReach` is `loopback`), and `putArchive`s `envd`.
  - It then runs `start`, and on first start only provisions through `envd` as root:
    - create the `agent` user and sudoers entry when absent;
    - `chown agent /workspace`;
    - install `packages` with `apt-get` or `apk` (whichever exists);
    - run `setupCommands` as `agent` in `/workspace`;
    - write `files`.
  - After that it calls `init` with `defaultUser: 'agent'`.
  - `handle` = `{ containerId, volume, network, provisioned: 'true' }`.
  - `start` waits for `/health` (polling every 250 ms up to `startTimeoutMs`), calls `init` (with the token from `envdToken(config.secret, id)`), and re-applies the network guard for the new container IP.

- [ ] **Step 1: failing tests** `tests/docker-backend.spec.ts` (Docker only; each test cleans up by label):
  - `creates a hardened sandbox that runs as agent with sudo`: `whoami` → `agent`; `sudo -n true` exits 0; the inspected `HostConfig` has `Privileged: false` and `CapDrop` `['ALL']`; no bind `Mounts`; no published port off `127.0.0.1`.
  - `installs persist across stop and start`: `sudo apt-get install -y jq` (or touching `/usr/local/bin/marker`), stop, start, the marker still exists, and `/workspace/f` is still there.
  - `destroy removes the container and the volume, or keeps the volume when asked`.
  - `runs template packages and setup commands as agent in /workspace on first start only`: a setup command that appends to `/workspace/log` runs exactly once over two starts.
  - `works with an image that lacks the agent user` (`alpine:3`, using `apk`).
  - `fails within startTimeoutMs when envd never becomes healthy`: an image whose `/opt/agentry` is unwritable makes `start` reject with an error containing `envd` (Review Focus 5).
- [ ] **Step 2:** run and see them FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run and see them PASS.
- [ ] **Step 5:** commit `feat: hardened docker backend with envd bootstrap`.

### Task 6: Network guard, then the sandbox service (lifecycle, idle stop, reconciliation)

**Files:**
- Create: `src/backends/network-guard.ts`, `src/backends/fake.ts`, `src/sandboxes.ts`, `tests/network-guard.spec.ts`, `tests/sandboxes.spec.ts`

**Interfaces:**
- `NetworkGuard`:
  - `{ networkFor(owner: string): Promise<string>; applyFor(containerId: string, opts: { network: boolean }): Promise<void> }`, implemented by `createNetworkGuard(docker, config)`;
  - creates the owner bridge with `enable_icc=false`;
  - when `config.egress`, runs a short-lived `--privileged --net=host` helper (`alpine:3` with `iptables`) that idempotently ensures `DOCKER-USER` rules: drop new traffic from the bridge subnet to the blocked ranges and the bridge gateway, and when `network: false`, drop all new egress from that container IP. Rules are checked with `-C` before `-I`, and re-applied on every start.
- `createFakeBackend(): Backend & { calls: string[]; failNextStart(reason: string): void }`: in memory, for tests here and for Agentry in plan 2 (exported from the package).
- `SandboxService`, built by `createSandboxService({ store, backend, config, now? })`:
  - `create(owner, { name, templateId?, template? })`, `list(owner)`, `get(owner, id)`, `start(owner, id)`, `stop(owner, id)`, `reset(owner, id, { keepWorkspace })`, `destroy(owner, id)`, `touch(owner, id)`, `endpoint(owner, id): Promise<{ baseUrl; token }>` (starts a stopped sandbox), `sweepIdle(): Promise<string[]>`, `reconcile(): Promise<{ adopted: string[]; missing: string[]; unknown: string[] }>`;
  - throws `NotFoundError` and `BackendUnavailableError`;
  - one in-flight start per sandbox (a per-id promise map).

- [ ] **Step 1: failing tests**
  - `tests/network-guard.spec.ts` (Docker only):
    - `a sandbox reaches the internet`: `curl -sS -o /dev/null -w %{http_code} https://example.com` gives `200`;
    - `a sandbox cannot reach the host`: `curl --max-time 5 http://host.docker.internal:55432` fails, and so does the bridge gateway IP;
    - `a sandbox cannot reach a sibling sandbox`: curl to the sibling's IP on port 49983 fails;
    - `network-off blocks the internet but the service still reaches envd`.
  - `tests/sandboxes.spec.ts` (fake backend):
    - `two concurrent starts start once` (Review Focus 2): `Promise.all([start, endpoint])`, then `calls` holds `start` once;
    - `create snapshots the template and records running`;
    - `sweepIdle stops sandboxes idle past idleStopMinutes and leaves recently touched ones`;
    - `reset keeps or wipes the workspace and re-provisions`;
    - `reconcile adopts labelled containers with records, marks records without containers missing, reports unknown labelled containers`;
    - `another owner gets NotFoundError`;
    - `a failed start records state failed with the reason`.
- [ ] **Step 2:** run and see them FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run and see them PASS.
- [ ] **Step 5:** commit `feat: network guard and sandbox lifecycle service`.

### Task 7: HTTP API, `envd` relay, OpenAPI

**Files:**
- Create: `src/http/{server.ts,router.ts,auth.ts,errors.ts,routes-sandboxes.ts,routes-templates.ts,relay.ts}`, `openapi/agentry-sandbox.yaml`, `tests/http.spec.ts`, `tests/relay.spec.ts`, `tests/openapi-drift.spec.ts`

**Interfaces:**
- Consumes: `SandboxService`, `Store`, `Backend`, `envdToken`.
- Produces: `createServer({ config, service, store, backend }): http.Server`. Routes under `/v1`:
  - `GET /health` (no auth; `{ ok: true }`);
  - `GET /backends` → `[{ kind, available, reason?, version?, capabilities }]`;
  - `POST /sandboxes` `{ name, template_id?, template? }` → 201 with a sandbox;
  - `GET /sandboxes`;
  - `GET /sandboxes/{id}`;
  - `POST /sandboxes/{id}/start`, `/stop`, `/reset` (`{ keep_workspace: boolean }`, default true);
  - `DELETE /sandboxes/{id}` → 204;
  - templates: `POST/GET /templates`, `GET/PUT/DELETE /templates/{id}`;
  - `ANY /sandboxes/{id}/envd/*`: the relay.
- The wire sandbox uses snake_case: `{ id, object: 'sandbox', name, backend, state, template_id, image, error, created_at, started_at, last_used_at }` (epoch seconds).
- Error codes:
  - `unauthorized` 401, `owner_required` 400, `not_found` 404, `invalid_request` 400;
  - `backend_unavailable` 503 (Review Focus 1), `sandbox_failed` 409.
- The relay:
  - streams the request body upstream and the response back (no buffering), so Connect server-streaming works;
  - removes the client's `authorization` and `x-agentry-owner`, and sets `X-Access-Token`;
  - forwards `content-type`, `connect-protocol-version`, `connect-timeout-ms` and `accept-encoding`;
  - calls `touch` on every request;
  - aborts upstream when the client closes (Review Focus 3).

- [ ] **Step 1: failing tests** (fake backend, plus a tiny fake upstream `http.Server` standing in for `envd`):
  - `tests/http.spec.ts`:
    - `rejects a missing or wrong key with 401`;
    - `requires X-Agentry-Owner`;
    - `another owner's sandbox, template and relay path are 404` (Review Focus 4);
    - `create, list, get, start, stop, reset, delete round-trip`;
    - `backend down answers 503 backend_unavailable` (Review Focus 1).
  - `tests/relay.spec.ts`:
    - `injects the sandbox token and strips caller credentials`: the fake upstream sees `x-access-token` = `envdToken(secret, id)` and no `authorization`;
    - `streams chunks as they arrive`: upstream writes 3 chunks 100 ms apart, and the client receives the first before the last is written;
    - `aborts upstream when the client disconnects`: the upstream request's `close` fires within 1 s;
    - `starts a stopped sandbox before relaying`.
  - `tests/openapi-drift.spec.ts`: every route in the router has a path and method in `openapi/agentry-sandbox.yaml`, and vice versa.
- [ ] **Step 2:** run and see them FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** run and see them PASS.
- [ ] **Step 5:** commit `feat: sandbox HTTP API and envd relay`.

### Task 8: Main process, smoke test, docs

**Files:**
- Create: `src/main.ts`, `scripts/smoke.ts`, `scripts/hash-key.ts`
- Modify: `README.md`, `AGENTS.md`, `CHANGELOG.md`

**Interfaces:**
- `src/main.ts`:
  - load the config, open the pool, migrate, build the network guard, Docker backend and service;
  - run `reconcile()` (and log the result);
  - start the server;
  - run `sweepIdle()` every 60 s;
  - on SIGTERM, stop accepting connections and close the pool (sandboxes keep running).
- `scripts/hash-key.ts <key>` prints `sha256:<hex>`.
- `scripts/smoke.ts`, against a running service:
  - creates a sandbox from the default image;
  - through the relay with `createEnvdClient({ baseUrl: <service>/v1/sandboxes/<id>/envd, accessToken: '' })` (the service injects the real token; the client's empty token is stripped), runs `uname -a; whoami; sudo -n true && echo sudo-ok` and prints the output;
  - writes `/workspace/hello.txt` and reads it back;
  - stops and starts it, and checks the file is still there;
  - deletes it;
  - exits non-zero on any mismatch.

- [ ] **Step 1:**
  - implement `main.ts` and the two scripts;
  - README covers setup (`createdb agentry_sandbox`, `pnpm images:build`, env vars, the herdr command) and the security notes (loopback-only `envd`, egress rules, hardening, gVisor switch);
  - CHANGELOG gets the first entry.
- [ ] **Step 2:**
  - start the service in herdr (`agentry-sandbox` terminal) and run `pnpm tsx scripts/smoke.ts`;
  - expected output includes `agent`, `sudo-ok` and `hello` both times;
  - expected exit 0.
- [ ] **Step 3:** run `pnpm typecheck && pnpm test` (the Docker suites run here). Everything passes.
- [ ] **Step 4:** commit `feat: service entrypoint, smoke test, docs`.
- [ ] **Step 5:** run the whole-branch review (one fresh reviewer, most capable model), then the fix pass and merge to `main`.
