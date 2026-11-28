# Agents page and pickers (design)

Status: 2026-11-10, draft for review. Not implemented. First of four pieces; the others (import from ECC/the internet, subagent deployment, agent-authoring tools and skill) get their own specs.

## Goal

Every signed-in user can create, edit and delete their own saved agents on an Agents page, and choose one when starting a chat or scheduling a task. A normal chat (no agent chosen) stays the default and can use everything.

## Understanding

- A saved agent is the backend's `/agents` record (`name`, `instructions`, `model`, `tools`, `host_tools`, `multi_agent`, `reasoning`, `metadata`). Today the web app sends an inline `agent` per session, so each chat gets a fresh, unsaved agent.
- The backend scopes agents per owner and `POST /agents/sessions` and `POST /agents/schedules` already accept `agent_id` (an inline `agent` is overlaid on top). This piece needs no backend change.
- "Connectors" means the apps (toolkits) Composio exposes through its MCP (Gmail, GitHub, ...). The user's account can connect many; an agent only records which ones it should prefer. This is a soft limit: the model is told to use only those apps. Composio documents hard per-session toolkit limits only through its project-key session API, which is a later change.

## Pages and navigation

- Sidebar gets "Agents" (next to Scheduled, Artifacts).
- `/agents`: a table (not identical cards; agents are dense records) with name, a one-line summary (first line of instructions), model, and "N tools" / "N apps". Search box, "New agent" button, empty state ("Agents are saved setups: instructions, a model and the tools they may use. Create one to start chats or tasks with it.").
- `/agents/new` and `/agents/{id}`: one form page. Header in the Preview panel's style: an icon tile, the name, and Save / Delete on the right.

## The form

- **Basics:** name (required), model (from `AGENTRY_WEB_MODELS`), reasoning effort (Auto, Low, Medium, High as in the composer).
- **Instructions:** a large text area (the system prompt). Empty is allowed.
- **Tools:** the Host tool catalog from `GET /agents/tools`, grouped, as checkboxes. "All tools" is the default; unchecking any saves `host_tools.allow` with the checked names. Re-checking everything clears the mask.
- **Apps:** a checkbox per connected Composio app (status from the existing Connectors status route). Saved as `metadata.connectors` (comma-separated slugs); absent means no preference. Helper text: "The agent is told to use only these apps." Hidden with a link to Connectors when no connector key is saved.
- **Subagents:** a switch for `multi_agent.enabled` and a max count (1 to 8).
- Delete asks for confirmation. Save says "Saved"; errors name the field or the failure and say how to fix it.

## Starter agents

Specialized agents are the point, so the page ships a small bundled gallery of starters, drawn from the ideas in the ECC agent repo (`~/code/ECC/agents`, MIT: 68 specialist agents such as `planner`, `code-reviewer`, `security-reviewer`, `tdd-guide`, `doc-updater`, `docs-lookup`, `seo-specialist`).

- Shown in the empty state and under "New agent" as "Start from": pick one and the form opens prefilled (name, summary, instructions, tool allow list, subagent switch); nothing is saved until the user presses Save.
- About 8 starters, chosen to span more than coding: planner, code reviewer, security reviewer, test writer (TDD), documentation writer, library docs lookup, SEO reviewer, research assistant.
- Each is `{ id, name, summary, instructions, tools: 'read-only' | 'edit' | 'all', multiAgent?: boolean }` in `src/agents/starters.ts`. The instructions are short original prompts (about 15 lines, no Claude Code specifics, none of ECC's boilerplate), credited in a file comment as inspired by ECC (MIT, Affaan Mustafa) so the notice is kept without copying large text.
- Tool presets map ECC's tool lists to the backend's Host tool names at form time using `GET /agents/tools`: `read-only` = read/search tools (ECC `Read, Grep, Glob`), `edit` adds write and shell tools, `all` leaves the mask empty. Names that the catalog lacks are dropped, so a starter never saves a name the backend does not know.
- No model is preset (starters use the user's default model), because ECC's haiku/sonnet/opus hints do not map to the models this deployment offers.
- Importing arbitrary agents from ECC files or URLs is the next piece; it reuses `formToParams` and the same prefilled form.

## Using an agent

- **New chat:** an agent menu in the composer beside the model menu; "Default" first. Choosing one sends `agent_id` and the composer's model/effort as overrides.
- **Schedules:** an "Agent" field in the schedule form (default "Default"), sent as `agent_id` on create and update; shown on the schedule detail.
- **Soft app limit at session start:** when a session is created with an `agent_id` whose `metadata.connectors` is set, the BFF fetches the agent (one `GET /agents/{id}`), and overlays `agent.instructions` = saved instructions plus a final line "Use only these connected apps: Gmail, GitHub." The saved record keeps clean instructions. The existing connector injection (key in the mcp tool headers) is unchanged.
- Known limitation (resolved 2026-11-28): scheduled runs create their sessions inside the backend, so the BFF's connector injection and soft limit did not apply to them. The API now holds each owner's key and mounts Composio on every session, and enforces app grants; the BFF note is gone. See `2026-11-26-agents-import-and-owner-connectors-design.md`.

## Data and server

- `src/api/client.ts`: `listAgents`, `getAgent`, `createAgent`, `updateAgent`, `deleteAgent`, `listHostTools`; `src/api/types.ts`: add `host_tools` and `multi_agent` to `OAIAgent`, params types, tool catalog entry.
- `src/server/allowlist.ts`: add `GET/POST /agents`, `GET/POST/DELETE /agents/{id}`, `GET /agents/tools`; state-changing calls keep same-origin and CSRF. Reserved ids stay reserved so `agents/tools` is not read as an agent id.
- `src/agents/form.ts` (pure): `agentToForm`, `formToParams` (builds `host_tools`, `multi_agent`, `metadata.connectors`; omits empty fields), `connectorNote(slugs)`.

## Components and files

`app/(app)/agents/{page,new/page,[id]/page}.tsx`, `src/ui/agents/{AgentsPage,AgentForm}.tsx`, an agent menu in `Composer`/`NewChat`, an agent field in the schedule form, a sidebar item in `Shell`. Astryx components and tokens only, in the new blue theme.

## Error handling

List and form fetch failures show a retry banner; a 404 on an agent shows "This agent no longer exists" with a link back; a save conflict or 400 shows the server's message; deleting an agent used by a schedule is allowed by the backend, so the page warns only that existing chats keep working.

## Testing

Light, per the user: unit tests for `formToParams`/`agentToForm`/`connectorNote` and for the starter-to-tool-mask mapping (unknown names dropped), one component test that the form saves the expected body, `pnpm typecheck`. No new e2e.

## Out of scope

Import from ECC or URLs, subagent deployment as a named agent, the agent-authoring tools and skill (needs an Agentry MCP facade), hard per-agent app enforcement, sharing agents between users, versioning.

## Later: external subagent providers and skills

Recorded so the later pieces start from facts (read from `~/code/deepseek-harness/packages/subagent` and `docs/http-api.md`, not run):

- DSH has subagent providers for Codex (`subagent-codex`), Claude Code (`subagent-claude-code`) and ACP (`subagent-acp`). Each runs one unattended task in the parent's workspace and returns only the final answer or a safe failure; built-in spawn/fork children keep durable sessions. They are mounted per Host profile with the subagent service and a delegation tool row per provider. Agentry's `cordis.patch.yml` mounts none today.
- A saved agent can only set `multi_agent.enabled` and `max_concurrent_subagents`; it cannot choose a provider. A "Delegate to" choice in the agent form needs backend support first. Codex and Claude Code use their own native login inside the container, which is a credential and cost decision for deployment.
- Skills are Host-level (workspace `.agents/skills`, `$DSH_HOME/skills`, `~/.agents/skills`, a configured directory, `skill-office`), shared by every agent; the saved agent has no `skills` field. An agent's instructions can name skills to use. Per-agent skill lists need backend support; revisit with the agent-authoring piece.

## Open items to verify during implementation

- That `host_tools.allow` names match `GET /agents/tools` names exactly.
- That an inline `agent.instructions` overlay replaces (not appends to) the saved instructions, as `overlayAgent` suggests.
