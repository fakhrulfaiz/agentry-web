# F4: trace inspector, subagent and team views (design)

Status: 2026-11-26, draft for review. Not implemented. Plan: `docs/superpowers/plans/2026-11-26-f4-trace-inspector.md`.

## Goal

Port the DeepSeek Harness (DSH) web features that help a user see **what the agent did**, per `dsh-agents-api/AGENTS.md` decision 10: every feature reads only through Agentry API endpoints, through the BFF, never through DSH's internal remote layer.

Four parts, each shippable alone:

1. **Keyboard access for the trajectory overview** (owed since F1.1).
2. **Session log view**: the raw Session log of a chat, grouped by turn and step, with filters and a detail pane.
3. **Subagent views**: a list of a chat's subagents in the header, and a subagent's conversation in the right panel.
4. **Team view**: the roster and shared task board of DSH's experimental Agent Teams. Only if the team packages are mounted (see Open questions).

Not in F4: the per-turn **model request** (system prompt, tools, full context). That is admin-only by decision 8 and belongs to F2 (admin).

## What exists today (facts)

Web (`agentry-web`):

- `src/ui/trajectory/`: `TrajectoryView.tsx` (toolbar, overview, ledger, inspector in the side panel), `Overview.tsx` (lanes Turns, Assistant, Tools, Subagents; drag to focus an interval, wheel to zoom, right-click to reset; **mouse only**: the area is a `role="group"`, spans are not focusable), `Ledger.tsx`, `Inspector.tsx`, `build-trajectory.ts` (`TrajectoryRecord`, `timelineSpans`, `recordsInInterval`).
- `Conversation.tsx` switches views Chat | Trajectory (`type View = 'chat' | 'trajectory'`).
- Subagents: `src/chat/use-conversation.ts` reads `GET .../subagents`, each child's turns and items, and keeps them in `state.subagents` (`SubagentActivity`). `SubagentCard.tsx` shows a child inline under its delegating call. `build-trajectory.ts` has `SubagentRun { subagent, turns, items? }`.
- The right panel (`src/ui/preview/PreviewPanel.tsx`, store `src/preview/store.ts`) holds file, Files, Start and terminal tabs.

API (`dsh-agents-api`):

- Items, turns and replay frames are folded from the Session log (`src/history/session-history.ts`, `projector.ts`) through `sessionQuery.readSession(sessionId)`, which returns `{ session, events }`. Items carry `timing`, `step` and `usage` (`src/history/item-timer.ts`).
- Subagent routes: `GET /agents/sessions/{id}/subagents`, `/{sid}`, `/{sid}/turns`, `/{sid}/turns/{tid}`, `/{sid}/items`. `OAISubagent` = `{ id, session_id, parent_session_id, status, created_at, closed_at? }`. Known gap: subagent turns and items are memory-only (lost on restart).
- Output redaction for MCP secrets: `src/redact.ts`.
- No route returns raw Session events today.

DSH (`~/code/dsh-pinned`, read only, behaviour reference):

- `packages/client/ui-trajectory`: ledger plus overview; the inspector has token usage, duration, Input, Output, Timing.
- `packages/experimental/session-inspector`: "Raw log" table, rows grouped `turn/start`…`turn/end` with nested `step/start`…`step/end`; assistant stream chunks grouped under their block; a type filter; a details pane; follow references between nodes, turns and steps.
- `packages/client/ui-subagent`: a descendant-count trigger in the session header opens a tree of child conversations (status dot, title, tokens, duration); a child opens read-only in a sidebar tab.
- `packages/experimental/agent-team` + `tool-agent-team` + `client-ui-agent-team`: a Lead with named teammates, inbox messages, a shared task board (owner, blockers, ready state, write scopes). The client reads the Lead session's `agentTeam` projection. **Not mounted** in the Agentry profile (`dsh-agents-api/cordis.patch.yml` has no team rows).
- Session event types seen in the pinned packages: `turn/start`, `turn/end`, `step/start`, `step/end`, `user/message`, `assistant/attempt`, `assistant/message`, `tool/call`, `tool/result`, `tool/code-dispatch`, `command/run`, `command/done`, `compaction/*`, `image/offload`, `llm/retry-started`, `working-directory/change`, `deliverables/presented`, `workspace/changes`.

## Part 1: keyboard access for the overview

The overview becomes one focusable widget: `tabIndex=0`, `role="listbox"` with `aria-activedescendant`, each span a `role="option"`. (Not `role="application"`.) Keys:

| Key | Action |
|---|---|
| Left / Right | Previous / next span in time order (all lanes) |
| Up / Down | Same time, lane above / below (nearest span by start) |
| Home / End | First / last span |
| Enter or Space | Select the span's record (opens the inspector, same as a click in the ledger) |
| Shift + Left / Right | Grow the focused interval to include the previous / next span |
| `+` / `-` | Zoom in / out around the active span |
| `0` | Reset zoom |
| Escape | Clear the focused interval, then the zoom |

- The active span gets a visible focus ring (accent token) and scrolls into the zoomed domain if outside it.
- A live region announces the active span: "Tool bash, 1.3 s, completed".
- Pure logic in `src/ui/trajectory/overview-keys.ts`: `nextSpan(spans, activeId, key)` and `growInterval(...)`, unit tested.
- Mouse behaviour is unchanged.

## Part 2: session log view

### API

`GET /v1/agents/sessions/{id}/log`

- Query: `after` (seq, default 0), `limit` (1 to 500, default 200), `types` (comma list of type prefixes, for example `tool/,turn/`).
- Answer: `{ object: 'list', data: LogEvent[], has_more, last_seq }`. `LogEvent` = `{ seq, type, time (epoch ms), turn_id?, step?, data, truncated? }`.
  - `turn_id` is `turn_<seq of the enclosing turn/start>`, the same id the turns route uses, so the web can link both ways.
  - In `data`, any string longer than 4,000 characters is cut, with `truncated: true` on the event.
- `GET /v1/agents/sessions/{id}/log/{seq}` gives one event in full (cap 1 MB; larger strings are still cut and say so).
- Subagents: `GET /v1/agents/sessions/{id}/subagents/{sid}/log` and `/log/{seq}`, reading the child's Session log. **Verify** that `readSession(childSessionId)` works for children (live and after restart).
- Redaction before output: `src/redact.ts` helpers for MCP config, plus a key mask: values of keys named `authorization`, `api_key`, `apiKey`, `token`, `secret`, `password`, `x-consumer-api-key` (any case) become `***`, at any depth.
- Access: owner-scoped like every session route. Gated by API config `sessionLog.enabled` (default true). When off, the routes answer 404 `not_found`. See Open questions on who should see it.
- Reads go through `sessionQuery.readSession`; no cache (the same as items today). A chat with a very long log pays one full read per page; measure on the largest dev session before adding a cache.
- OpenAPI entries, drift test, CHANGELOG, `docs/changes/2026-11-26-session-log.md`.

### Web

- A third view **Log** in the Chat | Trajectory switch (`View = 'chat' | 'trajectory' | 'log'`). Shown when the first page loads (404 hides it).
- `src/ui/log/LogView.tsx`: a table (astryx `Table`) with columns Seq, Time, Type, Summary. Rows grouped by turn (header row "Turn 3 · completed · 12.4 s"), then by step, both foldable. Assistant chunk events (if any) fold under their message.
- Toolbar: type filter (astryx `MultiSelector` over the types present), text search over summaries, Fold all / Unfold all, Follow tail (on while the session runs).
- Detail pane (the existing side panel): the event's JSON with the existing `src/ui/trajectory/JsonView.tsx`; a "Load full event" button when `truncated`; links: "Show in trajectory" (by `turn_id` + step) and "Show in chat".
- Paging: the first load reads from 0 with `limit=500`, then "Load more" until `has_more` is false. While the session runs, poll `after=last_seq` every 2 s (only while the Log view is shown). No new SSE.
- From the trajectory inspector: "Show in log" opens the Log view scrolled to that record's turn and step.
- `src/ui/log/group-log.ts` (pure): `groupLog(events) → LogGroup[]` and `summarize(event) → string` (for example `tool/call bash: ls -la`, `assistant/message 320 tokens`). Unit tested with fixtures recorded from the live backend (`tests/fixtures/live/`).

## Part 3: subagent views

All data is already in the web's conversation state; v1 needs **no API change**.

- **Header trigger**: when a chat has subagents, the chat header shows "N subagents" (an astryx `Button` with a count `Badge`). It opens a `Popover` with one row per child, nested by parent: status (spinner while running, success or failed icon), description (the delegating call's description, as `SubagentCard` shows), duration, tokens (sum of the child's item `usage`). Keyboard: arrows move, Enter opens.
- **Subagent tab in the right panel**: tab key `agent:<sid>`, title = description. It renders the child's items read-only with the same `Message` components (the expanded `SubagentCard` body, extracted into `SubagentTranscript.tsx`), plus a small Chat | Trajectory switch reusing `TrajectoryView` on `buildTrajectory(child turns, child items)`, and "Show in parent" (scrolls the parent chat to the delegating call).
- Store: `PanelState.agents: { key, subagentId, title }[]`; `active` may be `agent:<key>`; reducers `openSubagent`, `closeSubagent`.
- `SubagentCard` gains "Open in panel".
- Not in v1: sending follow-up input to a subagent (no API route), stopping a single subagent (no API route). Both need API work and are listed in Open questions.
- Note: subagent history is memory-only in the API today. After an API restart the list is empty; the header shows nothing rather than an error.

## Part 4: team view (conditional)

Only after the team packages are mounted and an API route exists. Design kept short until then.

- API: mount `@deepseek-ai/dsh-experimental-agent-team` and `@deepseek-ai/dsh-experimental-tool-agent-team` in `cordis.patch.yml` (durable session storage is already on), then `GET /v1/agents/sessions/{id}/team` → `{ lead_session_id, members: [{ name, session_id, phase, model? }], tasks: [{ id, title, description, owner?, status, blocked_by[], scopes[] }] }`, read from the Team service, owner-scoped. 404 when the chat has no team.
- Web: a "Team" header button (beside Subagents) opening a panel tab `team`: roster rows (name, phase, Current chat tag) and a task board grouped by status (pending ready, pending blocked, in progress, done), read-only. A member opens like a subagent tab (`agent:` with its session id).
- Refresh: on turn end and while the tab is open, every 5 s while the chat runs.
- Per-agent switch "Can use a team" on the Agents page, writing the existing `host_tools` allow list (verify the team tools' names with `GET /v1/agents/tools`).

## Order and size

| Part | API | Web | Notes |
|---|---|---|---|
| 1 Keyboard | none | small | do first |
| 3 Subagents | none | medium | |
| 2 Log | medium (2 to 4 routes) | medium | verify child logs |
| 4 Team | medium plus mounting an experimental package | medium | decision needed |

## Testing

- Web: unit tests for `overview-keys.ts`, `group-log.ts`, store reducers; component tests for overview keyboard (focus, Enter selects, Escape clears), Log view (groups, filter, load full event), subagent popover and tab.
- API: unit tests for the log mapper (turn ids, truncation, redaction keys), gateway tests for owner scoping, `limit`/`after`/`types`, 404 when disabled; OpenAPI drift and contract.

## Out of scope

Model request view (F2 admin), editing or replaying events, exporting a log file, live chunk streaming in the log (the log shows saved events only), plan/todo/goal panels and jobs (separate ports under decision 10).

## Open questions

1. **Who sees the raw log?** It shows tool arguments and outputs in full and some config. Options: (a) every owner for their own chats (the design, with redaction); (b) only when a "Developer tools" setting is on; (c) admins only. Single user today, so (a) is simplest.
2. **Agent Teams:** adopt DSH's experimental team packages now (Part 4), or wait until they leave `experimental`?
3. **Subagent follow-up and stop:** wanted? Both need new API routes (`POST .../subagents/{sid}/events`, `POST .../subagents/{sid}/cancel`) over DSH's `subagents/interruptByParent` and the child inbox.
4. **Subagent history after restart:** worth fixing in the API now (fold child Session logs like the parent), since Part 3 depends on it for older chats?
5. **Log view placement:** a third view beside Chat and Trajectory (the design), or a tab inside the Trajectory view?
