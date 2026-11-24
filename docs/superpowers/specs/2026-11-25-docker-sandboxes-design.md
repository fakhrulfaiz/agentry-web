# Docker sandboxes, ready for the cloud — design

Date: 2026-11-25. Repos: `dsh-agents-api` (backend plugin) and `agentry-web`. DeepSeek Harness (DSH) is never modified.

## Intent

Agents should be able to work in a real sandbox with full freedom (install anything, run as root when needed, use the network, run long processes) without risk to the host, and Agentry should be ready to move sandboxes to the cloud later by adding a provider, not by rewriting. Docker is the first real provider; it runs on the developer machine now (Docker 29, WSL) and on any Docker host later. The Sandboxes pages get a refined UI at the same time.

## Words

- **Provider**: what makes sandboxes (`local` today; `docker` now; a cloud service later).
- **Template**: the recipe (image, files, packages, setup commands, network).
- **Environment**: one sandbox made from a template; where a chat's agent works (its files and where its commands run).
- **Runtime**: what is installed inside an environment (Node, Python, packages). On `local` it is the server's bundle; on Docker it comes from the image and whatever the agent installs.

## Goals

1. A `docker` provider: one container per environment, made from the template's image (or Agentry's default sandbox image), with the template's packages and setup commands applied.
2. Every DSH tool that runs processes (bash, terminals, background jobs, `run_code`, subagents) runs inside the environment's container when a chat uses a Docker environment. File tools keep working on the same workspace.
3. Environments persist: the container is stopped when idle and started again on the next chat, with everything the agent installed still there. "Reset to template" rebuilds the container and keeps the workspace files.
4. Full freedom inside the container: no DSH per-command confinement there; the container is the wall. Network on unless the template turns it off.
5. Cloud-ready seam: a provider declares how a chat's processes (and, for remote providers, files) reach it. Adding E2B, Daytona or own cloud VMs later is one new provider.
6. Refined Sandboxes UI: Environments, Templates and Providers tabs, environment status and actions, a template editor with image, packages, setup commands and network.

## Non-goals

- No cloud provider is built now (only the seam and its contract).
- No change to the DSH repository.
- No per-user harness containers (the AGENTS.md hosting plan stays separate and compatible).
- No GPU, resource quotas or image registry management beyond pulling public images.

## Anti-goals (a failure even if it works)

- An agent on a Docker environment touching host files outside its workspace.
- Files the agent creates in the container becoming uneditable by Agentry or the user on the host (seen in the spike: root-owned files).
- Chats on `local` environments changing behaviour.
- A provider that silently falls back to running on the host when Docker is unavailable.

## What the spike proved (throwaway, removed)

An isolated Cordis group inside the `agentry` preset (`isolate: { subprocess: true, shell: true }`) holding a 40-line `subprocess` service that wraps the host's own service with `docker exec -i -w <cwd> <container> …`, plus the stock `@deepseek-ai/dsh-bash-local` and `@deepseek-ai/dsh-tool-bash`, made a real chat's `bash` run in a Debian container (`PRETTY_NAME="Debian GNU/Linux 12"`, user `root`, cwd = the chat workspace) while the host is Ubuntu 24.04. The workspace was bind-mounted at the same path, so the file was visible on the host — owned by root. DSH's preset mount explicitly supports services in isolate realms (`agent-preset-registry/src/mount.ts`).

## Approaches considered

- **A. Swap DSH's process (and, for remote providers, file) services per chat through an isolated group in a dedicated preset — chosen.** All DSH tools keep working unchanged; plugin-only. Proven by the spike.
- B. Agentry's own sandbox tools replacing DSH's bash and file tools on Docker environments. Certain to work, but duplicates tools and loses DSH features (diff cards, terminals, `run_code`, sandbox escalation prompts); drifts with every DSH upgrade. Fallback only.
- C. One harness container per user. Isolates per user, not per environment; it is the hosting plan, compatible with A.

## Design

### Execution routing (backend)

- A second preset row, `preset-agentry-docker` (`id: agentry-docker`), with the same plugins as `preset-agentry`, except that every process-spawning service and its consumers sit in one isolated group: `isolate: { subprocess: true, shell: true, terminals: true }` (the builder confirms the full list: anything a preset tool reaches that spawns processes, e.g. `run_code`'s runtime and background jobs).
- Inside the group: Agentry's `docker-subprocess` service (shipped in the `@agentry/api` package as its own export, not a file path), `@deepseek-ai/dsh-bash-local` (unconfined; the container is the wall) and the consumers (`tool-bash`, terminal tools).
- `docker-subprocess` wraps the host's subprocess service (root realm). It picks the container by the spawn's `cwd`: Agentry keeps a registry of Docker environment workspace roots → container names; a cwd outside every registered root is refused (never run on the host).
- File tools stay on the host: the environment workspace is bind-mounted into the container at the same absolute path, so DSH file tools, the web file viewer, artifacts and deliverables work as today.
- A session whose environment's provider is `docker` mounts the `agentry-docker` preset (`mountDefaultPreset(agentCtx, 'agentry-docker')`, `acquireScope('agentry-docker')`); all others keep `agentry`. Subagents inherit the parent's cwd, so they route the same way.

### File ownership

Commands run as the host user's uid:gid (`docker exec -u <uid>:<gid>`), and the default image gives that user passwordless `sudo`, so the agent can still become root (`sudo apt install …`) while files it creates in the workspace stay owned by the host user. Root-owned files can still appear when the agent uses `sudo`; Reset and a host-side ownership repair (`chown` through the container on stop) handle them.

### Docker provider

- Talks to Docker through the `docker` CLI (works with Docker Desktop on WSL, a local daemon, or `DOCKER_HOST` for a remote one). Pulls use a credential-free Docker config so the Windows credential helper cannot break public pulls (seen on this machine).
- Container per environment, named `agentry-env-<environmentId>`, labelled with owner and environment id.
- Create: pull the image, create the container (bind mount, user, network per template, `sleep infinity` as PID 1 via `--init`), run template `packages` and `setup_commands`, write template files into the workspace. Status `provisioning` → `ready`, or `failed` with the error.
- Start on chat attach; stop after an idle time (configurable, default 30 min); start again on the next chat. Destroy removes the container; the workspace folder follows the existing delete rules.
- Reset to template: remove and recreate the container from the template; keep workspace files.
- Registered only when Docker answers; `GET /agents/environments/providers` lists it with `available` and, when not, the reason.
- Default image: an Agentry sandbox image built from a Dockerfile in the backend repo (Debian slim + Node + Python + pnpm + git + curl + sudo), tag configurable; templates override with any public image.

### Cloud-ready seam

`SandboxProvider` gains:
- `executionPreset`: which preset a chat on this provider mounts (`agentry` for local, `agentry-docker` for Docker; a cloud provider names its own, isolating `fs` too).
- Lifecycle: `start(record)`, `stop(record)`, `reset(record)`.
- Capabilities: `persistent`, `network`, `root`, `files`, `exec`, template fields (adds `image`, `packages`, `setup_commands`, `network` for Docker).

A cloud provider later implements the same contract with remote exec and remote files; nothing else changes.

### API

- `POST /agents/environments` accepts `provider` (default: the configured default) and `name`.
- Environment records gain `provider`, `name`, `status` (`provisioning`, `running`, `stopped`, `failed`), `image`, and `last_used_at`.
- New actions: `POST /agents/environments/{id}/start`, `/stop`, `/reset`.
- OpenAPI updated; local environments report `running` always.

### Web — Sandboxes UI

- Tabs: **Environments**, **Templates**, **Providers**.
- Environment cards: name, provider badge, status dot (running, stopped, provisioning, failed), template, image, last used. Detail: files, plus Start, Stop, Reset to template and Delete, with confirmations for Reset and Delete.
- New environment dialog: name, provider, template.
- Template editor: image, packages, setup commands, network on/off, files; fields a provider does not support are shown disabled with the reason.
- Providers tab: one card per provider with availability and reason, capabilities, and runtimes (the server bundle for `local`, the default image's for Docker).
- Choosing an environment for a chat: the new-chat composer's existing Environment menu lists environments with their provider and status; picking a stopped Docker environment starts it when the message is sent (the chat shows "Starting sandbox…" until it is running). The environment detail page gets "New chat here".

## Constraints

- Plugin-only: no DSH repository changes; DSH services used through their public contracts and preset isolation.
- Owner scoping on every environment record and container label.
- Never run a Docker environment's process on the host: refuse instead.
- astryx UI, StyleX layout only; CHANGELOG in both repos; OpenAPI drift tests.
- Testing: unit and component tests per change; one e2e run before merge; the provider has integration tests that run only when Docker is available.

## Left to the builder

- The exact list of services to isolate (verify every process-spawning path in the preset, including `run_code` and background jobs).
- Idle-stop timer mechanics and where `last_used_at` is updated.
- Default image contents beyond the list above, and its tag scheme.
- How Reset repairs file ownership.
- Copy for the UI.
