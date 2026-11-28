# External coding-agent subagents (Codex, Claude Code, others): plan

Status: 2026-11-26, plan only. Nothing is built. Written so a later session can start from facts. Items marked **verify** were read from code or READMEs, not run.

## Goal

Let an Agentry chat delegate a self-contained task to an external coding agent (Codex, Claude Code; later Hermes or any ACP agent), with the work running **inside the chat's sandbox** when the chat has one, and let the user set this up from Agentry Web (an Agents page area), including each person's credentials for those agents.

## What already exists (facts)

- **DeepSeek Harness (DSH) ships the providers.** `dsh-subagent-codex`, `dsh-subagent-claude-code` and `dsh-subagent-acp` (`~/code/dsh-pinned/packages/subagent/`). Each is a Profile bundle: it registers a provider on `ctx.subagents` and a global tool (`subagent_codex`, `subagent_claude_code`, ...) via a `tool-subagent` Host row. The tool returns a child id at once and sends the final answer to the parent on completion. A run is **one-shot**: one text task in, the final answer (or a safe failure diagnostic) out; reasoning, tool traffic, stderr, usage and workspace diffs stay out of the parent session; no follow-up input, no resume.
- **They run through DSH's `subprocess` service**, in the parent session's workspace (`inject = ['subagents', 'subprocess']`; Claude Code passes its SDK spawn to `ctx.subprocess.spawn`). In a sandbox chat the `subprocess` service is our remote one (`@agentry/api/sandbox-runtime`, see `dsh-agents-api/src/sandbox/remote/`), so the CLI would start **inside the sandbox**, in `/workspace`. In a local chat it starts on the API host. **verify** by running it; not tested.
- **Config per provider instance** (fixed for every run from that instance): `providerName`, `model`, `env` (explicit environment layered over a **credential-scrubbed** parent environment), `permissionMode` (`dontAsk` default; `acceptEdits`, `auto`, `plan`, `bypassPermissions`), `disposeGraceMs`. Native CLI configuration and login remain authoritative when `model` and `env` are omitted.
- **The dev profile already links the Claude Code provider.** `~/.dsh/profiles/agents/package.json` lists `@deepseek-ai/dsh-subagent-claude-code` (a `link:` to the pinned DSH checkout), but the profile does not mount it (`cordis.patch.yml` has no subagent rows), so it does nothing yet. A spike can start by adding the two rows from the provider's README.
- **Agentry mounts none today.** `dsh-agents-api/cordis.patch.yml` has no subagent rows. A saved agent has `multi_agent` (`enabled`, max count) and `host_tools` (allow/deny by tool name) but no provider field. The earlier spec (`2026-11-10-agents-page-design.md`, "Later: external subagent providers") recorded the same.
- **Hermes** has no DSH package. **verify** whether Hermes speaks ACP (then `subagent-acp` covers it) or needs its own provider.
- **The other direction already works:** any MCP client can use our sandboxes through `agentry-sandbox` `/mcp` with an owner-bound key (`docs/overview.md` in that repo). That lets an outside harness borrow a sandbox as a tool, but its own shell and file tools stay on its host, so it is not isolation. It is not the way to run subagents.

## Design

### 1. Backend: mount providers, choose per agent

- Add the provider bundles to the Agentry profile (`cordis.patch.yml`), one `permissionMode` per instance, chosen for unattended sandbox use (start with `acceptEdits`; `bypassPermissions` only inside a sandbox, never on a local chat).
- Per-agent choice: first check whether `host_tools.allow` / `deny` on the saved agent already hides or shows `subagent_codex` / `subagent_claude_code` (**verify** the names against `GET /v1/agents/tools`). If yes, no schema change is needed: the web app writes the allow list. If not, add `delegate_to: string[]` to the agent resource and apply it as a host-tools restriction.
- Catalog endpoint `GET /v1/agents/subagent-providers`: for each mounted provider, `name`, display name, whether the CLI is present in the owner's default sandbox image, whether the owner has credentials connected (never the secret), and which environments can run it.
- Delegation only in sandbox chats by default. Refuse or hide the tools in local chats once the deployment is multi-user (a local chat's child would use the host's login and filesystem).

### 2. Sandbox: get the CLIs in

- Default option: a template **"Coding agents"** (or a standard-image variant) whose npm packages include the CLIs (`@anthropic-ai/claude-code`, `@openai/codex`). The standard image already has Node 24 and outbound internet. npm installs are global (`sudo npm install -g`); they live in the container disk, so they are rebuilt from the template on Reset.
- The CLI must exist where the child starts: the sandbox the chat runs in. A chat on a plain sandbox without the CLI gets a clear failure, so the catalog should say "install in this sandbox".

### 3. Auth (the hard part)

DSH scrubs credential-shaped variables from the parent environment, and provider `env` is fixed per mounted instance, so a per-person key cannot be a provider config value. Options:

| Option | Who pays / logs in | Fit |
|---|---|---|
| A. Deployment login in the container or host (native `claude login` / `codex login`) | one account for everyone | Dev only; one person's cost and identity for all |
| B. **Per-owner API key, stored sealed in the Agentry API, injected at spawn inside the sandbox (recommended)** | each person's own key | Works for multi-user; key never reaches the browser or agent records |
| C. Per-sandbox interactive login (run `claude login` in the sandbox terminal tab) | each person's subscription login, kept in that sandbox's home | Possible now that the terminal exists, but lost on Reset and awkward to automate |

Recommended path: **B**.
- Store the key sealed in the API's store, the way place secrets are sealed in `agentry-sandbox` (a secret derived key, never returned; show only the last four characters and a connected date). Scoped to the owner.
- Inject it where the owner is known: the sandbox runtime plugin already receives `owner` and `sandboxId`; add an `env` map for spawned processes whose command is the provider's CLI (set only for that spawn, not into the sandbox's persistent environment). Alternative: write a credentials file into `~` through the existing `prepare` hook (used for skills); prefer env because it leaves nothing on disk.
- Security reality to state in the UI: the agent has sudo in the sandbox and can read an injected key while a run is active. Use a key with a spend cap; never reuse a master key.
- Browser rule stays: the web app sends the key once over the BFF (CSRF, same-origin) and never receives it back.
- Cost control: a per-owner delegation counter (and max concurrent children) so a loop cannot spend unbounded; reuse `multi_agent.max_concurrent_subagents`.

### 4. Web: where it goes

- **Agents page gets two tabs: "Agents" and "Coding agents".** "Coding agents" lists the providers from the catalog as rows (name, status: not on this server / not in your sandbox image / needs a key / ready), with **Connect** (paste the API key; shown as `…abcd`), **Test** (runs the CLI's version command in a sandbox), and **Remove**. Use astryx components (table rows, not cards; StatusDot for status).
- **Agent form** (superseded by the 2026-11-27 study: extend the existing Subagents section instead): a "Can delegate to" section with one checkbox per provider; disabled with the reason when it is not ready. Saving writes `host_tools` (or `delegate_to`).
- **In chat**: a delegation already renders as a subagent card (`SubagentCard`); an external task shows its identity and the final answer only (DSH does not stream the child's work). Say so in the card ("Codex ran this task and returned its answer").
- BFF allow-list entries for the catalog and key routes; keys only on POST/DELETE with CSRF.

### 5. MCP (secondary)

People who want Claude Code on their own machine to use Agentry sandboxes use `/mcp` with an owner-bound key. Nothing to build here beyond the docs that exist.

## Phases

0. **Spike (do first, small):** create a template with the Claude Code CLI installed; start a chat on it; temporarily mount `dsh-subagent-claude-code` in the dev profile with a dev key in `env`; delegate a one-line task. Answers: does the SDK's spawn work through our envd transport, where does the child run, what does `permissionMode` do, how long a run takes, what a failure looks like. Record the result in this file.
1. **Backend:** mount providers; confirm `host_tools` can gate them; add the catalog endpoint; sealed per-owner key storage and injection; per-owner limits.
2. **Template and image:** the "Coding agents" template; the sandbox's Providers/Templates UI already lists templates.
3. **Web:** the setup tab, the "Can delegate to" section, the chat card wording. Component and unit tests; one live check.
4. **Later:** Hermes or other ACP agents through `subagent-acp` (needs the ACP server command and its auth), Codex ChatGPT-login flow, per-delegation cost display, admin view of who delegated what.

## Acceptance (phase 1 to 3)

- A user connects a Claude Code key on the Coding agents tab, enables delegation on an agent, starts a chat on a sandbox that has the CLI, asks for a delegated task, and gets the child's final answer in the chat.
- The key is never in browser storage, responses, agent records, session config, logs or the item log; disconnect removes it.
- A local-environment chat cannot delegate in a multi-user deployment.
- Removing the key makes the next delegation fail with a message that says to connect one.

## Risks and open questions

- Whether the CLI's SDK works over our envd-backed subprocess (spike).
- A chat on a sandbox needs an empty `/workspace` folder on the API host (backlog item 10 in `AGENTS.md`); a delegated child runs in the sandbox's `/workspace`.
- `permissionMode` for unattended runs: `dontAsk` denies almost everything; `bypassPermissions` is only reasonable inside the sandbox boundary.
- Anthropic and OpenAI terms for automated use of subscription logins (option C) versus API keys (option B); prefer API keys.
- CLI versions drift (global npm installs inside sandboxes); pin versions in the template.
- Hermes: protocol and auth unknown.
- Long runs: the one-shot tool returns at once and notifies on completion; check how that interacts with a sandbox that idles and stops (`AGENTRY_SANDBOX_IDLE_MINUTES`).

## Pointers

- DSH providers: `~/code/dsh-pinned/packages/subagent/{subagent-codex,subagent-claude-code,subagent-acp,tool-subagent}`.
- Our remote runtime: `~/code/dsh-agents-api/src/sandbox/remote/` (`plugin.ts`, `envd-ssh.ts`), sandbox presets `src/sandbox/presets.ts`, the `prepare` hook in `src/index.ts`.
- Profile patch: `~/code/dsh-agents-api/cordis.patch.yml`.
- Sandbox service and MCP: `~/code/agentry-sandbox/docs/overview.md`.
- Agents page: `docs/superpowers/specs/2026-11-10-agents-page-design.md`; code in `src/ui/agents/`.

## Study 2026-11-27: DSH check, visibility gap, own agents (LangGraph, CrewAI), the web section

Read from code; nothing run. **verify** marks what a spike must confirm.

### DSH today

- `~/code/deepseek-harness` (HEAD `fcc0ad4621`, 2026-11-04) has the same subagent packages as `~/code/dsh-pinned`, so no upgrade is needed for this work. Providers: `spawn` and `fork` (local, continuable children with their own Session), and the external, one-shot ones: `acp` (any agent that speaks the Agent Client Protocol), `dsh-sdk` (a fresh DSH process with its own profile), `codex`, `claude-code`. `tool-subagent` exposes one tool per row, each row bound to one provider (`provider`, `toolName`). `tool-subagent-control` adds `list_agents`, `send_message`, `interrupt_agent`, `wait_agent`; external children are left out of `list_agents` and cannot take follow-ups.
- Agentry mounts `tool-subagent` twice (`subagent` on spawn, `subagent_fork`) plus `tool-subagent-control` (`dsh-agents-api/cordis.patch.yml` around line 176). Linking Codex or Claude Code is two more rows per provider: the provider bundle and a `tool-subagent` row (`provider: codex`, `toolName: subagent_codex`).
- Limits come for free: `maxActiveSubagents` (default 8 per tree, shared by local and external children) and `maxDepth`.
- The provider contract is small (`packages/subagent/subagent/src/types.ts`): `SubagentProvider { name, capabilities, inheritsParentContext, start(request) => Promise<SubagentRun> }`, with `SubagentRun { id, result: Promise<SubagentResult>, dispose() }`. A failed child resolves `result` with `stopReason: 'error'` instead of rejecting. That is all a new provider has to implement (see "Own agents" below).

### Gap found: external children are invisible in Agentry

- The API learns about children from Host Sessions whose header says `origin: subagent` (`src/session-registry.ts`), and rebuilds them from child Session logs (`src/history/session-history.ts`). External runs (codex, claude-code, acp, dsh-sdk) run in another process and leave no Host Session log, so they will most likely **not** appear in `GET /sessions/{id}/subagents`, produce no `agent.session.subagent.*` events, and have no items. **verify** in the spike.
- The web app keys on the tool name `subagent` (`src/ui/trajectory/build-trajectory.ts` `SUBAGENT_TOOL`, `src/ui/trajectory/Inspector.tsx`), so a `subagent_codex` call shows as a plain tool card, followed later by the completion notice as a user-side message.
- Fix (add to phase 1 and 3): the API emits a synthetic subagent resource for external runs, built from the delegation tool call and its completion: `provider` (`codex`, `claude-code`, `acp:<name>`), label, prompt, status, final text, timings, and no turns or items. The web adds `provider` to `SubagentView`, matches any delegation tool (by the resource, not the tool name), and the card says that the external agent returned only its final answer.

### Own agents (LangGraph, CrewAI): possible, three routes

1. **ACP wrapper in the sandbox (smallest; no DSH change).** Wrap the graph or crew in a short Python ACP server: receive the prompt, run `graph.invoke(...)` or `crew.kickoff(...)`, stream or return the final text. Install it and the agent project in a sandbox template, then mount `subagent-acp` with `command: python`, `args: ['/opt/agents/<name>/acp_server.py']`. It runs inside the chat's sandbox through our remote `subprocess` like Codex. **verify** that a Python ACP SDK exists and is usable (the Zed ACP project publishes SDKs; check the Python one and its version), and that `subagent-acp` spawns through `ctx.subprocess` the way the Claude Code provider does.
2. **Remote HTTP provider (for agents that already run as a service).** Our own provider package in `dsh-agents-api` (for example `src/subagent-http.ts`) implementing `start()`: POST the task to a deployed LangGraph server (its runs API, waiting for the result; **verify** the endpoint names against the current LangGraph server docs) or a CrewAI deployment's kickoff and status endpoints (**verify**). `result` resolves with the final text; `dispose()` cancels the run. The agent runs outside the sandbox, so it fits hosted team agents, not workspace edits. Credentials: per-owner sealed keys, as in option B above.
3. **A2A (later).** The same provider shape with Agent2Agent protocol calls would cover any A2A agent; only worth it if a target agent speaks A2A.

**Main blocker for "users deploy their own agent":** DSH providers and tool rows are fixed when the profile loads, one config per mounted instance, and `subagent-acp` supports no per-request options. Per-user agents therefore need **one Agentry provider of our own** (`agentry-external`) that looks up the saved "external agent" record (kind `acp-command` or `http`, command or URL, owner) at `start()` time and dispatches to the ACP or HTTP path. The model-facing tool takes the agent's name (`subagent_external { agent, task }`). This also solves the per-owner key injection in one place.

Phasing: after the Codex and Claude Code spike, build route 1 with one sample LangGraph agent in a template, then the `agentry-external` provider plus a CRUD for external agents, then route 2.

### Web: one "Subagents" section

The agent editor already has a **Subagents** section (`src/ui/agents/AgentForm.tsx`, `section === 'subagents'`): the switch "Let this agent delegate to subagents" plus "Most at once" (`form.subagents`, `form.maxSubagents`, saved as `multi_agent`), and the agent card on `/agents` shows a "Subagents" fact. Extend that section; do not add a second place for per-agent choices.

- **Agent editor, Subagents section** (per agent): keep the switch and "Most at once"; under them add "Can delegate to", one checkbox per helper:
  - *Built in*: Helper (spawn) and Fork, on by default.
  - *Coding agents*: Codex, Claude Code.
  - *Your agents*: external agents (LangGraph, CrewAI, any ACP command or HTTP endpoint).
  Not-ready rows are disabled with the reason ("Connect a key", "Not in this sandbox's template"). Saving writes `host_tools` (or `delegate_to`). The card's "Subagents" fact can list the chosen ones.
- **Account-level setup, once per person** (keys and registered agents are not per agent): the Agents page gets a second tab, "Agents" | "Subagents". It lists Codex and Claude Code (status, Connect/Test/Remove) and "Your agents" (Add agent: name, kind, command or URL, template, key). The editor's disabled rows link to it. If a second tab on `/agents` is too much, put this under Settings next to Connectors instead (decide in the spec).
- **Chat**: the external-run card from the gap fix above; the trajectory gets the external run as a `subagent` lane span with no inner records.
- **Astryx components** (from `pnpm exec astryx search`; read props with `pnpm exec astryx component <Name>` before use): `TabList`/`Tab` for the "Agents" | "Subagents" page tabs, `Table`/`TableRow` for the setup rows (rows, not cards), `StatusDot` (block `StatusDotPulsing` for running), `CheckboxList` (block `CheckboxListItemShowcase` with descriptions and disabled rows) for "Can delegate to", `EmptyState` (block `EmptyStateContainer` for the first-time "Your agents" setup), `Toast` (`useToast`) for Test results, `Avatar` for provider icons, and `ChatToolCalls` as a reference for the run card. Do not use the DSH packages' `icon.svg` for Claude Code (no Anthropic mark per Global Constraints); use generic icons.
