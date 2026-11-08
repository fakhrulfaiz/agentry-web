# Agentry Web F1 — design

Date: 2026-11-08 · Status: awaiting user review · Scope: F1 = app shell, sign-in, chat. F2 (admin), F3 (artifacts and files), and F4 (trace inspector and subagent views) get their own specs.

Backend: Agentry API (`~/code/dsh-agents-api`, package `@agentry/api`), an OpenAI Agents API–compatible DSH plugin. Its decisions live in that repository's `AGENTS.md`; this spec does not repeat them.

## 1. Goal and success criteria

A claude.ai-style chat client for Agentry, branded Agentry, built with the astryx design system, where the browser never holds an Agentry credential.

F1 is done when:

1. A user signs in with Keycloak (keycloak mode) or with an Agentry API key (apikey mode), and signs out.
2. A user starts a chat, sees the reply stream token by token, stops a running turn, and sends follow-ups (steering while running, a new turn while idle).
3. Reopening a chat shows its full history; a dropped stream reconnects and resumes with no missing or duplicated events.
4. Tool calls, reasoning, subagent activity, approvals, and questions render as cards; approvals and questions are answered inline.
5. The sidebar lists, searches by title, renames, and deletes the user's chats.
6. The browser's JavaScript, storage, and network traffic to the web app never contain an Agentry access token or API key.
7. Unit, component, and end-to-end tests pass against a mock Agentry API, and one manual live check passes against a local Agentry stack.

## 2. Out of scope

Admin pages (F2), artifacts panel content, file uploads and per-turn diffs (F3), trace/log inspector and subagent detail views (F4), sidebar projects or folders (no backend support), voice, sharing, and deployment manifests.

## 3. Stack and repository

- Repository `~/code/agentry-web` (git, branch `main`), its own `AGENTS.md` with a `CLAUDE.md` symlink, and `CHANGELOG.md`.
- Next.js App Router, TypeScript strict, React 19, pnpm.
- `@astryxdesign/core`, `@astryxdesign/theme-neutral`, `@astryxdesign/cli`, and `@stylexjs/stylex` at exact pinned versions (0.7.11 / 0.19.x at time of writing; astryx is pre-1.0). Run `npx @astryxdesign/cli init` to add the agent docs; `AGENTS.md` records the conventions it installs.
- StyleX compiles through its Next.js integration. astryx components and tokens provide all UI; StyleX is used only for layout glue. No other CSS framework.
- `iron-session` for the encrypted session cookie; Auth.js for Keycloak OIDC.
- API types are generated from the backend's `openapi/agentry.yaml` (backend Task 9, moved earlier to run right after backend Task 6). Until it exists, types are written against the backend's `src/types.ts` and replaced once the contract lands.
- Commit messages never contain `Co-Authored-By` or any AI attribution line.

## 4. Layout and pages

```
┌──────────────┬───────────────────────────────────────────┐
│ Sidebar      │  Top bar: session title · model picker     │
│ + New chat   ├───────────────────────────────────────────┤
│ Search       │   Conversation (centered column, ~760px)  │
│ ─ Today …    │   messages · reasoning · tool cards       │
│ ⚙ Settings   │   approval / question cards               │
│ 👤 user menu │   Composer                                 │
└──────────────┴───────────────────────────────────────────┘
```

The sidebar collapses, and becomes a drawer below 768px. A right-hand panel slot exists in the layout but stays empty in F1 (F3 fills it).

| Route | Content |
|---|---|
| `/login` | Keycloak button (keycloak mode) or API key form (apikey mode) |
| `/` | Empty state with a large composer; the first send creates a session and navigates to it |
| `/c/[sessionId]` | One conversation: history plus live stream |
| `/settings` | Profile, theme (light/dark/system), default model; in apikey mode, the user's own API keys (list, revoke) when the backend exposes that, otherwise hidden |

Branding: product name Agentry, own wordmark and one accent color layered on `theme-neutral`. Layout and interaction follow claude.ai; no Anthropic name, logo, mark, licensed fonts, or exact colors. Fonts are open-licensed: a sans serif for UI, with an optional serif for assistant prose.

## 5. Sign-in and the BFF

The web app's server (Next route handlers) is the backend-for-frontend (BFF). The browser holds only `agentry_session`: an `iron-session` cookie, `httpOnly`, `SameSite=Lax`, `Secure` in production, encrypted with `AGENTRY_WEB_SESSION_SECRET` (at least 32 bytes, required at startup).

`AGENTRY_WEB_AUTH` selects the mode; any other value or a missing required variable fails startup with a named error.

**keycloak mode** (`AGENTRY_WEB_KEYCLOAK_ISSUER`, `AGENTRY_WEB_KEYCLOAK_CLIENT_ID`, `AGENTRY_WEB_KEYCLOAK_CLIENT_SECRET`): Auth.js authorization-code flow with PKCE against the confidential client `agentry-web`. Access and refresh tokens are kept server-side inside the encrypted session. The BFF refreshes an expired access token before calling Agentry; a failed refresh clears the session and redirects to `/login`. Sign-out clears the session and ends the Keycloak session (RP-initiated logout).

**apikey mode**: `/login` takes one API key. The BFF validates it with one authenticated Agentry call; on success the key is stored only inside the encrypted session. A `401` from Agentry at any later point clears the session and redirects to `/login`.

**Proxy**: route handlers under `/api/agentry/*` forward an explicit allow-list of `/v1` routes used by F1 (agents read, sessions create/list/get/update/delete, events post, items, turns, tools list, stream). Anything else answers `404`. `AGENTRY_API_URL` is server-only. State-changing calls require `POST` (or `DELETE`) with a same-origin check and a CSRF token header issued with the session. `GET /api/agentry/sessions/[id]/stream` passes Agentry's SSE through unchanged, including `Last-Event-ID`.

**Identity**: the user menu shows the owner and roles that the BFF resolves (token claims in keycloak mode, the key's principal in apikey mode). Role checks for future admin pages run on the server.

## 6. Chat and streaming

- New chat: `POST /sessions` with the first message and the selected model, then navigate to `/c/[id]` and attach the stream.
- Follow-up: `POST /sessions/{id}/events` with `agent.session.input.message`. Agentry steers when a turn is running and starts a new turn when idle.
- Stop: `agent.session.input.cancel`.
- Open an existing chat: load `GET /items` and `GET /turns`, then attach the stream with `Last-Event-ID` set to the last seen event id. Event ids are deterministic (backend Task 5), so the client de-duplicates by id.
- Reconnect: on stream loss, retry with exponential backoff (1s doubling to 30s cap) and the same `Last-Event-ID`; show a "Reconnecting…" pill while disconnected.
- State: one reducer per open conversation that takes wire events as input. Loading history and receiving live events produce the same state.

Rendering:

| Wire content | UI |
|---|---|
| User message | Right-aligned bubble |
| Assistant text | Full-width Markdown (code with copy, tables, math), streamed |
| Reasoning | Collapsed "Thinking" block |
| Tool call + result | Compact card: name, short argument summary, status, expandable full input and output |
| Subagent activity | "Delegated to <name>" card with status |
| Approval (`requires_action`, type `approval`) | Card with Allow / Deny |
| Question (`requires_action`, `user_question`) | Card with options or free text |
| Turn failed or interrupted | Inline notice with Retry |

Composer: multi-line, Enter sends, Shift+Enter inserts a newline, Stop while running, model picker filled from the models Agentry reports. Text only.

Sidebar: `GET /sessions` paged newest first, grouped Today / Yesterday / Earlier; title search; rename (session metadata title) and delete.

Errors: `401` → `/login`; `503 store_unavailable` → banner and retry; any other error shows the API's message inline. No blank screens.

## 7. Accessibility

Keyboard navigation for every control, visible focus, focus moves to the composer after send and to a card's first control when it requires action, `aria-live` for streamed text at a polite rate, and `prefers-reduced-motion` respected.

## 8. Testing

- Unit (Vitest): conversation reducer (including replay de-duplication), BFF allow-list, CSRF check, session cookie round trip, both login handlers, Keycloak refresh logic.
- Component: message, tool, approval, and question cards.
- End-to-end (Playwright) against a mock Agentry API that serves recorded SSE: apikey login, new chat with streaming, stop, reconnect with `Last-Event-ID`, approval card, sign-out. No DeepSeek key and no Keycloak required.
- Manual live check against a local Agentry stack (`agents` profile with the development key), after backend Tasks 5 and 6 are merged.

## 9. Dependencies on the backend

| F1 needs | Backend task |
|---|---|
| History and replay after reconnect or restart | Task 5 |
| Approval and question cards | Task 6 |
| Generated API types | Task 9 (OpenAPI), moved to run after Task 6 |
| apikey-mode key management in settings | Not yet in the backend; hidden until it exists |

F1 development starts against the mock API immediately and switches to generated types when the contract exists.
