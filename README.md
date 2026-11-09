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

## Development

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Other scripts:

| Script | What it does |
|---|---|
| `pnpm build` / `pnpm start` | Production build and server (`build` needs no env vars; `start` does). |
| `pnpm typecheck` | TypeScript check. |
| `pnpm test` | Unit and component tests (Vitest). |
| `pnpm test:e2e` | End-to-end tests (Playwright; run `pnpm exec playwright install chromium` once). |

Contributor and agent conventions live in [AGENTS.md](AGENTS.md); the change history is in [CHANGELOG.md](CHANGELOG.md).
