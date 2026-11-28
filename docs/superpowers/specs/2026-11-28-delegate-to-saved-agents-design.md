# Delegate to saved agents — design

Status: proposed (awaiting approval). Date: 2026-11-28.

## Intent

Make Agentry usable as an **orchestrator**, not only a single do-it-all agent. A restricted coordinator should be able to hand a task to a named saved agent that runs with its own instructions, tools, apps and model — including tools the coordinator does not have. The delegation allow-list is the boundary of what each agent can reach; the child's own grants are authoritative. Work arrives in chat as the existing subagent card, so nothing new is invented for reading the result.

## Goals

- A saved agent (Yours, imported, or Library) can be delegated to by name and runs with its **own** config.
- Per-agent **Can delegate to**: Any / Choose / Off. New agents and the built-in `agentry` default to Any.
- The model sees each allowed target's **name + one-line description**; past ~20 targets it gets a search step first.
- Delegation depth is **one**: a delegated helper cannot delegate again, whatever its own setting says.
- Every saved agent has a real one-line description, used by the catalog and shown on the Agents page.

## Non-goals

- External coding agents (Codex, Claude Code, ACP) and external-service agents — that is the separate P3 plan.
- Chained/multi-hop orchestration. The depth setting stays configurable in the data model but ships at 1.
- A new card, transcript or protocol for delegated runs — reuse DSH subagents.
- Changing the parent's tool restrictions or grants; delegation does not widen the parent.

## Anti-goals

- A coordinator silently reaching tools through several agents it never named.
- Opaque preset ids in the model's tool description instead of human names.
- Credentials, connector keys, or preset internals reaching browser code.

## Constraints

- Global constraints from AGENTS.md apply: credentials stay server-side, proxy allow-list, astryx components and tokens, no Anthropic marks, exact astryx/StyleX versions.
- No schema migration: agents are stored as `body jsonb`; new fields live in that payload.
- Pinned DSH is not patched. DSH facts established by the spike: `startActivation` accepts `agentPreset`, `agentOptions` (model override) and `maxDepth`; `spawn` has all four capabilities; `agentPresets.mount(childCtx, id)` binds an independent preset; children carry `origin: subagent`, `delegationDepth` and are rebuilt from child Session logs after a restart.
- DSH stamps delegated children with a scope note saying approval-requiring operations are rejected. Any `send_policy: ask` limits of a delegated agent must be documented as such, not presented as working approvals.

## Approaches considered

- **A. Saved agent → DSH agent preset + a delegation tool (chosen).** Register a preset per allowed agent and call `startActivation` with `agentPreset`. Reuses child events, `/subagents`, restart rebuild, approval routing and the existing web card. Cost: a plugin that mounts the saved agent's config into the child scope, and preset lifecycle management.
- **B. Separate Agentry session + synthetic subagent resource.** Best config fidelity but requires rebuilding child tracking, events, restart visibility, approval routing and image serving by hand, plus a new web card variant. Rejected as duplicate plumbing.
- **C. DSH `allowedAgentPresets` on the stock `subagent` tool.** Smallest change but exposes opaque ids, offers no search past 20, and cannot express per-agent Any/Choose/Off at session mount. Rejected as not meeting the request.

Spike verification for A (code-level, DSH test doubles, no live stack): an independent child preset can carry a plugin row from `@agentry/api/*` (the sandbox runtime already does this), the tool can pass a model override and `maxDepth: 1`, and the child appears through the existing subagent pipeline. Open details are listed under "Left to the builder" rather than treated as blockers.

## Design

### Description on every agent

- Add `description: string` to `OAIAgent` and `CreateAgentParams` in both repos; stored in the agent row's JSON body. Import front matter and Library items map to it; built-in agents get one written in their definitions.
- Saving a new or edited agent requires a non-empty one-line description, including agents created or edited through the API's `agent_create` / `agent_update` tools (their schemas gain a `description` argument) and import drafts (front matter supplies it; a draft missing it asks the user). Legacy agents with none read as `metadata.description`, else the first non-empty instruction line; they keep that derived value until edited. The editor exposes it on the Profile tab (next to name), not in the Subagents section.
- Agents page cards, the delegation picker and the model-facing catalog show this description rather than deriving it from instructions each time.

### Per-agent delegation setting

- Stored as a top-level agent field, e.g. `delegation: { mode: 'any' | 'choose' | 'off', agent_ids: string[] }`; ids, not names, so renames do not break the list. Default `{ mode: 'any', agent_ids: [] }` for new agents and built-ins.
- Web: extend the existing **Subagents** tab, matching the approved mockup — keep "Let this agent delegate to subagents" and "Most at once", then add **Can delegate to** with Any / Choose / Off toggle buttons. Choose shows a searchable list of the owner's agents + Library entries, each row with name, provenance (Yours/Library) and description. Off removes the tool from the agent entirely.
- Only **saved** agents are delegate targets. Library rows are labelled with their provenance, but an unsaved Library entry must be added to the owner's agents first; built-in Library definitions carry descriptions for display and import, but are not directly delegable until added. The built-in `agentry` is the one exception: it is always available as a delegate when delegation is enabled and never has to be added to Choose.
- The tool is mounted only when the switch is on and the mode is not Off. `host_tools.deny` still applies to it like other session-scoped tools. Built-in `agentry`'s `host_tools.allow` mask must include the new session-scoped tool (or leave it outside that mask) so `agentry` can delegate when enabled.
- Self-delegation is excluded when the target catalog is resolved.

### Catalog and the search step

- At session setup, resolve allowed targets: the owner's saved agents plus built-in `agentry` (when delegation is enabled). Skip the target if it is the session's own agent. Unsaved Library entries are not resolved; they are shown in the picker with provenance so the user knows to add them first.
- Names are qualified by source: `Name (Yours)`, `Name (Library: <source>)`, `Agentry (Built in)`; if a duplicate remains inside one source, append a short id suffix. The model passes the exact qualified label to `delegate_to_agent`; a bare or ambiguous name is rejected and the error lists the allowed qualified labels. This avoids silently routing to the wrong grant set.
- Up to ~20 targets: include each as `Qualified name — description` in the `delegate_to_agent` tool description. Above the threshold, expose `find_agent { query }` returning the best matching qualified names + descriptions; the model calls it, then calls `delegate_to_agent` with the chosen label. The threshold is one named constant.
- An unknown or disallowed name returns a tool error listing the allowed labels; it never reveals other owners' agents.

### Preset and tool (API)

- `delegate_to_agent { agent, task }` resolves the qualified label to a saved-agent id (or the built-in `agentry` id), leases a DSH preset keyed by `(owner, agentId, sandboxId?)`, and calls `ctx.subagents.startActivation({ provider: 'spawn', label: target.name, agentPreset: presetId, agentOptions: { model: target.model } when set, maxDepth: 1, delivery: 'parent' })`.
- The preset contains a plugin row mounted from `@agentry/api/*` whose config carries `owner`, `agentId` and the inherited sandbox identity. At child activation it fetches the agent and mounts its **full session setup** — instructions, tools, apps and their grants, MCP tools, skills and guidance, plus the ordinary Agentry tools a normal session gets — with two exclusions: the delegation tool is never mounted, and parent-session-bound state (pending function calls, parent session id, browser state tied to that session) is not carried over. The target's own config and grants are authoritative. Factor the shared setup out of `buildAgentSetup` into a new module rather than duplicating it.
- Presets are reference-counted with a grace period, like sandbox presets, and unregistered promptly when the target agent is updated or deleted. Live children keep their existing composition until they end.
- Sandbox chats: the child inherits the parent's sandbox/workspace and does **not** create a new sandbox or take a second lease; the target agent's own environment setting is ignored. Compose the target's plugin row into the sandbox preset rows **inside the same `cordis:group`** so the child's tools still run in the sandbox; the `sandboxId` in the preset key keeps local and sandbox compositions distinct. A delegated preset never mounts the delegation tool, so helpers cannot delegate further; `maxDepth: 1` is a second, independent guard.
- The existing `agent.session.subagent.*` events, `/subagents`, turns/items and tool images are unchanged. The card label is the target agent's name; its prompt comes from the `task` argument, as subagent prompts do today.

### Known limitation to document

DSH tells delegated children that approval-requiring operations are rejected automatically. A delegated agent configured with `send_policy: ask` therefore cannot present an approval card through this path in the first slice. Say so in the change note and in the tool description; do not silently present it as working. The parent's own approvals are unaffected.

### Decisions made during the builder check

These were settled from your P2 wording, the approved mockup, or my own call; please correct any you disagree with when you review the doc:

- Only saved agents are direct targets; Library rows show provenance and must be added first. Built-in Library definitions carry descriptions but are not directly delegable.
- A child gets the target's full session setup minus the delegation tool and parent-session-bound state — not a reduced instruction/tools-only subset.
- Built-in `agentry` is always in the target catalog when delegation is enabled (exempt from Choose/Off), with its `host_tools.allow` mask adjusted to keep the delegation tool visible.
- A delegated child inherits its parent's sandbox/workspace; the target's own environment is ignored, and the preset key includes the sandbox id.
- Duplicate names are qualified by source (plus a short id suffix if still ambiguous); ambiguous bare names are rejected.
- `agent_create` / `agent_update` gain a `description` argument, and an import draft without one asks the user.

### Bookkeeping

- API: change note under `docs/changes/`, `CHANGELOG.md` dated bullet.
- Web: `CHANGELOG.md` dated bullet; mark the P2 item DONE in `AGENTS.md` with the follow-ups (chains, live approval check).
- Tests on both sides: catalog/mode resolution, tool registration/shadowing, preset lease and update/delete eviction, depth refusal, form validation and editor UI.

## Left to the builder

- Exact file names and whether the shared setup function is a new module or an exported helper from `gateway.ts` (prefer a new module to keep the pending gateway split easier).
- Whether `find_agent` lives in the same tool module or beside `mount-agentry-tools.ts`; one tool module is likely enough.
- Test sequencing: tests first for catalog/mode and for preset composition, then the live-card check against a dev stack.
- Confirm with one real chat that a delegated agent with tools the parent lacks actually calls them; the mock-based spike covered composition, not a live run.
