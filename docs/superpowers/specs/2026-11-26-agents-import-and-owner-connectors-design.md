# Agents page extras and connectors for every session (design)

Status: 2026-11-26, draft for review. Not implemented. Covers the "Not yet" items of the Agents page (AGENTS.md status line) and the known limitation in `2026-11-10-agents-page-design.md` ("scheduled runs create their sessions inside the backend, so the BFF's connector injection and soft limit do not apply to them"). Plan: `docs/superpowers/plans/2026-11-26-agents-import-and-owner-connectors.md`.

## What is already done (read from code, 2026-11-26)

- **Hard per-agent app limits exist in the backend.** `dsh-agents-api/src/composio-grants.ts` and `src/mount-composio.ts`: a saved agent's `apps` (app slug to `all` or a list of tool slugs; the legacy `metadata.connectors` list reads as `all` per app) is checked by a `tools.guard` on every `mcp__composio__*` call, on each entry of a `COMPOSIO_MULTI_EXECUTE_TOOL` batch, and on `COMPOSIO_MANAGE_CONNECTIONS`. The web form already writes `apps` (`src/agents/form.ts` `formToParams`, `src/ui/agents/AppsSection.tsx`).
- What is left of the old soft limit: the BFF still appends "Use only these connected apps: ..." to the instructions of a session whose saved agent has the legacy `metadata.connectors` (`src/server/agent-connectors.ts`, called from `app/api/agentry/[...path]/route.ts` `withAgentNote`). It is now redundant, because the backend enforces the same list.

So "hard per-agent app limits" needs only that cleanup. The real work in this spec is three things.

## 1. Connectors for every session: the owner's Composio key moves into the API

### Today

- The web app keeps each owner's Composio consumer key (`ck_...`) in an encrypted file (`src/server/connectors-store.ts`, `.data/connectors.json`, AES-256-GCM, key derived from `AGENTRY_WEB_SESSION_SECRET`).
- On `POST /agents/sessions` only, the proxy adds an `mcp` tool `{ server_label: 'composio', transport: { type: 'http', server_url, headers: { 'x-consumer-api-key': key } } }` to the body's inline `agent` (`src/server/connector-tools.ts` `withConnectorTool`, `app/api/agentry/[...path]/route.ts` `withOwnerKey`).
- The API stores that tool, header included, in the session's saved config (Postgres), and re-mounts it on resume. Responses show the header as `***`.

### What goes wrong

1. **Scheduled tasks.** The schedule form posts to `/agents/schedules`; the API creates the session itself (`src/schedules.ts` `create` → `AgentsGateway.createIdleSession`). The BFF never sees a session create, so the run has no Composio tool (or, in a single-user setup, falls back to the profile-wide `mcp-composio` row in `cordis.patch.yml`, which is the deployment's key, not the user's).
2. **Any other session the BFF does not create:** a body with `agent_id` and no inline `agent` (the proxy only adds the tool to an inline `agent`), sessions made by API-key clients, sessions an agent creates through tools.
3. **A replaced or removed key does not reach existing sessions,** because the old key is frozen into each session's saved config.
4. **The key sits in plain text in Postgres** session config rows (only the API responses mask it).
5. **Owner ids differ in apikey mode:** the BFF files the key under `apikey`, while the API's owner for the dev key is `dev` (`cordis.patch.yml` `auth.devKey.owner`). Harmless today, wrong once the API holds the key.

### Design

The API becomes the only holder of the key and adds the Composio tool when it mounts any session's agent, so every session of that owner gets it, scheduled ones included.

- **Sealed owner secrets (API).** New table `owner_secrets (owner_id, name, sealed, last4, created_at, updated_at, primary key (owner_id, name))`, migration `src/store/migrations/0005-owner-secrets.sql`. Values are sealed with AES-256-GCM under a key derived (HKDF) from a new required-when-used config value `secrets.key` (`AGENTRY_SECRETS_KEY`, at least 32 bytes), with `owner_id + name` bound as authenticated data so a row cannot be moved to another owner. Same scheme as `agentry-sandbox/src/crypto/secrets.ts`. The external coding agents plan (`2026-11-26-external-coding-agent-subagents.md`, option B) needs the same store for its per-owner API keys, so this is built once, generically (`name` = `composio`, later `anthropic`, `openai`).
- **Routes (Agentry extensions, owner scoped):**
  - `GET /agents/connectors/composio` → `{ configured: boolean, last4: string | null, updated_at: number | null }`. Never the key.
  - `POST /agents/connectors/composio` `{ key }` → same shape. 400 `invalid_key` unless it starts with `ck_`. 501 `secrets_disabled` when `secrets.key` is not set.
  - `DELETE /agents/connectors/composio` → `{ configured: false, ... }`.
  - `GET /agents/connectors/composio/connections?toolkits=gmail,github` → the owner's active accounts per toolkit, by calling `COMPOSIO_MANAGE_CONNECTIONS` with `action: "list"` (moved from the BFF's `src/server/connector-status.ts`, same parsing). 409 `connector_key_missing` without a key; 502 `connector_unavailable` when Composio refuses or is down (`reason: rejected | unavailable`, as today).
- **Mount-time injection (API).** In `AgentsGateway.buildAgentSetup` (`src/gateway.ts`), after `mountMcpTools` for the session's own tools: if the session's tools have no `composio` server label and the owner has a sealed `composio` secret, mount one more MCP client, `streamable-http` to `connect.composio.dev/mcp` (config `composio.mcpUrl`), header `x-consumer-api-key`, `required: false` so a Composio outage does not fail the session. It is built in memory each time the agent is created or resumed and is never written to the session config. Grants, approvals and the direct Gmail/Calendar tools (`mountComposio`, `mountComposioAppTools`) already run after it and apply unchanged.
- **Key changes** take effect when a session's agent is next created or resumed (a new chat, a scheduled run that resumes its session after a restart, a server restart). A live chat keeps the key it started with until then. Removing a key does not cut a running chat; the next start has no Composio tools. Stated in the Connectors page help text.
- **Profile-wide row.** The `mcp-composio` row in `cordis.patch.yml` (deployment `COMPOSIO_API_KEY`) stays for single-user setups. With a per-owner key the session's agent-scoped `composio` server shadows it, as today. Multi-user deployments must leave `COMPOSIO_API_KEY` empty (documented in `docker/agentry-api.env.example`).
- **Sessions whose saved config already holds a `composio` tool** (made by the BFF before this change) keep using it: the API does not add a second one (duplicate labels are refused in `resolveMcpConfigs`). A one-off cleanup is not needed; the frozen key stops working only if the user revokes it at Composio.

### Web side

- `app/api/agentry/connectors/key/route.ts` forwards to the new API routes instead of the file store. `GET` returns `{ configured, last4 }` (the page shows `ck_...abcd`).
- `app/api/agentry/connectors/status/route.ts`, `.../connected/route.ts` and `app/(app)/plugins/page.tsx` read connection status from `GET /agents/connectors/composio/connections` through the server (the BFF keeps its short cache, `src/server/connection-cache.ts`, keyed by owner).
- The proxy stops adding the tool (`withOwnerKey` and `src/server/connector-tools.ts` are deleted) and stops adding the soft app note (`withAgentNote` and `src/server/agent-connectors.ts` are deleted; `connectorNote` and `instructionsWithConnectors` leave `src/agents/form.ts`).
- **Moving existing keys:** on `GET /api/agentry/connectors/key`, when the file store still has a key for this user and the API says `configured: false`, the BFF sends it to the API, and on success deletes the file entry. After one release with no file entries left, `src/server/connectors-store.ts` is deleted. In apikey mode the file slot is `apikey` and the API owner is whatever the dev key maps to; the move is keyed by the signed-in user, so it lands under the right API owner.
- No key is ever sent to the browser; CSRF and same-origin apply to the POST and DELETE as today.

### Failure modes

- `secrets.key` unset: the key routes answer 501 `secrets_disabled`; the Connectors page says "This server cannot store connector keys. Ask the administrator to set AGENTRY_SECRETS_KEY." Sessions mount without Composio (or with the profile row).
- `secrets.key` changed: sealed rows cannot be opened; the API logs one warning per owner and treats the key as missing (the page shows "Not configured"; the user pastes it again). No crash, no partial secret in logs.
- Composio unreachable at session start: `required: false`, so the session starts without Composio tools; the guidance section only appears when the tools are present (existing behaviour of `mountComposio`).

## 2. Import an agent from a URL or pasted text

### Formats

- **ECC / Claude Code agent file** (the format in `~/code/ECC/agents/*.md`): YAML front matter with `name`, `description`, `tools` (comma list or YAML list), `model`, then a Markdown body that is the system prompt.
- **Agentry agent JSON**: the `GET /agents/{id}` shape (`name`, `instructions`, `model`, `host_tools`, `multi_agent`, `reasoning`, `metadata`; `apps`, `skills`, `send_policy` are kept only if valid). This also makes a small "Export" (download as JSON or as an ECC-style `.md`) worthwhile.
- Anything else answers 400 `import_unrecognized` ("This file is not an agent definition. Expected a Markdown file with name and description at the top, or an Agentry agent JSON.").

### Where it runs

In the API, as a new extension route, so the fetch and its safety rules sit next to the existing GitHub skill import (`src/skills/github.ts`, `POST /agents/skills/import`) and an in-chat agent-authoring tool can reuse it later.

- `POST /agents/import` `{ url }` or `{ text }` → `{ object: 'agent.import.draft', draft: CreateAgentParams, source: { url?, format: 'ecc' | 'agentry' }, notes: string[] }` or, for a GitHub folder URL, `{ object: 'agent.import.candidates', data: [{ name, description, url }] }` (one entry per `.md` file with front matter; at most 200). Nothing is saved.
- **URL rules:** `https` only; hosts limited to `github.com`, `raw.githubusercontent.com`, `gist.github.com`, `gist.githubusercontent.com` by default (config `agents.importHosts`), which removes server-side request forgery to internal addresses; `github.com/<o>/<r>/blob/<ref>/<path>` is rewritten to the raw URL and `/tree/` URLs list the folder through the GitHub contents API (the same `GithubDeps` as skills); 256 KB cap; 10 s timeout; no redirects off the allowed hosts.
- **Mapping:**
  - `name` → `name` (title-cased from kebab case: `code-reviewer` → "Code reviewer"); `description` → kept in `metadata.description`; body → `instructions` (trimmed; over 65,536 bytes is refused, the preset's `agent-instructions` limit).
  - `tools` → `host_tools.allow` through a fixed map: `Read→read`, `Write→write`, `Edit|MultiEdit→edit`, `Grep→grep`, `Glob→glob`, `Bash→bash`, `WebFetch→web_fetch`, `WebSearch→web_search`, `TodoWrite→todo_write`. `Task` (Claude Code's subagent tool) sets `multi_agent.enabled: true` instead. Names that do not map, or that the Host catalog (`GET /agents/tools`) lacks, are dropped and listed in `notes` ("Dropped tools this server does not have: NotebookEdit"). No `tools` line means no mask (every tool).
  - `model` (`opus`, `sonnet`, `haiku`, `inherit`) is not mapped: the draft has no model, the form uses the user's default, and `notes` says so.
  - `metadata.source_url` records where it came from.
- **License:** the draft view shows the source URL and "Check the source's license before you share this agent." Nothing else is enforced.

### Web side

- Agents page: an "Import" button beside "New agent" opens a dialog with two tabs, "From a link" and "Paste". A folder link shows the candidates as a list to pick one. The chosen draft opens the existing editor dialog prefilled; nothing is saved until Save.
- `EditorTarget` (`src/ui/agents/AgentEditorDialog.tsx`) gains `{ kind: 'new', draft }`; `AgentForm` takes an optional `draft` and applies it the same way it applies a starter (`applyStarter` pattern), then shows `notes` above the form.
- The agent row menu gains "Export" (JSON or Markdown), built in the browser from the record (no secrets: MCP headers come back as `***` and are left out).

## 3. Save a subagent as a named agent

A chat's subagent is defined by the delegating call's arguments: `description` (shown as the card's name), `prompt`, and, when route fields are on (`cordis.patch.yml` sets `modelSelection: true`), a model. If a delegation worked well, the user can keep it as a saved agent.

- The subagent card (`src/ui/chat/SubagentCard.tsx`) gains a "Save as agent" action. It opens the agent editor prefilled: name from `description`, instructions from `prompt` with a short header the user is expected to edit ("You handle tasks like this one:"), model from the call when it named one, else the chat's model; tools and apps unrestricted (the child inherited the parent's); subagents off.
- The reducer (`src/chat/reducer.ts`) keeps `prompt` and `model` on the `subagent` view, read from the parent's function call arguments it already parses for `description`.
- Web only; no backend change.

Not in this piece: letting a chat delegate to a saved agent by name (for example "ask the Code reviewer agent"). DSH's spawn provider runs children on the parent's preset with a prompt only; delegating to a saved agent would be a new backend tool that starts a separate Agentry session. See open questions.

## Testing

- API: unit tests for sealing (round trip, wrong owner fails, changed key fails), the store (memory and Postgres), the routes (no key in any response, 400/409/501 cases), mount-time injection (added once, not when the session already has `composio`, `required: false`, not written to the saved config, picked up on resume), the import parser (ECC fixtures from `~/code/ECC/agents` copied into `tests/fixtures/agents/`, Agentry JSON, unknown text), URL rewriting and host refusal, tool mapping; OpenAPI drift test.
- Web: unit tests for the key route forwarding and migration, the proxy no longer touching the body, the reducer keeping `prompt`/`model`, the subagent-to-form mapping; component tests for the import dialog and "Save as agent". No new e2e.

## Out of scope

Delegating to saved agents by name; sharing agents between users; agent versioning; per-agent Composio accounts (one key per owner); importing whole folders at once; Composio's own per-session toolkit limits (the API guard already enforces grants).

## Open questions for the user

1. **Import hosts:** only GitHub and gists (recommended), or any `https` URL (needs a private-address block on DNS results)?
2. **Delegating to saved agents** (a chat asks a saved agent to do a task): wanted as the next piece? It is a backend tool that runs a separate session, not a DSH subagent card.
3. **`AGENTRY_SECRETS_KEY`:** a new required secret for multi-user deployments. Alternatively derive it from an existing secret, but the API has none today (the dev key is not a secret meant for this). Recommended: a new variable.
4. **Profile-wide `COMPOSIO_API_KEY`:** keep it as the single-user fallback (recommended), or remove the `mcp-composio` row now that every owner can store a key?
