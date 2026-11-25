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

The session cookie is `Secure` whenever `NODE_ENV=production`. Chrome, Edge and Firefox accept it on `http://localhost`, so `scripts/start.sh` works locally in those; Safari drops it, and any other host over plain `http://` needs HTTPS in front.

## Running it

```bash
pnpm install
scripts/start.sh  # production build + server, http://localhost:3000 (daily use)
scripts/dev.sh    # next dev with hot reload (while changing the code)
```

Both launchers first check that the Agentry API answers `GET $AGENTRY_API_URL/health` (read from `.env.local`). When it does not, they offer to start it (its own `~/code/dsh-agents-api/scripts/dev.sh`, in the herdr terminal `agentry-api`), wait for it, continue without it, or quit; with `NONINTERACTIVE=1` they wait up to `AGENTRY_API_WAIT_SECONDS` (120) and then fail. They also refuse a port already in use (`PORT`, default 3000).

- `scripts/start.sh` rebuilds only when `app/`, `src/`, the config, the lockfile or the env files changed since the last build (`--rebuild` forces it, `--no-build` skips it). Use it for real use: Next prefetches pages and keeps them in the client cache only in a production build, so `next dev` is several times slower per click and compiles each page on its first visit.
- Menus use [gum](https://github.com/charmbracelet/gum) `0.17.0` when it is on the `PATH` or in `.tools/bin` (the first terminal run offers to download it there); without it they fall back to numbered prompts. Shared code: `scripts/lib/launch.sh`.
- Overrides: `AGENTRY_API_REPO` (default `~/code/dsh-agents-api`), `AGENTRY_API_HERDR_NAME` (default `agentry-api`).

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
