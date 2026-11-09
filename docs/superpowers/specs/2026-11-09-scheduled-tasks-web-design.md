# Scheduled tasks (web) — design

Date: 2026-11-09 · Status: approved · Scope: Agentry Web frontend for scheduled tasks

Backend contract: `~/code/dsh-agents-api/docs/superpowers/specs/2026-11-09-scheduled-tasks-design.md` §3–4. That document owns the API; this one owns what the browser shows and how it is built.

## Intent

Let a signed-in user see and manage their scheduled agent tasks, and create new ones, from the web app. The page mirrors claude.ai's Scheduled page — heading, Yours/Templates tabs, a "New task" menu, an empty state with a clock, and template cards — built entirely from astryx components in the Agentry theme.

The backend routes (`/v1/agents/schedules…`, backend tasks B0–B8) are not implemented yet. The web app is built against the contract now; until the backend lands, the page shows the backend's `schedules_unavailable` (501) message as an error banner with Retry.

## Goals

- `/scheduled` with **Yours** (table of tasks) and **Templates** (static cards) tabs; the empty state shows the templates beneath it.
- Manual create and edit form (frequency, time, date, weekdays, cron, time zone, model) that compiles to the wire `timing` union.
- Detail page with summary, actions, prompt, and delivery history (runs) linking to each run's chat.
- "Create with chat": opens `/` with the composer pre-filled with a time-zone-aware prompt; nothing is auto-sent.
- A sidebar entry above the chat list.
- BFF allow-list and API client methods for the new routes; all strings through the existing client, nothing credential-bearing in the browser.

## Non-goals

- Backend work of any kind.
- Playwright e2e (deferred by the user; unit + component tests only).
- Fresh chat per run, notifications, admin-editable templates, backend search/sort, saved-agent picker (`agent_id` / `environment`) in v1.
- Showing run *outcomes*: receipts only prove inbox delivery.

## Anti-goals

- A page that fails silently or pretends a mutation succeeded when the backend refused it.
- A second CSS system, raw hex/px, or raw layout `<div>`s.
- Sending a time zone the user did not see, or guessing one server-side.

## Constraints

- Global constraints from `AGENTS.md`: astryx 0.7.11 / StyleX 0.19.1 exact versions, astryx components + tokens only, no credentials in the browser, BFF allow-list only, `ConfigError` startup rules untouched.
- Wire vocabulary is DSH's `timing` tagged union, passed through unchanged (backend decision 5). The browser always sends the IANA time zone it shows (backend decision 6).
- Optimistic concurrency: edits send `revision` (the record's `updated_at`); 409 `schedule_conflict` is shown, never retried blindly.
- Tests: `pnpm typecheck`, `pnpm test` (Vitest; unit in `tests/unit`, component in `tests/component` with jsdom). No e2e.
- `CHANGELOG.md` gains a dated bullet in each task that changes what a user sees; commit as `fakhrulfaiz <fakhrulfaiz2003@gmail.com>`, no AI attribution.

## Approaches considered

1. **Spec-literal page**: `TopBar` + a table only, templates behind their own tab (the backend spec's F3 sketch). Cheapest, but the user asked for the claude.ai look, where the empty state also teaches templates.
2. **claude.ai-shaped page with astryx parts** (chosen): `TopBar` with tabs and a New task menu, a dense `Table` when tasks exist, a centred `EmptyState` with the template grid beneath it when they don't, and a full Templates tab. Same components and data flow as (1), one extra empty-state branch.
3. **Wait for the backend** then build against live data. Rejected: the user wants the frontend now; the 501 banner is an honest degraded state.

## What the page looks like

```
Scheduled tasks                         [New task ▾]
[ Yours ] [ Templates ]

         (clock)  No scheduled tasks yet.
                  [ Set up manually ]
──────────────────────────────────────────────
Templates
[Daily briefing]  [Weekly review]
[Monitor a topic] [Content ideas]
```

- **Yours, populated**: `Table` — Name (link to detail), Schedule (`describeTiming`), Next run (`Timestamp`), Status (`Switch` for active/paused, `StatusDot` + "Ended" for ended), `MoreMenu` (Run now, Edit, Delete → `AlertDialog`). A search `TextInput` filters the loaded rows by title (the API has no search parameter).
- **Templates tab**: `ClickableCard` grid; choosing one opens the create form pre-filled.
- **Header**: `DropdownMenu` — "Create with chat" → `/?schedule=1`; "Set up manually" → `/scheduled/new`.
- **Form**: name, prompt, frequency (`SegmentedControl`: Once, Hourly, Daily, Weekdays, Weekly, Custom), time, date (Once), weekdays (Weekly), cron (Custom), time zone (`Typeahead`, defaults to the browser's zone), model (create only, from `GET /api/models`). Inline field errors from backend codes; a 409 shows a "changed elsewhere" banner with Reload (edit).
- **Detail**: summary (`MetadataList`), actions (Pause/Resume, Run now, Edit, Delete), prompt, Runs table (delivered at, link to `/c/{session_id}`), "Load more" from `next_before`, "Open chat".
- **States**: `Skeleton` while loading; `Banner` + Retry on failure (including 501 `schedules_unavailable`); 401 → `/login`; empty state as sketched.

## Data flow

```
server page (requirePageSession)
  └─ client page component
       └─ src/api/client.ts  →  /api/agentry/agents/schedules…  →  BFF allow-list  →  Agentry
```

- One source of truth for the wire shapes: `src/api/types.ts` (`AgentSchedule`, `AgentScheduleRun`, `ScheduleTiming`).
- Pure helpers in `src/schedule/` (`describe`, `form`, `templates`, `seed`) so timing math and copy are testable without React.
- The list refetches on mount, on the `agentry:sessions-changed` window event (a chat-created task), and after each mutation. Detail refetches after mutations.
- Mutations are optimistic only where a revert is cheap (pause/resume switch; row delete); create/update/run await the backend and then refresh.

## Files

| Path | Responsibility |
|---|---|
| `src/server/allowlist.ts` | allow `schedules` routes; `schedules` is a reserved agent id |
| `src/api/types.ts` | `ScheduleTiming`, `AgentSchedule`, `AgentScheduleRun`, `ScheduleRunList`, request bodies |
| `src/api/client.ts` | `listSchedules` … `listScheduleRuns` on `api` |
| `src/schedule/describe.ts` | `describeTiming(timing, locale?)` |
| `src/schedule/form.ts` | `ScheduleFormValues`, `formToTiming`, `timingToForm`, `browserTimeZone`, `ScheduleFormError` |
| `src/schedule/templates.ts` | `TEMPLATES`, `templateValues` |
| `src/schedule/seed.ts` | `buildScheduleSeed(timeZone)` |
| `src/ui/scheduled/ScheduledPage.tsx` | list shell: tabs, search, table/cards, actions |
| `src/ui/scheduled/ScheduleForm.tsx` | create/edit form |
| `src/ui/scheduled/ScheduleDetail.tsx` | detail and runs |
| `src/ui/scheduled/ScheduleDialogs.tsx` | shared delete confirmation |
| `app/(app)/scheduled/{page,new/page,[id]/page,[id]/edit/page}.tsx` | server pages |
| `src/ui/shell/Sidebar.tsx` | Scheduled entry |
| `src/ui/chat/{Composer,NewChat}.tsx`, `app/(app)/page.tsx` | composer seed |

## Left to the builder

Component props (run `pnpm exec astryx component <Name>`), exact spacing, copy beyond the strings pinned in the plan, and the internal shape of each component. Everything a reviewer could reject is in the plan.
