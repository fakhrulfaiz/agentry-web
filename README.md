# Agentry Web

A chat web app for Agentry agents (backend: the Agentry API, `@agentry/api`), built with Next.js (App Router), the astryx design system, and StyleX. Its server is a backend-for-frontend: every Agentry credential (Keycloak tokens or an API key) stays in an encrypted, `httpOnly` session cookie and never reaches the browser.

## Requirements

- Node.js 24 and pnpm 11
- A running Agentry API (or the mock API used by the end-to-end tests)

## Configuration

Copy `.env.example` to `.env.local` and fill it in. The server validates these variables when it starts; a missing or invalid one stops startup with a `ConfigError` naming the variable.

| Variable | Required | Description |
|---|---|---|
| `AGENTRY_WEB_AUTH` | yes | Sign-in mode: `keycloak` or `apikey`. |
| `AGENTRY_API_URL` | yes | Agentry API base URL (absolute `http(s)` URL). Server-only. |
| `AGENTRY_WEB_SESSION_SECRET` | yes | Encrypts the `agentry_session` cookie. At least 32 bytes (`openssl rand -base64 32`). |
| `AGENTRY_WEB_MODELS` | no | Comma-separated model ids offered in the model picker; the first is the default. |
| `AGENTRY_WEB_KEYCLOAK_ISSUER` | keycloak mode | Keycloak realm issuer URL. |
| `AGENTRY_WEB_KEYCLOAK_CLIENT_ID` | keycloak mode | Confidential client id (e.g. `agentry-web`). |
| `AGENTRY_WEB_KEYCLOAK_CLIENT_SECRET` | keycloak mode | Client secret. |

Behind a reverse proxy, forward `X-Forwarded-Proto` and `X-Forwarded-Host` (the app uses them for same-origin checks and Keycloak redirect URIs), or set Auth.js's `AUTH_URL` to the public URL.

In production the session cookie is `Secure` when the request came over HTTPS (the `X-Forwarded-Proto` a proxy sends, or the connection itself), so the app also works over plain `http://` on a LAN address or a container port (browsers drop `Secure` cookies on `http://` except for localhost). Behind a TLS proxy, forward `X-Forwarded-Proto: https`, or set `AGENTRY_WEB_COOKIE_SECURE=always` to make the cookie `Secure` on every request.

## Running it

```bash
pnpm install
scripts/dev.sh          # next dev with hot reload (while changing the code)
scripts/dev.sh image    # build the Docker image, export it to dist/agentry-web-<tag>.tar
scripts/start.sh        # deploy: load the newest dist/*.tar and run it as container agentry-web
```

**Running from the published images (no repository).** `deploy/compose.yaml` runs Agentry from GHCR; each Agentry Web release attaches it (web tag pinned) with `agentry.env.example`.

```bash
cp agentry.env.example .env      # fill it in
docker login ghcr.io             # only for private packages
docker compose up -d             # http://localhost:3000
```

Two modes, chosen by `COMPOSE_PROFILES` in `.env`:

| `COMPOSE_PROFILES` | Runs | You set |
|---|---|---|
| `full` | Agentry Web, the Agentry API (`ghcr.io/fakhrulfaiz/agentry-api`) and Postgres 16; the web app uses the API at `http://api:3080` | `AGENTRY_WEB_SESSION_SECRET`, `POSTGRES_PASSWORD`, `AGENTRY_DEV_KEY` (users sign in with it), `DEEPSEEK_API_KEY` |
| empty | Agentry Web only | `AGENTRY_WEB_SESSION_SECRET` and `AGENTRY_API_URL` (your API; from the container, a service on this machine is `http://host.docker.internal:<port>`) |

- Agentry Sandbox (optional, Linux Docker host): add `sandbox` to `COMPOSE_PROFILES` (`full,sandbox`) to also run `ghcr.io/fakhrulfaiz/agentry-sandbox-service` with its own Postgres database (`sandbox-postgres`). Set `AGENTRY_SANDBOX_KEY` (any long random string), `AGENTRY_SANDBOX_SECRET` (`openssl rand -base64 48`, keep it stable) and `AGENTRY_SANDBOX_URL=http://host.docker.internal:3090`; full mode passes the URL and key to the API. The service container mounts `/var/run/docker.sock` (it creates the sandbox containers; the sandboxes never get the socket) and uses the host network. Or run the service yourself and set only `AGENTRY_SANDBOX_URL` / `AGENTRY_SANDBOX_KEY`.
- Each service gets only its own settings (no shared env file inside the containers). Docker reads `.env` values literally: no quotes.
- The API is not published on the host in full mode (the web app reaches it on the compose network); `compose.yaml` shows the override that publishes it on `127.0.0.1:3080`.
- Keep the session secret (changing it signs everyone out) and the volumes (`web-data`: old connector keys until they move to the API; `api-data`: DSH home, workspaces, uploads; `postgres-data`).
- Update: set `AGENTRY_WEB_TAG` / `AGENTRY_API_TAG` (or use a newer release's file), then `docker compose pull && docker compose up -d`.

**Branches and CI.** Work lands on `develop`; `main` changes only through a `develop` → `main` pull request. GitHub Actions (`.github/workflows/`):

| When | What runs |
|---|---|
| Push to `develop` | `ci.yml`: `next typegen`, typecheck, Vitest |
| Pull request to `main` | `ci.yml`: the same, then Playwright e2e (mock API) and a Docker build check |
| Merge to `main` | `publish.yml`: builds the image and pushes `ghcr.io/<owner>/agentry-web:<version>-<sha>`, `:<version>` and `:latest` |

**Releasing a version.** The version is `"version"` in `package.json`; a `develop` → `main` merge is a release.

```bash
git checkout develop
npm version 0.2.0 --no-git-tag-version   # or minor / major / patch
# add a "## 0.2.0 — <date>" section at the top of CHANGELOG.md (the release notes)
git commit -am "release: 0.2.0" && git push
# then the develop → main pull request; merge it
```

The pull request fails ("Version not yet released") when `package.json` names a version that already has a `v<version>` tag. After the merge, `publish.yml` pushes the image (`<version>-<sha>`, `<version>`, `latest`), tags the commit `v<version>` and creates the GitHub Release from that CHANGELOG section (or from the commits when there is none). A version that is already released is never published again; that run only warns. Deploy a pinned version with `AGENTRY_WEB_GHCR_IMAGE=ghcr.io/fakhrulfaiz/agentry-web:0.2.0 scripts/start.sh --ghcr`.

`scripts/start.sh` uses a local `dist/*.tar` first, then pulls `ghcr.io/<owner>/agentry-web:latest` (`--ghcr` pulls even when a tar is here; `AGENTRY_WEB_GHCR_IMAGE` picks another tag). The package is private like the repo: the machine needs `docker login ghcr.io` with a token that has `read:packages`.

**Deploying from the image.** `scripts/dev.sh image` builds the `Dockerfile` (Next's standalone server on `node:24.19.0-bookworm-slim`, no configuration baked in) and saves it as `dist/agentry-web-<version>-<commit>[-dirty].tar`. `scripts/start.sh` takes the newest tar there (or `AGENTRY_WEB_IMAGE_TAR`), loads it unless that tag is already loaded, and replaces the container `agentry-web` (`--restart unless-stopped`, port `PORT`, default 3000). On another machine, copy the tar into `dist/` next to the scripts and the env file; Docker is all it needs (no Node or pnpm).

- The container's environment comes from `.env` then `.env.local` (quotes stripped; `PORT`, `NODE_ENV` and the dist/data dir keys left out). An `AGENTRY_API_URL` on `localhost`/`127.0.0.1` is rewritten to `host.docker.internal` (mapped to the Docker host), so the container reaches an API running on the host. A Keycloak issuer on `localhost` is not rewritten: the browser uses it too.
- Connector keys live in the Agentry API, sealed with its `AGENTRY_SECRETS_KEY` (without it the Connectors page says the server cannot store keys). Keys saved by older versions in `.data/` (mounted at `/data`; `AGENTRY_WEB_HOST_DATA_DIR` to move it) move to the API the first time their user opens Connectors.
- No tar: a terminal run offers to build it now or to run without Docker; `NONINTERACTIVE=1` fails. `scripts/start.sh --no-docker` runs `next build` (when the source changed; `--rebuild` forces it) + `next start` instead.
- Logs: `docker logs -f agentry-web`. Stop: `docker rm -f agentry-web`.
- Docker Desktop's credential helper fails from WSL ("A specified logon session does not exist"); the image build needs no login, so the launcher builds with a copy of the Docker config without `credsStore`.

Both launchers first check that the Agentry API answers `GET $AGENTRY_API_URL/health` (read from `.env.local`). When it does not, they offer to start it (its own `~/code/dsh-agents-api/scripts/dev.sh`, in the herdr terminal `agentry-api`), wait for it, continue without it, or quit; with `NONINTERACTIVE=1` they wait up to `AGENTRY_API_WAIT_SECONDS` (120) and then fail. A port already in use (other than by the container being replaced) stops them.

- Use the image (or `--no-docker`) for real use: Next prefetches pages and keeps them in the client cache only in a production build, so `next dev` is several times slower per click and compiles each page on its first visit.
- Menus use [gum](https://github.com/charmbracelet/gum) `0.17.0` when it is on the `PATH` or in `.tools/bin` (the first terminal run offers to download it there); without it they fall back to numbered prompts. Shared code: `scripts/lib/launch.sh`.
- Overrides: `AGENTRY_API_REPO` (default `~/code/dsh-agents-api`), `AGENTRY_API_HERDR_NAME` (default `agentry-api`), `AGENTRY_WEB_IMAGE_NAME`, `AGENTRY_WEB_CONTAINER`, `AGENTRY_WEB_DIST`.

Other scripts:

| Script | What it does |
|---|---|
| `pnpm build` / `pnpm start` | Production build and server (`build` needs no env vars; `start` does). |
| `pnpm typecheck` | TypeScript check. |
| `pnpm test` | Unit and component tests (Vitest). |
| `pnpm test:e2e` | End-to-end tests (Playwright; run `pnpm exec playwright install chromium` once). |

## Keycloak live check

The Keycloak sign-in path is covered by unit tests against a mocked token endpoint; check it once against a real realm before release:

1. In the realm, create a confidential client (e.g. `agentry-web`) with valid redirect URI `<app origin>/api/auth/callback/keycloak` and valid post-logout redirect URI `<app origin>/login`.
2. Start the app with `AGENTRY_WEB_AUTH=keycloak` and the three `AGENTRY_WEB_KEYCLOAK_*` variables (behind your proxy if you deploy behind one).
3. Sign in from `/login`: you land on `/` signed in, and the user menu shows your owner id (`sub`) and realm roles.
4. In the browser dev tools, check that no cookie, storage entry, response or JS-readable value contains an access, refresh or ID token (only the encrypted `agentry_session*` cookies and Auth.js's own cookies exist).
5. Lower the realm's access token lifespan (e.g. 2 minutes), wait past it, then reload a chat: it keeps working (the BFF refreshed the token), with "Revoke Refresh Token" both off and on.
6. Stop Keycloak briefly and use the app: requests answer 503 and you stay signed in; start it again and the app recovers.
7. Sign out from the user menu: Keycloak asks to confirm, then returns you to `/login`; going back to `/` asks you to sign in again.

Contributor and agent conventions live in [AGENTS.md](AGENTS.md); the change history is in [CHANGELOG.md](CHANGELOG.md).
