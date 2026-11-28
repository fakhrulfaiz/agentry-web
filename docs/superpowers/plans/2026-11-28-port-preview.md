# Sandbox port preview (2026-11-28)

The agent starts a web app inside a sandbox (`npm run dev`, `python -m http.server 8000`, Flask…). The user sees it live in the chat's side panel.

## Decisions (made 2026-11-28; user asked for these three P1 items and minimal tests)

- **Path:** browser → web BFF `/preview/<token>/<path>` → API `GET|POST|… /v1/agents/environments/{id}/ports/{port}/<path>` (owner-scoped) → sandbox service `/v1/sandboxes/{id}/ports/{port}/<path>` → the port inside the sandbox. Docker places first (the service reaches the container the same way it reaches envd, e.g. container address on its network); other places answer 501 `port_preview_unsupported` for now (E2B has its own `https://<port>-<id>.e2b.app` hosts: note as follow-up).
- **Auth by signed token, not cookies:** the BFF mints a short-lived token (HMAC with `AGENTRY_WEB_SESSION_SECRET`, payload: owner session id, environment id, port, expiry ~1 h) on `POST /api/preview` (CSRF-checked) and the preview URL carries it: `/preview/<token>/`. Requests under `/preview/<token>/…` are authorised by the token alone (the session cookie is not needed and must not be forwarded upstream as a cookie; the BFF uses the session's Agentry credential server-side as for every other proxied call, looked up from the token's session id).
- **Isolation:** every preview response gets `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-modals` (no `allow-same-origin`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and drops upstream `Set-Cookie`. So the page runs in an opaque origin even when opened in a new tab and cannot read the Agentry app or its CSRF token. The iframe uses the same `sandbox` attribute.
- **Base path:** apps that use relative URLs work as is; absolute paths (`/assets/x.js`) resolve to the Agentry origin and break. The panel says so in one line with the fix ("Start your dev server with a base path, e.g. `vite --base /preview/<token>/`" — or simpler: show the exact base to use). Follow-up: a per-port subdomain origin (`p-<token>.<host>`) removes this limit.
- **Streaming:** proxy streams bodies both ways (no buffering), passes status, content-type, cache headers; strips hop-by-hop headers. HTTP only first; WebSocket (HMR) is a follow-up (the page still works, just no live reload).
- **Which ports:** the API lists listening TCP ports in the sandbox (`GET /v1/agents/environments/{id}/ports` → `[{ port, process? }]`, via the service: e.g. `ss -ltnp` / `/proc/net/tcp` through envd exec), excluding envd's own and the browser's DevTools ports.

## UI (web)

- Side panel tab **Preview** (existing panel tabs, `src/ui/preview/PanelTabs.tsx`; reuse the WebView/BrowserToolbar pieces if they fit): a port picker (detected ports, refreshed on open and every 5 s while the tab is open; plus "Other port…" input), address bar showing the path inside the app, Reload, Open in new tab (icon buttons with tooltips — the user wants minimal buttons), and the iframe. Empty state: "Nothing is listening yet. Ask the agent to start your app, e.g. `npm run dev -- --host 0.0.0.0`." Note: servers must listen on 0.0.0.0 or the container address, not only 127.0.0.1 — confirm how the service reaches the port; if 127.0.0.1-only servers are unreachable, say so in the empty state.
- Also: when a tool result or the agent's text mentions `http://localhost:<port>` in a sandbox chat, nothing automatic for now (follow-up).
- Only for sandbox chats (local server chats: hide the tab).

## Tests (keep few, per the user)

Service: one proxy round trip against a real Docker sandbox in the Docker suite if cheap, else a fake upstream. API: token-free owner scoping + one pass-through test. Web: token sign/verify unit test, the CSP header on responses, the allow-list. No large component suites.
