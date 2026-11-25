# External coding-agent subagents (Codex, Claude Code, others): plan

Status: 2026-11-26, plan only. Nothing is built. Written so a later session can start from facts. Items marked **verify** were read from code or READMEs, not run.

## Goal

Let an Agentry chat delegate a self-contained task to an external coding agent (Codex, Claude Code; later Hermes or any ACP agent), with the work running **inside the chat's sandbox** when the chat has one, and let the user set this up from Agentry Web (an Agents page area), including each person's credentials for those agents.

## What already exists (facts)

- **DeepSeek Harness (DSH) ships the providers.** `dsh-subagent-codex`, `dsh-subagent-claude-code` and `dsh-subagent-acp` (`~/code/dsh-pinned/packages/subagent/`). Each is a Profile bundle: it registers a provider on `ctx.subagents` and a global tool (`subagent_codex`, `subagent_claude_code`, ...) via a `tool-subagent` Host row. The tool returns a child id at once and sends the final answer to the parent on completion. A run is **one-shot**: one text task in, the final answer (or a safe failure diagnostic) out; reasoning, tool traffic, stderr, usage and workspace diffs stay out of the parent session; no follow-up input, no resume.
- **They run through DSH's `subprocess` service**, in the parent session's workspace (`inject = ['subagents', 'subprocess']`; Claude Code passes its SDK spawn to `ctx.subprocess.spawn`). In a sandbox chat the `subprocess` service is our remote one (`@agentry/api/sandbox-runtime`, see `dsh-agents-api/src/sandbox/remote/`), so the CLI would start **inside the sandbox**, in `/workspace`. In a local chat it starts on the API host. **verify** by running it; not tested.
- **Config per provider instance** (fixed for every run from that instance): `providerName`, `model`, `env` (explicit environment layered over a **credential-scrubbed** parent environment), `permissionMode` (`dontAsk` default; `acceptEdits`, `auto`, `plan`, `bypassPermissions`), `disposeGraceMs`. Native CLI configuration and login remain authoritative when `model` and `env` are omitted.
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
- **Agent form**: a "Can delegate to" section with one checkbox per provider; disabled with the reason when it is not ready. Saving writes `host_tools` (or `delegate_to`).
- **In chat**: a delegation already renders as a subagent card (`SubagentCard`); an external task shows its identity and the final answer only (DSH does not stream the child's work). Say so in the card ("Codex ran this task and returned its answer").
- BFF allow-list entries for the catalog and key routes; keys only on POST/DELETE with CSRF.

### 5. MCP (secondary)

People who want Claude Code on their own machine to use Agentry sandboxes use `/mcp` with an owner-bound key. Nothing to build here beyond the docs that exist.

## Phases

0. **Spike (do first, small):** create a template with the Claude Code CLI installed; start a chat on it; temporarily mount `dsh-subagent-claude-code` in the dev profile with a dev key in `env`; delegate a one-line task. Answers: does the SDK's spawn work through our envd transport, where does the child run, what does `permissionMode` do, how long a run takes, what a failure looks like. Record the result in this file.
1. **Backend:** mount providers; confirm `host_tools` can gate them; add the catalog endpoint; sealed per-owner key storage and injection; per-owner limits.
2. **Template and image:** the "Coding agents" template; the sandbox's Providers/Templates UI already lists templates.
3. **Web:** the "Coding agents" tab, the "Can delegate to" section, the chat card wording. Component and unit tests; one live check.
4. **Later:** Hermes or other ACP agents through `subagent-acp` (needs the ACP server command and its auth), Codex ChatGPT-login flow, per-delegation cost display, admin view of who delegated what.

## Acceptance (phase 1 to 3)

- A user connects a Claude Code key on the Coding agents tab, enables delegation on an agent, starts a chat on a sandbox that has the CLI, asks for a delegated task, and gets the child's final answer in the chat.
- The key is never in browser storage, responses, agent records, session config, logs or the item log; disconnect removes it.
- A local-environment chat cannot delegate in a multi-user deployment.
- Removing the key makes the next delegation fail with a message that says to connect one.

## Risks and open questions

- Whether the CLI's SDK works over our envd-backed subprocess (spike).
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
