# Connectors (Composio-backed tool catalog) (design)

Status: 2026-11-10. Phase 0 landed in `dsh-agents-api` (profile row). Phase 1 slice landed in `agentry-web`, uncommitted: per-owner key store, `/api/agentry/connectors/key`, proxy injection on `POST agents/sessions`, `/settings/connectors` with a key field and a settings nav. Browser flow not yet verified live. The Marketplace and Connectors pages are merged into one page, `/settings/connectors` (key section first; without a saved key the directory is not rendered or sent; with a key, a compact key row plus the directory: catalog, search, category chips, Featured row, Connect starts a chat with a prefilled message), also uncommitted. Per-toolkit connected status is shown: the server lists active accounts through `COMPOSIO_MANAGE_CONNECTIONS` with `action: "list"` only (never the default `add`, which creates a Connect Link) and cards show "Connected" instead of Connect; unknown status shows Connect. The custom MCP connector form and in-page Connect Links are not built. (The file name predates the rename from "connected apps" to "Connectors".)

## Goal

A **Connectors** page where users browse a catalog of apps, connect their own accounts, and let their agents use them. Composio Platform backs the catalog and holds OAuth tokens; Agentry never handles provider credentials. Users never see the word Composio.

Featured first: Gmail, GitHub, Google Drive, Google Calendar. The same MCP endpoint serves the whole catalog (1,000+ toolkits), so widening later is a UI change only.

## Phases

- **Phase 0 (single user, no UI):** a profile-wide MCP row in `~/code/dsh-agents-api/cordis.patch.yml`: an `insert:` entry for `@deepseek-ai/dsh-mcp-client`, `serverName: composio`, `transport: streamable-http`, `url: https://connect.composio.dev/mcp`, header `x-consumer-api-key` from `COMPOSIO_API_KEY` via `!!js`. Tools appear as `mcp__composio__*` and the agent offers a Connect Link in chat. The key stays in the harness environment, so it is not in any agent config or session log. All sessions share one Composio identity, so this is valid only while there is one user. To verify: whether the profile-wide mount can be masked per agent (`host_tools`).
- **Phase 1 (this spec's main body, before a second user exists):** per-owner Composio Platform sessions from the BFF, plus the Connectors page.
- **Phase 2 (separate spec):** custom MCP connectors ("Add custom connector": URL and headers, or stdio command). Prerequisite: a per-owner encrypted credential store in Postgres, because the headers are secrets.

## Landed slice (own key per owner)

- The user saves a Composio consumer key (`ck_...`) on `/settings/connectors`. It is stored encrypted (AES-256-GCM, HKDF from the session secret, owner bound as AAD) in `${AGENTRY_WEB_DATA_DIR ?? '.data'}/connectors.json` (gitignored) and never returned to the browser.
- On `POST agents/sessions` the proxy adds an `mcp` tool (`server_label: composio`, URL from `AGENTRY_WEB_COMPOSIO_MCP_URL`, default `https://connect.composio.dev/mcp`, header `x-consumer-api-key`) when the owner has a key and the request has an inline `agent` without that label.
- With a stored key the per-agent tool shadows the profile row's global `composio` tools for that session (agent-scoped server names are separate from global ones in `dsh-mcp-client`; shadowing is read from the code, not yet run). Remove the profile row once the web key is the only path.
- The stored key is the user's Composio Connect consumer key, so the key-exposure concern below applies to the agent's tool config and session log; verify header redaction.
- Apikey sign-in mode has no owner id: all apikey users share one slot.
- UI copy is inline English; this repo has no locale dictionaries.

## Decisions (phase 1)

1. **Product:** Composio Platform (users connect their own accounts).
2. **Integration point:** the agentry-web BFF. The harness and `@agentry/api` do not change; Agentry API already mounts wire `type: "mcp"` tools over HTTP (`src/mount-mcp-tools.ts`).
3. **Identity:** Composio `user_id` = the Agentry `owner` (Keycloak `sub`, or the apikey owner).
4. **Transport:** Composio session with `mcp: true`; the BFF adds the returned URL and headers to the session's agent `tools` as an `mcp` entry with `server_label: "composio"` (matches the profile row, so tools are `mcp__composio__*` either way).
5. **Connect flow:** Connect Link from `session.authorize(toolkit)`, plus the in-session `COMPOSIO_MANAGE_CONNECTIONS` meta tool with a `callback_url` back to the Connectors page. No provider OAuth code in Agentry.
6. **Catalog:** browse and search from Composio's toolkit list (public JSON `docs/public/data/toolkits-list.json` in the SDK repo; check whether the SDK exposes a listing call and prefer it). The first release enables the four featured toolkits; the catalog view is read-only beyond them until widened by config.
7. **Approvals:** sends, deletes, and writes require approval (`require_approval` by explicit tool slug, discovered at build time with the CLI, never guessed). Harness MCP client elicitation support is unverified, so set `noElicitationSupportFallback: "deny"` until verified.

## Page and navigation

- Routes: `/settings` (unchanged) and `/settings/connectors`; a small section nav at the top of the settings area (General, Connectors). The main sidebar is unchanged.
- Page: featured cards (status: Not connected, Connected, Needs reconnect; Connect or Reconnect), then a searchable catalog list. Connect opens the Connect Link and returns through `callback_url`.
- Deep link: the chat shows "Connect Gmail" when a call fails for an unconnected app (follow-up, not the first cut).
- Copy through the locale dictionaries, sentence case; the word "Composio" does not appear in UI copy.

## Flow

```
Browser --(same-origin, CSRF)--> BFF route /api/agentry/connectors/*
  GET  /connectors                -> catalog + connection state for owner
  POST /connectors/{toolkit}/link -> session.authorize(toolkit) -> { redirect_url }
BFF on session start:
  composio.create(owner, { mcp: true, toolkits, ... })
  -> session.mcp.{url,headers}
  -> agent.tools += { type:"mcp", server_label:"composio", transport:{type:"http", server_url, headers} }
  -> POST /v1/agents/sessions  (Agentry API)
```

## Credential handling (the key risk, phase 1)

`session.mcp.headers` carries the credential used to create the session, normally the project API key (`x-api-key`), which reaches the whole Composio project. Putting it in agent tool config exposes it to the harness, the model-visible tool config, and the session log.

- The key never reaches the browser and is never stored in Postgres or in saved agent records. Headers are built per session in the BFF and passed only in the session-create request.
- Prefer a **scoped project key** (dashboard, Settings, API Keys). Session management (write) creates sessions; session tool execution (write only) is what MCP calls need. Open question: whether the MCP endpoint accepts an execution-only key while a management key creates the session. If yes, put only the execution-scoped key in the harness headers. If no, revisit before multi-user containers.
- Open question: whether the harness redacts MCP headers from the session log and the admin request reconstruction. Verify; if not, redact in the Agentry history layer.

## Components

- `src/server/connectors.ts`: SDK wrapper. Reads `COMPOSIO_API_KEY` (server-only env; startup `ConfigError` when enabled and missing). Methods: `catalog()`, `connectionStatus(owner)`, `authorize(owner, toolkit, callbackUrl)`, `mcpTool(owner)`.
- BFF routes under `app/api/agentry/connectors/` (allow-list entry, CSRF on POST).
- Session-create path: append `mcpTool(owner)` to `agent.tools` when enabled, even with no connections yet so the agent can prompt for one.
- UI: `app/(app)/settings/connectors/page.tsx`, `src/ui/settings/Connectors*.tsx`, settings section nav. Trajectory already renders `mcp_call` as `server_label.name`.
- Config: `AGENTRY_WEB_CONNECTORS_ENABLED`, `COMPOSIO_API_KEY`, `AGENTRY_WEB_CONNECTORS_FEATURED` (toolkit slugs).

## Out of scope

Triggers and webhooks, Firewall, custom auth configs and white-labeled OAuth, multiple accounts per toolkit, shared connections, custom MCP connectors (phase 2), an Agentry MCP facade (separate spec), wire function tools.

## Verification plan

1. Phase 0: set `COMPOSIO_API_KEY`, add the row, run a Gmail task end to end (Connect Link in chat, an `mcp_call` item, a correct answer).
2. Create a Composio Platform project and scoped keys; record which scope the MCP endpoint needs.
3. Live check of phase 1: connect Gmail on the Connectors page, start a session, confirm `mcp_call`.
4. Confirm approval behavior for a send with the harness MCP client, and that headers do not appear in session history or admin reconstruction.
5. Unit tests: wrapper with a fake SDK, route allow-list and CSRF, tool injection, config errors; component test for the page.

## Confirm before coding

Exact `session.authorize`, connection-status, and catalog-listing call shapes in the installed `@composio/core` (>= 0.19.1; read `ts/` in the SDK repo), exact toolkit slugs, and the tool slugs to gate for approval.
