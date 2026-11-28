# Ask Agentry: an assistant that sets Agentry up for you (2026-11-28)

The user describes what they want ("I want to build a recipe app", "remind me every Monday about invoices", "I don't know what to build"); a built-in **Agentry assistant** suggests a plan and, after the user approves, creates the project, picks or creates the environment and agent, and sets up schedules. Like claude.ai's setup helpers. Runs entirely on the Agents API with tools. User asked to start it now (P1).

## Principles

- **Ask, then act.** Every create/change goes through the existing approval card (the tool asks first, like `send_policy: ask`); read-only tools never ask. The assistant first proposes a short plan (what it will create, with names), then calls tools.
- **Owner-scoped**, same rules as the HTTP routes; the tools call the same services as the routes (no second implementation).
- **Everything in Agentry gets a tool** so any agent (not only the assistant) can manage Agentry when its tools allow it.

## API (`~/code/dsh-agents-api`): an `agentry` tool group

Mounted per session like `mount-schedule-tools.ts` / `mount-sandbox-tools.ts` (follow their pattern: owner, guards, guidance text). Tools (names final unless they clash with DSH names):
- Projects: `project_list`, `project_create { name, agent_id?, environment?: { environment_id, directory? }, pinned? }`, `project_update { id, … }`, `chat_move_to_project { session_id?, project_id }` (current chat by default).
- Agents: `agent_list`, `agent_create { name, instructions, model?, tools?, apps?, browser?, subagents? }`, `agent_update { id, … }`, `library_search { query }` → built-in + the owner's Library sources (name, description, source, ref), `library_add { ref, name? }` → creates the agent from a Library entry (same draft path as the web, collision naming "Name (Source)").
- Environments: `environment_list` (named environments with state, provider, template), `template_list`; creating/starting sandboxes reuses the existing `sandbox_create` etc. (check they cover named environments with a template; add `environment_create { name, template_id?, provider? }` only if not).
- Schedules: existing `schedule_*` tools (owner-scoped already).
- Built-in Library source of truth moves to the API so `library_search`/`library_add` can read it: move `agentry-web/src/agents/library/*.md` + `NOTICE.md` into the API (e.g. `src/agent-library/builtin/`), serve `GET /v1/agents/library/builtin`, and have the web read built-ins from the API instead of its bundle (delete the web bundle script/files after). Keep the same parse rules and tests.

Approval: creating or changing anything (`*_create`, `*_update`, `library_add`, `chat_move_to_project`, sandbox creation) asks; list/search tools do not.

## The built-in assistant agent

- A built-in agent definition in the API (not a per-user saved agent), id `agentry` (name "Agentry"), returned by `GET /v1/agents` as a built-in (flag `built_in: true`, not editable/deletable; check the agent list shape and how the web shows it) and usable as `agent_id: "agentry"` on session create. Model: the deployment default. Tools: the `agentry` group + schedule tools + read-only file tools + `ask_user_question` + web search (for "what could I build" ideas); no shell, no file writes.
- Instructions (write them well): help the user set up their work in Agentry; if they don't know what to build, ask 2–3 short questions (interests, skills, time) and suggest 3 project ideas; propose a concrete setup (project name, folder, environment from `environment_list`/`template_list` — reuse an existing one when it fits, else suggest a template; agent from `agent_list`/`library_search` or the default); show the plan; then create with the tools (approval cards); finish with links (`/sandboxes/<env>`, the project's "New chat here" `/?project=<id>`, `/scheduled/<id>`) and the next step. Never invent ids; read them from list tools. Keep answers short.

## Web (`~/code/agentry-web`)

- **Ask Agentry** entry: a ✨ icon button (tooltip "Ask Agentry") in the sidebar Workspace header, and "Agentry" as the first choice in the new-chat Agent menu (with a one-line description). Opening it starts a new chat with `agent_id: "agentry"`.
- New-chat page: when Agentry is the selected agent, show 3 starter prompts as small chips under the composer ("Set up a project for …", "I don't know what to build", "Remind me every …").
- Links in the assistant's answers to `/sandboxes/…`, `/?project=…`, `/scheduled/…` open in-app.
- Agents page: the built-in Agentry agent shows in Yours with a "Built in" token, no edit/delete (or hide it there; choose the simpler, consistent option).

## Tests (minimal, per the user)

Owner scoping for each new tool group (one test per area), approval required for mutating tools, `library_add` collision naming, built-in library served by the API (parse test moved), the built-in agent is listed and usable on session create. No large UI suites.

## Live check

Start a chat with Agentry: "I want to build a small recipe website, set it up for me" → it proposes a plan; approve → a project (with a folder in an existing sandbox environment, e.g. Test sandbox), an agent (e.g. from the Library), and a link back. Then "remind me every Monday 9am to plan meals" → schedule created after approval. Screenshot the conversation and the result pages. Then delete everything it created (project, agent, schedule) so the user's data is as before.
