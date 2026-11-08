# Agentry Web F1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Agentry web app's F1: a claude.ai-style chat client (shell, sign-in, chat) on Next.js and astryx, with a BFF that keeps every Agentry credential out of the browser.

**Architecture:** One Next.js App Router app. Route handlers under `/api/*` form the BFF: an encrypted `iron-session` cookie holds the user's Agentry credential (Keycloak tokens or an API key); an allow-listed proxy forwards `/v1` calls and passes SSE through. The client keeps one reducer per conversation fed by wire events, so history load and live streaming produce the same state.

**Tech Stack:** Next.js (App Router), React 19, TypeScript strict, pnpm, `@astryxdesign/core` + `@astryxdesign/theme-neutral` + `@astryxdesign/cli` 0.7.11 (exact), `@stylexjs/stylex` 0.19.x (exact), `iron-session`, Auth.js (`next-auth` v5) for Keycloak, Vitest + Testing Library, Playwright.

**Spec:** [docs/superpowers/specs/2026-11-08-agentry-web-f1-design.md](../specs/2026-11-08-agentry-web-f1-design.md). Backend contract: `~/code/dsh-agents-api/docs/http-api.md` and `src/types.ts` (OpenAPI `openapi/agentry.yaml` once backend Task 9 lands).

## Global Constraints

- Browser JavaScript, storage, and requests to the web app never contain an Agentry access token, refresh token, or API key.
- Cookie `agentry_session`: `httpOnly`, `SameSite=Lax`, `Secure` when `NODE_ENV=production`; secret `AGENTRY_WEB_SESSION_SECRET` ≥ 32 bytes, required at startup.
- `AGENTRY_WEB_AUTH` ∈ `keycloak` | `apikey`; keycloak mode requires `AGENTRY_WEB_KEYCLOAK_ISSUER`, `AGENTRY_WEB_KEYCLOAK_CLIENT_ID`, `AGENTRY_WEB_KEYCLOAK_CLIENT_SECRET`; `AGENTRY_API_URL` is required and server-only. Missing or invalid values fail startup with a named error.
- Proxy allow-list only (spec §5); other paths answer `404`. State-changing calls need same-origin plus an `x-agentry-csrf` header matching the session's CSRF token.
- Reconnect backoff: 1s doubling to a 30s cap; always resend `Last-Event-ID`.
- UI from astryx components and tokens; StyleX only for layout glue; no other CSS framework. Branding "Agentry"; no Anthropic name, logo, mark, licensed fonts, or exact colors.
- Exact dependency versions (no `^`) for astryx and StyleX.
- Commit messages contain no `Co-Authored-By` trailer and no AI/Claude attribution line. Git identity `fakhrulfaiz <fakhrulfaiz2003@gmail.com>` (already set in the repo).
- Every task updates `CHANGELOG.md` (dated bullet).

## Review Focus

1. **Session cookie tampering or a rotated secret** — treated as signed-out (redirect to `/login`), never a 500 (Task 2 test `tampered cookie reads as empty session`).
2. **Agentry answers 401 mid-conversation (key revoked, refresh failed)** — the BFF clears the session and the client lands on `/login`, not a broken chat (Task 4 test `upstream 401 clears session`).
3. **SSE reconnect after a long gap re-delivers shown events** — the reducer ignores duplicate ids and keeps order (Task 5 test `duplicate and replayed events are ignored`).
4. **Proxy path tricks** (`..`, encoded slashes, `/admin/v1`, absolute URLs) — never reach a non-allow-listed upstream route (Task 4 test `rejects traversal and non-allow-listed paths`).
5. **A turn ends while the tab is backgrounded** — on refocus the UI shows the final state from replay and is not stuck "running" (Task 8 e2e `reconnect after background shows completed turn`).

---

### Task 1: Scaffold, configuration, and repo docs

**Files:**
- Create: the Next.js app (`package.json`, `next.config.ts` with the StyleX integration, strict `tsconfig.json`, `app/layout.tsx`, `app/page.tsx` placeholder, `instrumentation.ts`), `src/config/env.ts`, `tests/unit/env.spec.ts`, `vitest.config.ts`, `playwright.config.ts`, `.env.example`, `.gitignore`, `CHANGELOG.md`, `README.md`
- Modify: `AGENTS.md` (extend with the conventions `npx @astryxdesign/cli init` installs); keep the `CLAUDE.md` symlink
- Run: `npx @astryxdesign/cli init` and commit what it generates

**Interfaces:**
- Produces:
```ts
export type AuthMode = 'keycloak' | 'apikey'
export interface WebConfig {
  auth: AuthMode
  apiUrl: string
  sessionSecret: string
  keycloak?: { issuer: string; clientId: string; clientSecret: string }
  production: boolean
}
export class ConfigError extends Error { code: 'missing' | 'invalid'; variable: string }
export function loadConfig(env: NodeJS.ProcessEnv): WebConfig   // throws ConfigError
export function getConfig(): WebConfig                           // memoized loadConfig(process.env); server-only
```

- [ ] **Step 1: Failing tests** in `tests/unit/env.spec.ts`: valid apikey env → config; valid keycloak env → config with `keycloak`; missing `AGENTRY_API_URL` → `ConfigError { code: 'missing', variable: 'AGENTRY_API_URL' }`; `AGENTRY_WEB_AUTH=foo` → `invalid`; a 31-byte secret → `invalid`; keycloak mode without the client secret → `missing`.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/env.spec.ts` → FAIL (module missing).
- [ ] **Step 3: Scaffold and implement.** `pnpm create next-app` (App Router, TypeScript, no Tailwind); add astryx and StyleX at exact versions; configure StyleX for Next by following the guide that `npx @astryxdesign/cli docs` lists; wrap `app/layout.tsx` in astryx's theme provider with `theme-neutral`; implement `env.ts`; call `getConfig()` from `instrumentation.ts` so startup fails fast.
- [ ] **Step 4: Verify** `pnpm vitest run` PASS; `pnpm build` succeeds; `pnpm dev` renders an astryx `Button` on `/` in light and dark.
- [ ] **Step 5: Docs.** AGENTS.md: purpose, spec and plan links, backend location, these Global Constraints, astryx conventions from `init`, and the "Resume this plan" section. README: env table and `pnpm dev`. CHANGELOG entry.
- [ ] **Step 6: Commit** `chore: scaffold Next.js app with astryx and config validation`

---

### Task 2: Session cookie, CSRF token, identity

**Files:** Create `src/server/session.ts`, `src/server/csrf.ts`, `tests/unit/session.spec.ts`, `tests/unit/csrf.spec.ts`

**Interfaces:**
- Consumes: `getConfig()` (Task 1)
- Produces:
```ts
export type Credential =
  | { kind: 'apikey'; key: string }
  | { kind: 'keycloak'; accessToken: string; refreshToken: string; expiresAt: number; idToken: string }
export interface Identity { owner: string; roles: string[]; displayName: string }
export interface SessionData { credential?: Credential; identity?: Identity; csrf: string }
export function getSession(): Promise<IronSession<SessionData>>        // server-only, cookie 'agentry_session'
export function ensureCsrf(session: IronSession<SessionData>): string  // 32 random bytes, base64url, created if absent
export function checkCsrf(req: Request, session: SessionData): boolean // header x-agentry-csrf === session.csrf AND same-origin Origin/Host
export function publicIdentity(s: SessionData): Identity | null        // the ONLY session data ever sent to the browser
```

- [ ] **Step 1: Failing tests:** round trip (write a credential, read it back); `tampered cookie reads as empty session`; cookie attributes (`HttpOnly`, `SameSite=Lax`, `Secure` only in production); `checkCsrf` is false for a missing header, a mismatched token, and a cross-origin `Origin`; `publicIdentity` never includes `credential`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** with `getIronSession(cookies(), { cookieName: 'agentry_session', password: config.sessionSecret, cookieOptions })`; constant-time CSRF comparison. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: encrypted session cookie and CSRF token`

---

### Task 3: Sign-in and sign-out (both modes)

**Files:** Create `app/login/page.tsx`, `app/api/auth/apikey/route.ts`, `app/api/auth/logout/route.ts`, `src/server/keycloak.ts`, `app/api/auth/[...nextauth]/route.ts`, `src/server/require-auth.ts`, `tests/unit/auth-apikey.spec.ts`, `tests/unit/keycloak-refresh.spec.ts`

**Interfaces:**
- Consumes: Task 2 session API, `getConfig()`
- Produces:
```ts
export class UnauthorizedError extends Error {}
export function requireCredential(): Promise<{ session: IronSession<SessionData>; authorization: string }> // 'Bearer …'; pages redirect to /login, route handlers get UnauthorizedError
export function refreshIfNeeded(c: Extract<Credential, { kind: 'keycloak' }>, now: number): Promise<Credential | null> // refresh 60s before expiresAt; null on failure
```
- apikey login: `POST /api/auth/apikey` with `{ key }`. The BFF calls `GET {AGENTRY_API_URL}/v1/agents?limit=1` with `Bearer <key>`. On 200 it stores the credential and identity (owner and roles from the backend's principal if the response exposes them; otherwise display name "API key user"), then redirects to `/`. On 401 it answers 401 `{ error: 'invalid_key' }`. The key is never echoed.
- keycloak: Auth.js Keycloak provider, `checks: ['pkce', 'state']`. On sign-in, tokens are copied into `SessionData.credential` and never into anything readable by the client. Sign-out clears the session and redirects to Keycloak's end-session endpoint with `id_token_hint`.

- [ ] **Step 1: Failing tests:** apikey happy path (mocked fetch 200) sets the credential and the response body never contains the key; a bad key → 401 and no credential; logout clears the session in both modes; `refreshIfNeeded` refreshes 60s before expiry, returns null on a 400 refresh, leaves a fresh token alone.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; the login page (server component) renders the form for `getConfig().auth`. **Step 4: Run** → PASS; manual: `/login` in apikey mode shows the key field.
- [ ] **Step 5: Commit** `feat: apikey and keycloak sign-in`

---

### Task 4: BFF proxy and SSE passthrough

**Files:** Create `src/server/allowlist.ts`, `app/api/agentry/[...path]/route.ts`, `app/api/agentry/sessions/[id]/stream/route.ts`, `tests/unit/allowlist.spec.ts`, `tests/unit/proxy.spec.ts`

**Interfaces:**
- Consumes: `requireCredential`, `checkCsrf`, `getConfig()`
- Produces: `export function isAllowed(method: string, path: string): boolean` (path after `/api/agentry`, normalized).
- Allow-list (upstream prefix `/v1`): `GET /agents`, `GET /agents/{id}`, `GET /agents/tools`, `POST|GET /agents/sessions`, `GET|POST|DELETE /agents/sessions/{id}`, `POST /agents/sessions/{id}/events`, `GET /agents/sessions/{id}/items`, `GET /agents/sessions/{id}/turns`. The stream has its own route and calls upstream `GET /agents/sessions/{id}/events?stream=true`.
- The proxy adds `Authorization` and `OpenAI-Beta: agents=v1`, strips incoming `cookie` and `authorization`, and forwards status and JSON body. Upstream 401 → clear the session and answer 401 `{ error: 'signed_out' }`.

- [ ] **Step 1: Failing tests:** each allow-listed pair is allowed; `rejects traversal and non-allow-listed paths` (`/v1/agents/../admin`, `%2F`-encoded segments, `/admin/v1/sessions`, `http://evil/x`, unknown methods) → 404; POST without CSRF → 403; `upstream 401 clears session`; the stream route forwards `Last-Event-ID`, pipes bytes unchanged from a mocked upstream `ReadableStream`, and sets `content-type: text/event-stream` and `cache-control: no-store`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`; abort the upstream fetch when `req.signal` aborts). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: allow-listed Agentry proxy with SSE passthrough`

---

### Task 5: API types and conversation reducer

**Files:** Create `src/api/types.ts` (the F1 wire types copied from the backend's `src/types.ts`, header comment naming the source commit; replaced by generated types once `openapi/agentry.yaml` exists), `src/chat/reducer.ts`, `tests/unit/reducer.spec.ts`, `tests/fixtures/*.json` (recorded event sequences)

**Interfaces:**
- Produces:
```ts
export type MessageView =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'reasoning'; id: string; text: string }
  | { kind: 'tool'; id: string; callId: string; name: string; args: unknown; status: 'running' | 'done' | 'failed'; output?: unknown }
  | { kind: 'subagent'; id: string; name: string; status: string }
  | { kind: 'action'; id: string; action: OAIRequiredAction }
  | { kind: 'notice'; id: string; level: 'failed' | 'interrupted' | 'cancelled'; message: string }
export interface ConversationState { sessionId: string; status: SessionStatus; items: MessageView[]; lastEventId: string | null; seen: ReadonlySet<string> }
export function initialState(sessionId: string): ConversationState
export function applyItems(s: ConversationState, items: StoredSessionItem[]): ConversationState
export function applyEvent(s: ConversationState, e: { id?: string; event: OAISessionEvent }): ConversationState
```
Events without an `id` are ephemeral (backend Task 5): they update status and actions but never enter `seen` or move `lastEventId`.

- [ ] **Step 1: Failing tests:** text deltas concatenate into one streaming assistant message that is finalized when the turn completes; a tool call goes running → done with output; `requires_action` adds an action view and answering removes it; `duplicate and replayed events are ignored` (the same id twice, and replayed ids up to `lastEventId`); history (`applyItems`) followed by live events equals the live-only fold of the same fixture; ephemeral events do not move `lastEventId`; failed and interrupted turns add a notice.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** as pure functions. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: conversation reducer over Agentry wire events`

---

### Task 6: Stream hook, client API, mock Agentry server

**Files:** Create `src/chat/use-conversation.ts`, `src/api/client.ts`, `mock/agentry-mock.ts`, `tests/unit/use-conversation.spec.ts`; add the `mock:api` script

**Interfaces:**
- Consumes: reducer (Task 5), proxy routes (Task 4)
- Produces:
```ts
export class ApiError extends Error { status: number; code: string }
export const api: {
  listSessions(q: { after?: string; limit?: number }): Promise<OAIListResponse<OAIAgentSession>>
  createSession(input: { text: string; model: string }): Promise<OAIAgentSession>
  sendMessage(id: string, text: string): Promise<void>
  cancel(id: string): Promise<void>
  answerAction(id: string, actionId: string, answer: { decision: 'approve' | 'deny' | 'answer'; payload?: unknown }): Promise<void>
  renameSession(id: string, title: string): Promise<void>
  deleteSession(id: string): Promise<void>
  items(id: string): Promise<StoredSessionItem[]>
  models(): Promise<string[]>
} // every call goes to /api/agentry/*, sends x-agentry-csrf, throws ApiError
export function useConversation(sessionId: string): {
  state: ConversationState
  connection: 'live' | 'reconnecting' | 'closed'
  send(text: string): Promise<void>
  stop(): Promise<void>
  answer(actionId: string, a: { decision: 'approve' | 'deny' | 'answer'; payload?: unknown }): Promise<void>
}
```
- The stream uses `fetch` with a `ReadableStream` SSE parser (not `EventSource`, so `Last-Event-ID` can be set on reconnect); backoff 1s→2s→…→30s; reconnect immediately when the page becomes visible.
- Mock server (`pnpm mock:api`, port 4010): in-memory implementation of the allow-listed routes; accepts any `Bearer agk_…` as owner `mock`; streams scripted fixtures (text, tool call, approval, failure); supports `Last-Event-ID` replay; `POST /__mock/drop` drops open streams.

- [ ] **Step 1: Failing tests** (mocked fetch, fake timers): after history load the stream connects with `Last-Event-ID` from the items; on stream end it reconnects after 1s, then 2s, capped at 30s, with the last id; a visibility change reconnects immediately; `send` while running posts a message and keeps status running.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** hook, client, and mock server. **Step 4: Run** → PASS; `pnpm mock:api` plus `curl` on a session stream shows events.
- [ ] **Step 5: Commit** `feat: conversation stream hook, API client, mock Agentry server`

---

### Task 7: App shell, sidebar, theming

**Files:** Create `app/(app)/layout.tsx` (auth-guarded shell), `src/ui/shell/Sidebar.tsx`, `src/ui/shell/TopBar.tsx`, `src/ui/shell/UserMenu.tsx`, `src/ui/shell/group.ts`, `src/ui/theme/brand.ts`, `src/ui/brand/Wordmark.tsx`, `tests/component/sidebar.spec.tsx`

**Interfaces:**
- Consumes: `api.listSessions`, `api.renameSession`, `api.deleteSession`, `publicIdentity`
- Produces: `export function groupSessions<S extends { created_at: number }>(sessions: S[], now: Date): { today: S[]; yesterday: S[]; earlier: S[] }`

- [ ] **Step 1: Failing tests:** grouping by local date boundaries; title search filters loaded rows and loads more on scroll; rename updates the row; delete asks for confirmation then removes the row; the collapsed state persists in `localStorage` (reads and writes wrapped in try/catch); below 768px the sidebar renders as a drawer.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** with astryx components (find them with `npx @astryxdesign/cli search sidebar`, `menu`, `dialog`); store the light/dark/system choice in a cookie so server rendering matches. **Step 4: Run** → PASS; visual check in both themes.
- [ ] **Step 5: Commit** `feat: app shell, sidebar, Agentry theme`

---

### Task 8: Conversation page, cards, composer, settings, errors, end-to-end

**Files:** Create `app/(app)/page.tsx` (empty state), `app/(app)/c/[sessionId]/page.tsx`, `src/ui/chat/{Message,Markdown,ReasoningBlock,ToolCard,SubagentCard,ApprovalCard,QuestionCard,Notice,Composer,ConnectionPill}.tsx`, `app/(app)/settings/page.tsx`, `src/ui/errors/ErrorBanner.tsx`, `tests/component/cards.spec.tsx`, `tests/e2e/f1.spec.ts`, `docs/live-check.md`

**Interfaces:**
- Consumes: `useConversation`, `api`, `MessageView`

- [ ] **Step 1: Failing component tests:** each card renders its view; ToolCard expands to full input and output; ApprovalCard Allow/Deny call `answer(actionId, { decision })`; QuestionCard works with options and with free text; Composer: Enter sends, Shift+Enter inserts a newline, Stop shows while running, input disabled while sending; focus moves to the composer after send and to an action card's first control when it appears.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** pages and components. Markdown with `react-markdown`, `remark-gfm`, and `rehype-katex` (code blocks with copy; no raw HTML). `aria-live="polite"` on the streaming message; `prefers-reduced-motion` disables animation. Errors: 401 → `/login`; 503 → `ErrorBanner` with retry; others inline. Settings: identity, theme, default model (cookie); the API keys section stays hidden (spec §9).
- [ ] **Step 4: Failing end-to-end test** `tests/e2e/f1.spec.ts`, against `pnpm mock:api` and `pnpm dev` with `AGENTRY_WEB_AUTH=apikey`: sign in with `agk_test`; a new chat streams the scripted reply; stop mid-stream; `POST /__mock/drop`, then the pill shows "Reconnecting…" and the reply completes without duplicated text; `reconnect after background shows completed turn` (hide the page, finish the turn, show the page); approval card Allow resumes the turn; sign-out returns to `/login`; no response to the browser, `document.cookie`, or `localStorage` contains `agk_test`.
- [ ] **Step 5: Run** `pnpm test && pnpm e2e && pnpm build` → PASS.
- [ ] **Step 6: Write `docs/live-check.md`:** run the local Agentry `agents` profile with the dev key; set `AGENTRY_API_URL=http://127.0.0.1:3080`, `AGENTRY_WEB_AUTH=apikey`; sign in with the dev key; run a chat with a tool call. Execute it after backend Tasks 5–6 are merged.
- [ ] **Step 7: Commit** `feat: conversation UI, cards, composer, settings, end-to-end tests`
