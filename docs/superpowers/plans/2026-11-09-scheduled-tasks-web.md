# Scheduled tasks (web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Agentry Web Scheduled page — list, templates, manual create/edit, detail with delivery history, create-with-chat seed — against the backend contract in the design doc.

**Architecture:** One BFF-proxied API client for `/v1/agents/schedules…`, pure helpers for timing math and copy, and client components under `src/ui/scheduled/` mounted by thin server pages that call `requirePageSession()`. The page mirrors claude.ai's Scheduled page with astryx primitives.

**Tech Stack:** Next.js 16 App Router, React 19, astryx 0.7.11, StyleX 0.19.1, Vitest (+ jsdom component tests), TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-11-09-scheduled-tasks-web-design.md` (API contract: `~/code/dsh-agents-api/docs/superpowers/specs/2026-11-09-scheduled-tasks-design.md` §4)

## Global Constraints

- astryx `0.7.11` and StyleX `0.19.1` exact versions (no `^`/`~`); no other CSS framework.
- astryx components first; `xstyle` + StyleX tokens for layout glue. No raw `<div>`/`<span>` for layout, no `className`/`style` props, no raw hex/px.
- Branding stays "Agentry". No Anthropic names, logos or colors.
- The browser never receives an Agentry token; every call goes through `/api/agentry/*` and its allow-list; state-changing calls carry `x-agentry-csrf` (the client does this).
- Wire shapes come from the backend spec §4: `timing` is DSH's tagged union, unchanged; `revision` = `updated_at`; errors map `schedule_not_found` 404, `schedule_conflict`/`schedule_execution_pending` 409, `schedules_unavailable` 501.
- Tests: `pnpm typecheck`, `pnpm test`. **No Playwright e2e** (user's instruction).
- `CHANGELOG.md` gains one dated bullet for the feature in Task 9. Commits are authored as `fakhrulfaiz <fakhrulfaiz2003@gmail.com>`, never with AI attribution.
- Shell prefix: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH`.

## Review Focus

These are the failure modes most likely to reach a user; each has a test in the listed task.

1. A Once date+time that does not exist in the chosen zone (DST spring-forward) or is in the past — the form must refuse it, not silently shift an hour or schedule the past (Task 2).
2. A scheduled record with a timing kind the form cannot edit (`after`, `rrule`, unknown) — opening Edit must not crash or drop the schedule (Tasks 2, 6).
3. A 409 `schedule_conflict` on edit — the page shows "changed elsewhere" and offers reload; it never re-submits over the other change (Task 6).
4. Backend absent (`schedules_unavailable`) or a record deleted elsewhere (404) — the page shows a banner/empty state, never a permanent spinner (Tasks 3, 7).
5. A failed pause/resume/delete/run — the optimistic row state reverts and a toast explains it (Task 4).

---

### Task 1: Allow-list, wire types, API client

**Files:**
- Modify: `src/server/allowlist.ts`
- Modify: `src/api/types.ts`
- Modify: `src/api/client.ts`
- Test: `tests/unit/allowlist.spec.ts`, `tests/unit/api-client.spec.ts`

**Interfaces:**
- Produces (types in `@/api/types`):

```ts
export type ScheduleTiming =
  | { kind: 'after'; after: { after_seconds: number } }
  | { kind: 'at'; at: string }
  | { kind: 'every'; every: { every_seconds: number } }
  | { kind: 'daily'; daily: { time: string; time_zone: string } }
  | { kind: 'weekly'; weekly: { time: string; time_zone: string; weekdays: number[] } }
  | { kind: 'cron'; cron: { expression: string; time_zone: string } }
  | { kind: 'rrule'; rrule: { rrule: string } }
export type ScheduleStatus = 'active' | 'paused' | 'ended'
export interface AgentScheduleRun { scheduled_at: string; delivered_at: string; message_id: string; session_id: string }
export interface AgentSchedule {
  id: string; object: 'agent.schedule'; title: string; prompt: string; timing: ScheduleTiming
  status: ScheduleStatus; next_run_at: string | null; created_at: string; updated_at: string
  revision: string; session_id: string; running: boolean; last_run: AgentScheduleRun | null
  source?: 'api' | 'chat'
}
export interface ScheduleRunList { object: 'list'; data: AgentScheduleRun[]; has_more: boolean; next_before: string | null }
export interface CreateScheduleParams {
  title: string; prompt: string; timing: ScheduleTiming; session_id?: string; agent_id?: string
  agent?: { model?: string; reasoning?: { effort?: ReasoningEffort }; instructions?: string }
}
export interface UpdateScheduleParams { title?: string; prompt?: string; timing?: ScheduleTiming; revision: string }
```

- Produces (`api` on `@/api/client`):

```ts
listSchedules(q?: { status?: ScheduleStatus; after?: string; limit?: number }): Promise<OAIListResponse<AgentSchedule>>
getSchedule(id: string): Promise<AgentSchedule>
createSchedule(input: CreateScheduleParams): Promise<AgentSchedule>
updateSchedule(id: string, patch: UpdateScheduleParams): Promise<AgentSchedule>
deleteSchedule(id: string): Promise<{ id: string; object: 'agent.schedule.deleted'; deleted: true }>
pauseSchedule(id: string): Promise<AgentSchedule>
resumeSchedule(id: string): Promise<AgentSchedule>
runSchedule(id: string): Promise<AgentSchedule>
listScheduleRuns(id: string, q?: { limit?: number; before?: string }): Promise<ScheduleRunList>
```

- [ ] **Step 1: Write the failing allow-list tests**

In `tests/unit/allowlist.spec.ts`, add `SCHEDULE = 'sched_01HZX-abc_9'` and a table `it.each` for: `GET/POST /agents/schedules`, `GET/POST/DELETE /agents/schedules/{id}`, `POST …/{id}/pause`, `POST …/{id}/resume`, `POST …/{id}/run`, `GET …/{id}/runs`. Add rejection assertions for `GET /agents/schedules/{id}/other`, `DELETE /agents/schedules`, `GET /agents/schedules/{id}/pause`, `POST /agents/schedules/{id}/runs`, `/agents/schedules/a%2Fb`, and `GET /agents/schedules/..`. Assert `GET /agents/schedules` is allowed (it is the collection, not an agent id).

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run tests/unit/allowlist.spec.ts`
Expected: FAIL — the schedule paths are not allowed.

- [ ] **Step 3: Implement the allow-list**

Add `'schedules'` to `RESERVED_AGENT_IDS`; add `const SCHEDULE = { id: 'schedule' } as const`; append the six rules from the spec to `RULES` (collection GET/POST; item GET/POST/DELETE; `pause`/`resume`/`run` POST; `runs` GET).

- [ ] **Step 4: Write the failing client tests**

In `tests/unit/api-client.spec.ts` add one `it` that mocks `fetch` and checks, for each call: URL, method, body, `x-agentry-csrf`, no `authorization`. Cover `listSchedules({ status: 'active', limit: 20 })` → `/api/agentry/agents/schedules?status=active&limit=20`; `createSchedule` POSTs `{title,prompt,timing,agent:{model:'m1'}}`; `updateSchedule('s1',{title:'T',revision:'r2'})` POSTs the patch; `deleteSchedule` DELETE; `pauseSchedule`/`resumeSchedule`/`runSchedule` POST to their paths; `listScheduleRuns('s1',{limit:10,before:'b'})` → `…/runs?limit=10&before=b`. Add one case: a 409 `schedule_conflict` response throws `ApiError` with status 409 and that code.

- [ ] **Step 5: Run it and confirm it fails**

Run: `pnpm vitest run tests/unit/api-client.spec.ts`
Expected: FAIL — `api.listSchedules` is not a function.

- [ ] **Step 6: Implement the types and client methods**

Add the types to `src/api/types.ts` (place near `CreateSessionParams`, with a comment that they mirror backend spec §4 until OpenAPI lands). Add the nine methods to the `api` object using `request(...)` and `seg(id)` like the session methods; build query strings with `URLSearchParams` and omit empty values.

- [ ] **Step 7: Run the tests**

Run: `pnpm vitest run tests/unit/allowlist.spec.ts tests/unit/api-client.spec.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server/allowlist.ts src/api/types.ts src/api/client.ts tests/unit/allowlist.spec.ts tests/unit/api-client.spec.ts
git commit -m "feat(api): allow and call the scheduled-tasks routes"
```

---

### Task 2: Timing helpers, templates

**Files:**
- Create: `src/schedule/describe.ts`, `src/schedule/form.ts`, `src/schedule/templates.ts`
- Test: `tests/unit/schedule-describe.spec.ts`, `tests/unit/schedule-form.spec.ts`, `tests/unit/schedule-templates.spec.ts`

**Interfaces:**
- Consumes: `ScheduleTiming` from Task 1.
- Produces:

```ts
// describe.ts
export function describeTiming(timing: ScheduleTiming, locale?: string): string

// form.ts
export type Frequency = 'once' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom'
export const FREQUENCIES: readonly { value: Frequency; label: string }[]
export interface ScheduleFormValues {
  title: string; prompt: string; frequency: Frequency; date: string; time: string
  weekdays: number[]; cron: string; timeZone: string; model: string
}
export const EMPTY_FORM: ScheduleFormValues
export class ScheduleFormError extends Error { constructor(public code: string, message: string) }
export function browserTimeZone(): string
export function formToTiming(values: ScheduleFormValues): ScheduleTiming
export function timingToForm(timing: ScheduleTiming, base: ScheduleFormValues): ScheduleFormValues

// templates.ts
export interface ScheduleTemplate {
  id: 'daily-briefing' | 'weekly-review' | 'monitor-topic' | 'content-ideas'
  title: string; description: string; prompt: string; frequency: Frequency; time: string; weekdays?: number[]
}
export const TEMPLATES: readonly ScheduleTemplate[]
export function templateValues(template: ScheduleTemplate, timeZone: string): ScheduleFormValues
```

- [ ] **Step 1: Write the failing `describeTiming` tests**

Table-driven in `tests/unit/schedule-describe.spec.ts` with `locale='en-US'`: `weekly` Mon–Fri 08:00 → `Weekdays at 8:00 AM`; `weekly` `[5]` 16:00 → `Every Friday at 4:00 PM`; `weekly` `[1,3]` 09:00 → `Mondays and Wednesdays at 9:00 AM`; `daily` 09:00 → `Daily at 9:00 AM`; `every` 3600 → `Every hour`; `every` 900 → `Every 15 minutes`; `at` `2026-11-12T07:00:00.000Z` → `Once on Nov 12, 2026 at 7:00 AM`; `cron` and `rrule` → `Custom schedule`; `after` 60 → `Once, 1 minute from now`.

- [ ] **Step 2: Run it and confirm it fails, then implement `describeTiming`**

Run: `pnpm vitest run tests/unit/schedule-describe.spec.ts` → FAIL (module not found). Implement with a small wall-clock formatter: `new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })` over a UTC date built from `HH:mm`, and `Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' })` for `at`. Never call `new Date('HH:mm')`.

- [ ] **Step 3: Write the failing `formToTiming` / `timingToForm` tests**

In `tests/unit/schedule-form.spec.ts`:
- `hourly` → `{ kind:'every', every:{ every_seconds: 3600 } }`.
- `daily` `09:30`, zone `Asia/Tokyo` → `{ kind:'daily', daily:{ time:'09:30:00.000', time_zone:'Asia/Tokyo' } }`.
- `weekdays` → `weekly` with `weekdays:[1,2,3,4,5]`; `weekly` with `[2,4]` keeps order.
- `once` date `2099-01-02`, time `15:45`, zone `America/New_York` → `{ kind:'at', at:'2099-01-02T20:45:00.000Z' }` (EST offset).
- `once` with a past date throws `ScheduleFormError` with `code 'not_future'`.
- `once` on `2026-03-08` `02:30` in `America/New_York` (spring-forward gap) throws `ScheduleFormError` with `code 'invalid_rule'`.
- `custom` with empty cron throws `invalid_rule`; non-empty → `{ kind:'cron', cron:{ expression, time_zone } }`.
- `timingToForm` round-trips every kind `formToTiming` emits, preserving title/prompt/model from the base; `after` and `rrule` map to `custom` with a `model`/`timeZone` preserved and do not throw.
- `browserTimeZone()` returns a non-empty string (stub `Intl.DateTimeFormat` if needed).

- [ ] **Step 4: Run it and confirm it fails, then implement `form.ts`**

Run: `pnpm vitest run tests/unit/schedule-form.spec.ts` → FAIL. Implement:
- `browserTimeZone`: `Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'`.
- `formToTiming`: switch on frequency; `time` normalized to `HH:mm:00.000`; `weekly` rejects an empty weekday list with `invalid_rule`; `once` uses a `zonedToUtc(date, time, zone)` helper that computes the zone offset for that wall time (`Intl.DateTimeFormat` with `timeZone`, `hourCycle:'h23'`, diff to UTC) and verifies the result formats back to the same wall time — a mismatch (DST gap) throws `invalid_rule`; a result `<= Date.now()` throws `not_future`.
- `timingToForm`: fill timing fields from the kind into a copy of `base`; `at` converts the instant to the base zone's `date`/`time`; unsupported kinds become `custom` with an empty cron.

- [ ] **Step 5: Write the failing template tests, then implement `templates.ts`**

`tests/unit/schedule-templates.spec.ts`: four templates with the pinned titles/schedules (`Daily briefing`/weekdays 08:00, `Weekly review`/Friday 16:00, `Monitor a topic`/daily 09:00, `Content ideas`/Monday 09:00); `templateValues(TEMPLATES[0], 'Europe/London')` yields a `ScheduleFormValues` whose `formToTiming` is a valid `weekly` timing in that zone; every template's values round-trip. Copy the exact titles from the screenshot; descriptions and prompts are one sentence each, versioned here so Task 3's cards and Task 5's prefill agree.

- [ ] **Step 6: Run all three, then commit**

Run: `pnpm vitest run tests/unit/schedule-describe.spec.ts tests/unit/schedule-form.spec.ts tests/unit/schedule-templates.spec.ts && pnpm typecheck`
Expected: PASS.

```bash
git add src/schedule tests/unit/schedule-*.spec.ts
git commit -m "feat(schedule): timing parsing, copy and templates"
```

---

### Task 3: Sidebar entry and the Yours page

**Files:**
- Modify: `src/ui/shell/Sidebar.tsx`
- Create: `app/(app)/scheduled/page.tsx`, `src/ui/scheduled/ScheduledPage.tsx`
- Test: `tests/component/scheduled.spec.tsx`

**Interfaces:**
- Consumes: `api.listSchedules`, `describeTiming`, `formToTiming`, `TEMPLATES`, `templateValues`, `browserTimeZone`, `goToLogin`, `SESSIONS_CHANGED`, `TopBar`.
- Produces: `export function ScheduledPage()` — no props; renders its own `TopBar` (title `Scheduled tasks`) so tabs and the action share state.

**Layout:** `TopBar` with `end` = New task `DropdownMenu` ("Create with chat" → `router.push('/?schedule=1')`, "Set up manually" → `/scheduled/new`) and `tabs` = astryx `TabList` with **Yours** and **Templates**. Content in a `VStack` with gap/padding tokens.

- [ ] **Step 1: Write the failing component tests**

In `tests/component/scheduled.spec.tsx` (`// @vitest-environment jsdom`, import `../helpers/dom`, mock `next/navigation` and `@/api/client` like `tests/component/sidebar.spec.tsx`): with `listSchedules` resolving `{data: [], has_more: false, …}`, expect the empty state text `No scheduled tasks yet.`, a `Set up manually` button, the four template titles, and the `Scheduled tasks` heading. With one active task, expect its title, `Weekdays at 8:00 AM`, and links to `/scheduled/t1`. With `listSchedules` rejecting an `ApiError(501,'schedules_unavailable',…)`, expect a banner containing the message and a `Retry` button. With `ApiError(401,'signed_out',…)`, expect `window.location.assign` called with `/login` (stub it).

- [ ] **Step 2: Run it and confirm it fails**

Run: `pnpm vitest run tests/component/scheduled.spec.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the page and sidebar entry**

Add to `Sidebar.tsx` `topContent`, directly under "New chat": `<SideNavItem label="Scheduled" icon={ClockIcon} href="/scheduled" isSelected={pathname.startsWith('/scheduled')} />` (import `ClockIcon` from `@heroicons/react/16/solid`). Create the server page with `export const dynamic = 'force-dynamic'`, `await requirePageSession()`, and `<ScheduledPage />`. In `ScheduledPage.tsx` (`'use client'`): load once on mount and on the `SESSIONS_CHANGED` window event, `401 → goToLogin()`, store `schedules | null`, `error: string | null`; render `Skeleton` while null and no error; on success render `TabList` + either the table or the empty state; the Templates tab renders a two-column `ClickableCard` grid from `TEMPLATES` (title, description, `describeTiming(formToTiming(templateValues(t, browserTimeZone())))` as the schedule line). The empty state is centred: `Icon` (clock), text `No scheduled tasks yet.`, `Button` `Set up manually`, then a `Divider` and the same template grid labelled `Templates`.

- [ ] **Step 4: Run it and confirm it passes**

Run: `pnpm vitest run tests/component/scheduled.spec.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/'(app)'/scheduled/page.tsx src/ui/scheduled/ScheduledPage.tsx src/ui/shell/Sidebar.tsx tests/component/scheduled.spec.tsx
git commit -m "feat(scheduled): sidebar entry and task list page"
```

---

### Task 4: Row status, run now, delete, search

**Files:**
- Modify: `src/ui/scheduled/ScheduledPage.tsx`
- Create: `src/ui/scheduled/ScheduleDialogs.tsx`
- Test: `tests/component/scheduled.spec.tsx`

**Interfaces:**
- Produces: `export function DeleteScheduleDialog({ schedule, onClose, onDeleted }: { schedule: AgentSchedule | null; onClose(): void; onDeleted(id: string): void })`.

- [ ] **Step 1: Write the failing tests**

In `tests/component/scheduled.spec.tsx`:
- Toggling the row's switch calls `api.pauseSchedule('t1')`, shows the row paused, and calls `api.resumeSchedule('t1')` on the next toggle; when `pauseSchedule` rejects, the switch returns to active and a toast/error text appears.
- `Run now` calls `api.runSchedule('t1')` and, when it rejects with `ApiError(409,'schedule_execution_pending',…)`, shows that message.
- `Delete` opens the confirm dialog; confirming calls `api.deleteSchedule('t1')` and the row disappears; cancelling calls nothing.
- The search input filters rows by title (`Alpha` keeps `Alpha`, hides `Beta`).
- An ended task renders `Ended` and no switch.

- [ ] **Step 2: Run and confirm failure, then implement**

Run: `pnpm vitest run tests/component/scheduled.spec.tsx` → FAIL. Implement: `pending` id state; each mutation sets it, calls the API, replaces/removes the row on success, reverts on failure and sets an error message rendered by the page (reuse `Toast` or a `Banner`); `DeleteScheduleDialog` with `AlertDialog` (`Delete` destructive, `Cancel`); row `MoreMenu` items Run now / Edit (`router.push('/scheduled/'+id+'/edit')`) / Delete (destructive); `Switch` labelled `Pause {title}` for active, `Resume {title}` for paused, wrapped so a click does not navigate; `TextInput` search above the table, filtering `schedules` by lowercased title.

- [ ] **Step 3: Run the tests and commit**

Run: `pnpm vitest run tests/component/scheduled.spec.tsx && pnpm typecheck` → PASS.

```bash
git add src/ui/scheduled tests/component/scheduled.spec.tsx
git commit -m "feat(scheduled): pause, run, delete and search on the list"
```

---

### Task 5: Create form and template prefill

**Files:**
- Create: `app/(app)/scheduled/new/page.tsx`, `src/ui/scheduled/ScheduleForm.tsx`
- Test: `tests/component/schedule-form.spec.tsx`

**Interfaces:**
- Consumes: `formToTiming`, `timingToForm`, `browserTimeZone`, `ScheduleFormError`, `TEMPLATES`, `templateValues`, `api.createSchedule`, `api.models`.
- Produces: `export function ScheduleForm({ schedule, templateId }: { schedule?: AgentSchedule; templateId?: string | null })` — create when `schedule` is undefined; edit (Task 6) otherwise.

- [ ] **Step 1: Write the failing tests**

`tests/component/schedule-form.spec.tsx` (jsdom, mocked `next/navigation`, `@/api/client`):
- Renders fields Name, Prompt, Frequency, Time zone, and a submit button `Create task`; Date and Weekdays and Cron are absent for `Daily`.
- Choosing `Once` reveals Date; `Weekly` reveals Weekdays; `Custom` reveals Cron; `Hourly` hides Time.
- Submitting a valid Weekdays form calls `api.createSchedule` once with `{title:'Standup', prompt:'…', timing:{kind:'weekly',weekly:{time:'09:00:00.000', time_zone:'Asia/Tokyo', weekdays:[1,2,3,4,5]}}, agent:{model:'mock-model'}}` and navigates to `/scheduled/s1`; the weekday buttons are labelled Mon…Sun.
- `templateId='weekly-review'` prefills title `Weekly review` and time `16:00`, and `Fridays` selected, with the browser zone.
- `createSchedule` rejecting `ApiError(400,'invalid_time_zone',…)` shows the message next to the time-zone field and keeps the entered values.
- An empty title does not call the API.

- [ ] **Step 2: Run and confirm failure, then implement**

Run: `pnpm vitest run tests/component/schedule-form.spec.tsx` → FAIL. Implement `ScheduleForm` with local `values` state; models loaded once for create (`api.models()`; default via `pickModel(list, readModelCookie())`); frequency via `SegmentedControl`; `TimeInput`, `DateInput`, `ToggleButtonGroup` weekdays, `TextInput` cron, `Typeahead` time zone over `Intl.supportedValuesOf('timeZone')` (fallback to `[browserTimeZone(), 'UTC']`), `Selector` model (create only). Submit builds the timing with `formToTiming` and posts; `ScheduleFormError` and `ApiError` codes map to field errors (`invalid_prompt`, `invalid_rule`, `not_future`, `frequency_too_high`, `invalid_time_zone`), everything else to a form banner. The server page sets `dynamic='force-dynamic'`, `requirePageSession()`, and reads `searchParams.template` (a Promise in Next 16) to pass `templateId`.

- [ ] **Step 3: Run the test and commit**

Run: `pnpm vitest run tests/component/schedule-form.spec.tsx && pnpm typecheck` → PASS.

```bash
git add app/'(app)'/scheduled/new/page.tsx src/ui/scheduled/ScheduleForm.tsx tests/component/schedule-form.spec.tsx
git commit -m "feat(scheduled): create form and template prefill"
```

---

### Task 6: Edit form and 409 handling

**Files:**
- Modify: `src/ui/scheduled/ScheduleForm.tsx`
- Create: `app/(app)/scheduled/[id]/edit/page.tsx`
- Test: `tests/component/schedule-form.spec.tsx`

**Interfaces:**
- Consumes: `api.getSchedule`, `api.updateSchedule`; existing `ScheduleForm` props.

- [ ] **Step 1: Write the failing tests**

Add to `tests/component/schedule-form.spec.tsx` with `schedule` set to a fetched record:
- Edit mode hides the model field and shows `Save changes`.
- The form prefills from `timingToForm(schedule.timing, …)` (title, prompt, weekly days, time).
- Submitting sends `{title, prompt, timing, revision: schedule.revision}` and navigates to `/scheduled/t1`.
- `updateSchedule` rejecting `ApiError(409,'schedule_conflict',…)` shows a banner containing `changed elsewhere` and a `Reload` button; clicking Reload calls `api.getSchedule` again and replaces the fields with the new values.
- A schedule whose timing is `after` opens without throwing, frequency shows `Custom`, and saving sends a `cron` timing only when a cron is entered.
- `api.getSchedule` rejecting 404 renders `Task not found` and no form.

- [ ] **Step 2: Run and confirm failure, then implement**

Run: `pnpm vitest run tests/component/schedule-form.spec.tsx` → FAIL. In edit mode, load the record on mount (`getSchedule(props.schedule.id)` when only an id is given; prefer the parent page passing the fetched record), prefill, hide model, submit with `revision`, show the conflict banner with a `Reload` action (`Button` → refetch and `setValues(timingToForm(...))`). Create `app/(app)/scheduled/[id]/edit/page.tsx` (`dynamic`, `requirePageSession`, `params: Promise<{id:string}>`).

- [ ] **Step 3: Run and commit**

Run: `pnpm vitest run tests/component/schedule-form.spec.tsx && pnpm typecheck` → PASS.

```bash
git add src/ui/scheduled/ScheduleForm.tsx app/'(app)'/scheduled/'[id]'/edit/page.tsx tests/component/schedule-form.spec.tsx
git commit -m "feat(scheduled): edit form with conflict handling"
```

---

### Task 7: Detail page and delivery history

**Files:**
- Create: `app/(app)/scheduled/[id]/page.tsx`, `src/ui/scheduled/ScheduleDetail.tsx`
- Test: `tests/component/schedule-detail.spec.tsx`

**Interfaces:**
- Consumes: `api.getSchedule`, `api.listScheduleRuns`, `api.pauseSchedule`, `api.resumeSchedule`, `api.runSchedule`, `api.deleteSchedule`, `describeTiming`, `DeleteScheduleDialog`.
- Produces: `export function ScheduleDetail({ id }: { id: string })`.

- [ ] **Step 1: Write the failing tests**

`tests/component/schedule-detail.spec.tsx` (jsdom, mocks as above):
- Renders the title, `Weekdays at 8:00 AM`, next run, status, prompt, and a runs table with a row linking to `/c/sesn_1`.
- `Run now` calls `api.runSchedule` and refetches schedule + runs (assert `listScheduleRuns` called twice).
- A `Load more` button appears when `has_more` and calls `listScheduleRuns` with `before` = `next_before`, appending rows.
- Pause/Resume calls the matching endpoint and updates the status.
- `Open chat` links to `/c/{session_id}`; `Edit` links to `/scheduled/{id}/edit`.
- Delete confirms, calls `api.deleteSchedule`, then `router.push('/scheduled')`.
- `getSchedule` rejecting 404 renders `Task not found`.
- A rejected `runSchedule` with 409 `schedule_execution_pending` shows the message and does not clear the runs.

- [ ] **Step 2: Run and confirm failure, then implement**

Run: `pnpm vitest run tests/component/schedule-detail.spec.tsx` → FAIL. Implement with `MetadataList` (Schedule, Next run, Time zone, Status, Created), an actions `HStack`, the prompt in a `VStack` with `Text`/`Markdown`, and the runs `Table`. Load runs with `limit: 20`; `next_before` drives `Load more`. 401 → `goToLogin`. Create the server page like the edit page.

- [ ] **Step 3: Run and commit**

Run: `pnpm vitest run tests/component/schedule-detail.spec.tsx && pnpm typecheck` → PASS.

```bash
git add app/'(app)'/scheduled/'[id]'/page.tsx src/ui/scheduled/ScheduleDetail.tsx tests/component/schedule-detail.spec.tsx
git commit -m "feat(scheduled): task detail and delivery history"
```

---

### Task 8: Create with chat

**Files:**
- Create: `src/schedule/seed.ts`
- Modify: `src/ui/chat/Composer.tsx`, `src/ui/chat/NewChat.tsx`, `app/(app)/page.tsx`
- Test: `tests/unit/schedule-seed.spec.ts`, `tests/component/composer.spec.tsx`

**Interfaces:**
- Produces: `export function buildScheduleSeed(timeZone: string): string`; `Composer` gains `initialValue?: string`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/schedule-seed.spec.ts`: `buildScheduleSeed('Asia/Tokyo')` contains `Asia/Tokyo` and the phrases `scheduled task`, `show me the plan`, `once I confirm`; a different zone changes only the zone text.

Add to `tests/component/composer.spec.tsx`: rendering `<Composer initialValue="seed text" onSend={…} />` shows the text in the editor and focuses it; pressing Enter sends it once; rendering without `initialValue` starts empty; a rerender with a different `initialValue` does not overwrite text the user typed.

- [ ] **Step 2: Run and confirm failure, then implement**

Run: `pnpm vitest run tests/unit/schedule-seed.spec.ts tests/component/composer.spec.tsx` → FAIL. Add `initialValue` to `Composer` (`useState(initialValue ?? '')` plus a `useRef` guard so a later prop change is ignored once mounted; the existing autofocus applies after enable). In `NewChat`, accept `schedule?: boolean` and pass `initialValue={schedule ? buildScheduleSeed(browserTimeZone()) : undefined}`; no auto-send. In `app/(app)/page.tsx`, make the page `async`, read `searchParams: Promise<{ schedule?: string }>`, and pass `schedule={schedule === '1'}`. (This keeps `useSearchParams`/Suspense out of the client tree.)

- [ ] **Step 3: Run and commit**

Run: `pnpm vitest run tests/unit/schedule-seed.spec.ts tests/component/composer.spec.tsx && pnpm typecheck` → PASS.

```bash
git add src/schedule/seed.ts src/ui/chat/Composer.tsx src/ui/chat/NewChat.tsx app/'(app)'/page.tsx tests/unit/schedule-seed.spec.ts tests/component/composer.spec.tsx
git commit -m "feat(scheduled): create a task from a new chat"
```

---

### Task 9: Changelog, status docs, whole-feature check

**Files:**
- Modify: `CHANGELOG.md`, `AGENTS.md`

- [ ] **Step 1: Add the changelog bullet**

Under `## Unreleased`, one dated bullet: the Scheduled page (Yours / Templates, pause·resume, run now, delete, search), the manual create/edit form with time zones and templates, the detail page with delivery history linking to the run's chat, the sidebar entry, and "Create with chat" seeding the composer at `/?schedule=1`; note that it needs the scheduled-tasks backend (B0–B8) and shows `schedules_unavailable` until then.

- [ ] **Step 2: Update the status section of `AGENTS.md`**

Add a "Scheduled tasks (web)" entry: implemented on this branch against the backend contract; backend not yet live; e2e deferred. Point at this plan and the design doc.

- [ ] **Step 3: Whole-feature verification**

Run: `pnpm typecheck && pnpm test`
Expected: PASS (all unit + component tests). Then run `pnpm build` **only if** `AGENTRY_WEB_*` env vars are available; otherwise note it was skipped. Do not run Playwright.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md AGENTS.md
git commit -m "docs: scheduled tasks web status and changelog"
```

---

## Self-review

- **Spec coverage:** F1 → Task 1; F2 → Task 2; F3 → Tasks 3–4 (table, empty state, templates, New task menu, actions, tests); F4 → Tasks 5–6; F5 → Task 7; F6 → Task 8; F7 → explicitly out (user). F3's `library`-template frame is replaced by the approved claude.ai-shaped frame with `TopBar` + `TabList`.
- **Types:** `ScheduleTiming`/`AgentSchedule`/`CreateScheduleParams` are defined once in Task 1 and referenced thereafter; helper signatures in Task 2 match Tasks 5–7; `DeleteScheduleDialog` is defined in Task 4 and consumed in Task 7.
- **Review Focus:** each of the five lines has a task test (DST/past → Task 2; odd timing kinds → Tasks 2 & 6; 409 → Task 6; 501/404 → Tasks 3 & 7; failed mutations → Task 4).
