# Fast first reply (Composio relay) and background environment create — plan

Date: 2026-11-27. Spec-less plan (agreed in chat). Two independent tasks, run in parallel worktrees.

## Task A — Composio relay in the API (`~/code/dsh-agents-api`, branch `feat/composio-relay`, worktree `~/code/wt/api-composio-relay`)

**Problem.** The web BFF adds the owner's Composio connector to every new chat as an HTTP MCP tool (`https://connect.composio.dev/mcp` + the owner's key in headers; `agentry-web/src/server/connector-tools.ts`). DSH's `mcp-client` blocks plugin activation on the first connection plus `tools/list` (`dsh-pinned/packages/mcp/mcp-client/src/index.ts:199`). Since `72d75a9` the create answers early, but the first message still waits ~1.8–2 s for that connect before its turn starts.

**Approach (OpenMausBot-style, see `~/code/OpenMausBot/server/connector-proxy.ts`, `connector-tools-list.ts`, `composio-session.ts`).** The API serves a local MCP relay on its own HTTP server and points the agent's Composio MCP tool at it instead of at Composio:

1. **Rewrite.** In `resolveMcpConfigs` (`src/mount-mcp-tools.ts`) or just before it in `gateway.ts`, an HTTP MCP tool whose `server_label` equals the configured Composio label (`this.composio.serverLabel`, default `composio`) AND whose URL host is `connect.composio.dev` (or any URL, if simpler and safe: match on label + Composio host only) is rewritten to `http://127.0.0.1:<api port>/internal/mcp-relay/<token>`. `<token>` is a random opaque id mapping, in memory, to `{ upstreamUrl, upstreamHeaders }`; the upstream key never appears in the URL. Same token for the same `(url, headers)` pair (key = sha256 of url + sorted headers). The relay route is reachable only from loopback and only with a known token (unknown → 404). Server label stays the same, so `mountComposio` guards, grants, approvals and `mountComposioAppTools` work unchanged. Find how the API knows its own listen address/port (gateway options / env); if not available, add it where the server starts listening.
2. **Relay endpoint (minimal Streamable HTTP MCP server, JSON responses, stateless downstream).**
   - `initialize` → answered locally at once (protocolVersion echoed, `capabilities: { tools: { listChanged: false } }`, serverInfo). Notifications (`notifications/initialized`, etc.) → 202, not forwarded.
   - `tools/list` → from a per-upstream cache if present (serve stale immediately, refresh in the background); if nothing cached, fetch upstream and wait (same cost as today, once per key per process). Cache also persisted to a small JSON file per key hash under the API's data dir (tool list only, no secrets) so an API restart keeps it warm. Cursor pagination: pass through / cache per cursor like OpenMausBot.
   - `tools/call` (and `ping`) → forwarded to the shared upstream connection for that key.
   - Anything else → forwarded as well, or `-32601` if forwarding is not straightforward.
3. **Shared upstream connection per key.** One upstream MCP session per key hash, created lazily on first need and reused by every chat: do `initialize` + `notifications/initialized` once, keep `mcp-session-id`, forward later frames with it. On 404 / session-expired, re-initialize once and retry. Parse SSE (`text/event-stream`) or JSON replies (see OpenMausBot `parseMcpResponse`). Prefer raw `fetch` JSON-RPC forwarding (no new dependency); if `@modelcontextprotocol/sdk` is already resolvable from the API and cleaner, an SDK `Client` per key is fine, pinned to an exact version.
4. **Warm-up.** When a session create carries a Composio tool, start the upstream connect + `tools/list` refresh in the background (non-blocking) so the first tool call is fast.
5. **Failure.** If upstream is down and nothing is cached, `tools/list` returns the error (connector tool is `required: false`, so the chat still starts, as today). A `tools/call` upstream failure is returned as a JSON-RPC error / `isError` result with the upstream message.
6. **Off switch.** `AGENTRY_COMPOSIO_RELAY=off` restores direct connection (no rewrite). Default on.

**Tests (Vitest, `DSH_ROOT=~/code/dsh-pinned pnpm vitest run`).** Fake upstream MCP HTTP server: initialize answered locally without upstream call; tools/list served from cache on second session with upstream delayed (assert fast); one upstream initialize shared by two sessions; session-expired re-init; unknown token 404; non-loopback refused if testable; rewrite only for the Composio label/host; off switch. Existing composio/mcp tests stay green. Known flaky: `tests/sandbox-remote.spec.ts`.

**Docs.** `docs/changes/2026-11-27-composio-relay.md`, a line in `docs/README.md`, CHANGELOG bullet, env var in the config docs.

## Task B — Environment create in the background (API + web)

API branch `feat/env-background` (worktree `~/code/wt/api-env-background`); web branch `feat/env-background` (worktree `~/code/wt/web-env-background`).

**Problem.** `POST /agents/environments` (`provisionEnvironment`, `src/gateway.ts` ~2511) awaits `provider.create` (image pull, packages, setup commands); a slow GPU-box create timed out at 180 s, leaving the environment failed while the sandbox ran. The record only exists after setup, so a reload or another device does not see it.

**API.**
1. Split `provisionEnvironment`: validation stays synchronous (all current 400s). Add an option `{ background?: boolean }`; only the `POST /agents/environments` route passes `true`. The in-chat `provision` callback (gateway ~2002) and session-create inline environments keep the synchronous path (they need a ready environment).
2. Background path: store the record first with the pending/provisioning status (`status: 'pending'`, which `environmentJson` must surface as `state: 'provisioning'`; check `environment-compat.ts` and `statusOf` in `agentry-sandbox-provider.ts`), answer 201 with it, then run `provider.create` in the background and `store.environments.update` with the result (status, handle/metadata, error). On failure: status `failed` with the error.
3. Adopt after timeout: if `create` fails with a timeout-like error, check whether the provider can still see the sandbox for this id (look for an inspect/get/status method on `SandboxProvider`; the agentry-sandbox provider uses the env id). If it exists and is running or still provisioning, keep polling it (bounded, e.g. up to 15 min) and adopt it instead of marking failed.
4. A delete during provisioning: mark deleting, let the background task destroy what it created when it finishes (or destroy immediately if the provider supports it). An API restart with records left in `pending`: on startup (or on read), re-check with the provider; if unknown, mark `failed` ("Setup was interrupted").
5. Tests in `tests/gateway.spec.ts` (or a new spec) with a fake slow provider: POST answers before create resolves with `provisioning`; record updates to running; failure → failed; timeout + existing sandbox → adopted; in-chat provision still synchronous; delete during provisioning.
6. Docs: `docs/changes/2026-11-27-environment-create-background.md`, `docs/http-api.md`, `openapi/agentry.yaml` (201 may return `provisioning`), CHANGELOG.

**Web (`agentry-web`).** `src/ui/sandboxes/SandboxesPage.tsx` currently keeps a client-only "Setting up…" card while the create request is pending (line ~116). Now the POST returns quickly with a `provisioning` record: drop the client-only placeholder, show the real record in the list with "Setting up…" (spinner) while `provisioning`, a failed state with the error and a Delete action, and keep the existing polling of settling environments (make sure `provisioning` counts as settling, on the list and the detail page `EnvironmentDetail.tsx`). Start/Stop/Reset/New chat disabled while provisioning. Update component tests; CHANGELOG bullet.

## Rules for both

- Commit as `fakhrulfaiz <fakhrulfaiz2003@gmail.com>`; no Co-Authored-By or any AI attribution anywhere.
- `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH` before pnpm. API tests: `DSH_ROOT=~/code/dsh-pinned pnpm vitest run`; web: `pnpm typecheck && pnpm vitest run`.
- Do not touch the main checkouts (`~/code/dsh-agents-api`, `~/code/agentry-web`): other sessions have uncommitted work there. Work only in the worktree. Do not merge or push; commit on the branch and report.
- No per-task review agent; tests only.
