# Sandboxes: a guide

How to run Agentry's agents inside isolated containers: what the pieces are, how to start them, how to use them from the web app and the API, and what to do when something goes wrong.

## The ideas in one minute

- **Environment**: the workspace a chat runs in. The agent's commands run there and its files live there. A chat without an environment uses a plain folder on the server.
- **Where it runs** (a *provider* in the API):
  - **This server** (`local`): a folder on the Agentry server. It starts instantly and uses the software the server already has (Node, Python, the Office tools). There is no isolation, so the agent can reach anything the server can.
  - **Isolated sandbox** (`sandbox`): a Linux container run by the **Agentry Sandbox** service. It has its own software and files. The agent is `agent` with passwordless `sudo` inside it. It can reach the internet, but never the host or your network.
- **Template**: a saved setup that new environments start from: image, packages, setup commands, environment variables, internet on/off, CPU and memory, and starter files.

Three programs work together:

| Program | Repo | Port | Job |
|---|---|---|---|
| Agentry Web | `~/code/agentry-web` | 3000 | The UI (Sandboxes page, chats) |
| Agentry API | `~/code/dsh-agents-api` | 3080 | Chats, agents, environments; runs each sandbox chat's tools inside its sandbox |
| Agentry Sandbox | `~/code/agentry-sandbox` | 3090 | Creates and runs the containers (Docker), enforces the limits and the network block |

The browser only talks to Agentry Web. Only the API holds the sandbox service's key.

## Set it up (once)

Prerequisites:
- Docker running.
- Node 24 and pnpm 11 (`export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH`).
- The Postgres container the API already uses (`agentry-postgres`, port 55432).

1. **Build the images.** This makes the default sandbox image `agentry/sandbox:1` (Debian, Node 24, Python 3.11, pandas, python-docx and more), the `envd` agent, the DeepSeek Harness helper and the firewall helper:

   ```sh
   cd ~/code/agentry-sandbox && pnpm install && pnpm images:build
   ```

   On Docker Desktop for WSL, the script uses an empty Docker config so the Windows credential helper cannot break pulls.

2. **Create its database:**

   ```sh
   docker exec agentry-postgres createdb -U agentry agentry_sandbox
   ```

3. **Make a key and a secret, and keep both.** The secret derives every sandbox's access token, so changing it locks you out of existing sandboxes.

   ```sh
   mkdir -p ~/.config/agentry
   openssl rand -hex 24 > ~/.config/agentry/sandbox-key
   openssl rand -hex 32 > ~/.config/agentry/sandbox-secret
   ```

4. **Save a launcher**, for example `~/.config/agentry/sandbox.sh`:

   ```sh
   #!/usr/bin/env bash
   set -eo pipefail
   export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
   C=$HOME/.config/agentry
   PGPASS=$(docker inspect agentry-postgres --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_PASSWORD=//p')
   ENC=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$PGPASS")
   export AGENTRY_SANDBOX_DATABASE_URL="postgres://agentry:${ENC}@127.0.0.1:55432/agentry_sandbox"
   export AGENTRY_SANDBOX_API_KEYS="sha256:$(printf %s "$(cat $C/sandbox-key)" | sha256sum | cut -d' ' -f1)"
   export AGENTRY_SANDBOX_SECRET=$(cat $C/sandbox-secret)
   cd ~/code/agentry-sandbox && exec pnpm dev
   ```

5. **Point the API at it.** Add these to the API's environment (its `.env` or its launcher):

   ```sh
   AGENTRY_SANDBOX_URL=http://127.0.0.1:3090
   AGENTRY_SANDBOX_KEY=$(cat ~/.config/agentry/sandbox-key)
   ```

   If only one of the two is set, the API refuses to start and names the missing one. With neither set, "Isolated sandbox" doesn't appear and everything runs on this server.

## Start it (every time)

Start the sandbox service before the API, in herdr:

```sh
hc run --bg --no-parent --outlive-parent --name agentry-sandbox bash ~/.config/agentry/sandbox.sh
hc run --bg --no-parent --outlive-parent --name agentry-api --cwd ~/code/dsh-agents-api <your API launcher>
hc run --bg --no-parent --outlive-parent --name agentry-web --cwd ~/code/agentry-web pnpm dev
```

Check it:
- `hc read agentry-sandbox` shows the service listening on 3090.
- In the web app, **Sandboxes → Providers** shows "Isolated sandbox" as **Available**, with its Docker version and the standard image's software.

After pulling new API code, restart the API; it rebuilds when it starts. After changing the sandbox images, run `pnpm images:build` again.

## Tutorial: your first sandbox chat

1. Open **Sandboxes** in the sidebar.
2. **Optional: make a template.** Open **Templates → New template**. The editor opens on "Isolated sandbox".
   - Name it, for example "Python data work".
   - **Software**: add Python packages `polars, matplotlib`. Leave the image empty to use the standard image.
   - **Startup**: add starter files (copied into the workspace), and setup commands that run once, in order, as `agent`. Setup stops at the first command that fails.
   - **Variables**: add one `NAME=value` per line, for example `TZ=Asia/Kuala_Lumpur`.
   - **Internet and limits**: turn internet off if the work must not reach the outside, and set CPU cores or memory if the defaults (2 CPUs, 4 GB) don't suit.
   - The checklist on the left shows what the template will set up. Click **Save template**.
3. **Create the environment.** Open **Environments → New environment**, name it (say "Data box"), choose **Isolated sandbox**, pick your template or "Start from nothing", and click **Create environment**. The first one takes longer while the image and packages install. The card shows **Setting up**, then **Running**.
4. **Chat in it.** Open the environment and click **New chat here**. Alternatively, start a new chat and pick it from the composer's environment menu, which reads like "Data box (Isolated sandbox, running)".
5. **Ask for something that runs code**, for example: "Make a chart of 100 random points with matplotlib and save it as chart.png." Every command, file edit and terminal runs inside the container. The file appears in the chat's artifacts and in the environment's **Files** list, where you can open or download it.
6. **Come back later.** An idle sandbox stops itself after 30 minutes, keeping its files and installed software. Sending a message in a chat on it, or clicking **Start**, wakes it up.

## Managing environments

The environment page (**Sandboxes → click a card**) shows its state, image, last use and files, plus these actions:

| Action | What it does |
|---|---|
| **New chat here** | Opens a new chat already set to this environment |
| **Stop** | Stops the container. Files and installed software are kept, and nothing counts against "running at once" |
| **Start** | Starts a stopped sandbox |
| **Reset** | Rebuilds from the template. **Keep workspace files** (on by default) keeps the workspace; everything outside it, including software installed by hand, is lost. Turning it off wipes the files too |
| **Delete environment** | Removes the sandbox and all its files. Chats that used it keep their history |
| **Add a file** | Uploads up to 5 MB into the workspace |
| **Show N hidden files** | Shows dot-folders (`.git`, tool caches), which are hidden by default |

States you may see:

| State | Meaning |
|---|---|
| Running | Ready; chats run now |
| Stopped | Asleep (manually or after 30 idle minutes); wakes on the next message or **Start** |
| Setting up | Installing the template's software; the list refreshes itself |
| Failed | Setup or start failed; the card shows why (for example the setup command that failed) |
| Unreachable | The API can't reach Agentry Sandbox right now; the last known state is kept |
| Gone | The sandbox was removed outside Agentry; delete the environment and make a new one |

Environments on **This server** have no Start, Stop or Reset. They are just a folder.

## Limits (so an agent can't run away with resources)

Agentry Sandbox enforces these. Going over one refuses the request with the reason, for example "sandbox limit reached: … (limit 5)", and the web app shows that message in the dialog. Set them in the sandbox service's environment and restart it:

| Setting | Default | Limits |
|---|---|---|
| `AGENTRY_SANDBOX_MAX_PER_OWNER` | 5 | Sandboxes one user may have, running or stopped |
| `AGENTRY_SANDBOX_MAX_RUNNING_PER_OWNER` | 2 | Running at once per user |
| `AGENTRY_SANDBOX_MAX_TOTAL` | 50 | Sandboxes on the whole service |
| `AGENTRY_SANDBOX_MAX_RUNNING_TOTAL` | 10 | Running at once across everyone |
| `AGENTRY_SANDBOX_MAX_CREATES_PER_HOUR` | 20 | Creates plus resets per user per hour |
| `AGENTRY_SANDBOX_MAX_CPUS` / `_MAX_MEMORY_MB` | 4 / 8192 | The most a template may ask for |
| `AGENTRY_SANDBOX_CPUS` / `_MEMORY_MB` / `_PIDS` | 2 / 4096 / 4096 | What a sandbox gets when its template says nothing |
| `AGENTRY_SANDBOX_IDLE_MINUTES` | 30 | Idle time before a sandbox stops (it is not deleted) |
| `AGENTRY_SANDBOX_OWNER_LIMITS` | none | Per-user overrides as JSON, for example `{"alice":{"maxPerOwner":10,"maxRunningPerOwner":4}}` |

Other settings:
- `AGENTRY_SANDBOX_DEFAULT_IMAGE`: the standard image.
- `AGENTRY_SANDBOX_RUNTIME=runsc`: use gVisor for a stronger wall.
- `AGENTRY_SANDBOX_EGRESS=off`: turns off the network block. Only for debugging.

## What the sandbox can and cannot do

- **Inside:** anything. `sudo apt install`, `pip install`, servers on any port, long-running jobs.
- **Network:** the public internet only. The Docker host, your LAN, private ranges (10/8, 172.16/12, 192.168/16, 100.64/10), link-local and cloud metadata addresses, and multicast are blocked. Sandboxes of the same user can't talk to each other. A template with internet off gets no outbound connections at all.
- **Container wall:** no privileged mode, no host folders, no Docker socket, a minimal set of Linux capabilities (no raw sockets, no network admin), and CPU, memory and process limits.
- **Secrets:** the sandbox never sees the Agentry API key or the sandbox service key. Template variables *are* visible to the agent, so don't put secrets there that you wouldn't hand to it.
- **Skills:** your skills and the built-in ones are copied into the sandbox read-only, at the same paths as on the server, so `/skill-name` works there too.

## Using it from the API

All calls go to the Agentry API with your API key (`Authorization: Bearer <key>`, `OpenAI-Beta: agents=v1`). The web app's BFF does this for you; scripts can call the API directly.

```sh
API=http://127.0.0.1:3080/v1
AGENTRY_KEY=…   # your Agentry API key

# Where can environments run, and is the sandbox up?
curl -s $API/agents/environments/providers -H "Authorization: Bearer $AGENTRY_KEY" -H "OpenAI-Beta: agents=v1"

# A template for the sandbox
curl -s $API/agents/environments/templates -H "Authorization: Bearer $AGENTRY_KEY" -H "OpenAI-Beta: agents=v1" -H "Content-Type: application/json" -d '{
  "name": "Python data work", "provider": "sandbox",
  "packages": { "python": ["polars", "matplotlib"] },
  "setup_commands": [{ "command": "mkdir -p data" }],
  "env": { "TZ": "Asia/Kuala_Lumpur" },
  "network": { "access": "enabled" },
  "resources": { "cpus": 2, "memory_mb": 4096 }
}'

# An environment from it (or with "provider": "sandbox" and no template)
curl -s $API/agents/environments -H "Authorization: Bearer $AGENTRY_KEY" -H "OpenAI-Beta: agents=v1" -H "Content-Type: application/json" \
  -d '{ "name": "Data box", "template_id": "tpl_…" }'

# Lifecycle
curl -s -X POST $API/agents/environments/env_…/stop  -H "Authorization: Bearer $AGENTRY_KEY" -H "OpenAI-Beta: agents=v1"
curl -s -X POST $API/agents/environments/env_…/start -H "Authorization: Bearer $AGENTRY_KEY" -H "OpenAI-Beta: agents=v1"
curl -s -X POST $API/agents/environments/env_…/reset -H "Authorization: Bearer $AGENTRY_KEY" -H "OpenAI-Beta: agents=v1" \
  -H "Content-Type: application/json" -d '{ "keep_workspace": true }'
```

A sandbox environment's JSON carries `name` and `sandbox: { state, image, started_at, last_used_at }`.

To run a chat in it, create the session with the environment:

```json
{ "agent": "…", "environment": { "type": "sandbox", "environment_id": "env_…" } }
```

The full contract is in `~/code/dsh-agents-api/openapi/agentry.yaml`. The sandbox service's own API (which only the Agentry API calls) is in `~/code/agentry-sandbox/openapi/agentry-sandbox.yaml`.

## Troubleshooting

| You see | Do this |
|---|---|
| No "Isolated sandbox" choice | The API has no `AGENTRY_SANDBOX_URL`/`AGENTRY_SANDBOX_KEY`. Set both and restart the API |
| "Isolated sandbox" disabled, "not reachable" | Start the sandbox service (`hc read agentry-sandbox` for its log), then reload |
| "refused the configured key" | The API's `AGENTRY_SANDBOX_KEY` doesn't match the service's `AGENTRY_SANDBOX_API_KEYS` hash. Recompute it from the same key file |
| "Docker is not reachable" | Start Docker Desktop, then reload the Providers tab |
| Create fails with "limit … reached" | Delete or stop sandboxes you don't need, or raise the limit (see Limits) |
| Failed: `setup command "…" failed (exit N)` | Fix the template's command (it runs as `agent` in the workspace; use `sudo` for system changes), then create a new environment or **Reset** |
| Card says **Unreachable** | The service is down or slow; the environment is fine. Restart the service |
| Card says **Gone** | The container was removed outside Agentry (for example `docker rm`). Delete the environment and make a new one |
| A chat on a sandbox answers 409 `environment_failed` | The environment failed. Open it to see why, then Reset or recreate it |
| Pip or apt can't download | The template has internet off, or the site is in a blocked range |
| Images missing after a Docker reset | Run `pnpm images:build` in `~/code/agentry-sandbox` again |

## Where things live

- **Design:** `docs/superpowers/specs/2026-11-25-agentry-sandbox-design.md`.
- **Plans:**
  - `docs/superpowers/plans/2026-11-25-agentry-sandbox-service.md` (the service).
  - `…-integration.md` (the API).
  - Plan 3 (this UI) is recorded in `CHANGELOG.md`.
- **Agentry Sandbox:** `~/code/agentry-sandbox`. Its README covers every setting and the security model, and `scripts/smoke.ts` is an end-to-end check.
- **The API's sandbox provider:**
  - `src/sandbox/agentry-sandbox-provider.ts`.
  - Tools inside the sandbox: `src/sandbox/remote/` and `src/sandbox/presets.ts`.
- **The web UI:**
  - `src/ui/sandboxes/`: `SandboxesPage`, `EnvironmentDetail`, `TemplateEditorDialog`, `RunsOnPicker`.
  - `format.ts` holds the plain-language names.
