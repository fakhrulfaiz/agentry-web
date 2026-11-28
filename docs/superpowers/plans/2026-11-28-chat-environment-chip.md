# Chat header environment chip — implementation plan (2026-11-28)

Spec: `docs/superpowers/specs/2026-11-28-chat-environment-chip-design.md` (approved 2026-11-28). This plan covers only the header chip; subagent views get a separate design and plan afterwards.

## Constraints

- No API or BFF change. The browser calls the existing `api.getSandboxEnvironment(id)` (`src/api/client.ts:497-498`), which the BFF allow-list already permits.
- No polling. Refresh only on environment-id change and on window focus / `visibilitychange`.
- Astryx components (`Token`, `StatusDot`) and tokens first; StyleX only if layout proves necessary.
- TDD: write the failing test first for each behavior. Keep exact dependency versions, no `Co-Authored-By`, and add a dated CHANGELOG bullet plus an `AGENTS.md` priority-list entry when the behavior lands.
- Work in place on `develop`. Stage only files this plan names; the working tree contains other sessions’ changes.
- Commands: prefix shells with `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH`.

## Task 1: pure chip label helper, with unit tests

**Files**

- `tests/unit/chat/environment-chip.spec.ts` (new)
- `src/ui/chat/environment-chip.ts` (new)

**Steps**

1. Write `tests/unit/chat/environment-chip.spec.ts` importing `environmentChip` from `@/ui/chat/environment-chip`, `ApiError` from `@/api/client`, and types from `@/api/types`. Define one local factory `env(overrides: Partial<SandboxEnvironment> = {}): SandboxEnvironment` returning `{ id: 'env_1', object: 'agent.environment', type: 'sandbox', status: 'connected', provider: 'sandbox', created_at: 1, name: 'Data box', ...overrides }`; use `env({ sandbox: { state: 'running' } })` for live cases. Cover every branch of the decided label:
   - `{ type: 'local' }`, `{ type: 'none' }` and `undefined` → `{ label: 'Server', variant: 'neutral', description: 'Default workspace on this server' }`.
   - Sandbox config, no environment/error → `Sandbox`, neutral, “Loading environment details…”.
   - `new ApiError(404, 'not_found', '...')` → `Removed sandbox`, neutral, “This chat’s sandbox no longer exists”.
   - Other `ApiError` (e.g. 503) → `Sandbox`, neutral, description includes `shortId(env id)` and says details could not load.
   - Loaded environment with `sandbox.state` → `Data box · Running` (name from `environmentName`, state word from `environmentLook`) and `variant: 'success'`; add cases for `stopped` (neutral), `provisioning` (warning) and `failed` (error).
   - Loaded environment with no `sandbox` → `environmentLook` falls back to `status`, e.g. `connected` → `Ready`.
   - Description of a loaded chip includes `providerTitle(env.provider)` and the state word.
2. Run `pnpm exec vitest run tests/unit/chat/environment-chip.spec.ts`; it must fail on the missing module.
3. Create `src/ui/chat/environment-chip.ts`:
   - Export `type EnvironmentChip = { label: string; variant: 'success' | 'warning' | 'error' | 'neutral'; description: string }`.
   - Export `sandboxEnvironmentId(environment: OAIEnvironmentConfig | undefined): string | undefined` returning the id only when `environment?.type === 'sandbox'` and `environment.environment_id` is a string; treat `''` as absent.
   - Export `environmentChip(environment: OAIEnvironmentConfig | undefined, env: SandboxEnvironment | null | undefined, error?: ApiError | null): EnvironmentChip` implementing the branches above. Import `environmentName`, `environmentLook`, `providerTitle`, `shortId` from `@/ui/sandboxes/format`; import types from `@/api/client` and `@/api/types` as types only.
4. Run the focused test again; it must pass. Commit only these two files: `test: define chat environment chip labels`.

## Task 2: chip component, with component tests

**Files**

- `tests/component/chat-environment-chip.spec.tsx` (new)
- `src/ui/chat/ChatEnvironmentChip.tsx` (new)

**Steps**

1. Write `tests/component/chat-environment-chip.spec.tsx` with `// @vitest-environment jsdom`, `import '@testing-library/jest-dom/vitest'`, `import '../helpers/dom'`, and `cleanup()` in `afterEach`. Mock `@/api/client` with a hoisted `apiMock` containing `getSandboxEnvironment: vi.fn()`; use `render`, `screen`, `waitFor`, `act`, and `fireEvent` from Testing Library. Test:
   - Rendering `<ChatEnvironmentChip environment={{ type: 'local' }} />` shows `Server` and makes no `getSandboxEnvironment` call.
   - A sandbox environment resolves to a `SandboxEnvironment` named `Data box` with `sandbox.state: 'running'`; `waitFor` the text `Data box · Running` and assert the call received `env_1` exactly once.
   - `getSandboxEnvironment` rejects with `new ApiError(404, ...)`; `waitFor` the text `Removed sandbox`.
   - `getSandboxEnvironment` rejects with `new ApiError(503, ...)`; `waitFor` the text `Sandbox` and assert a neutral description.
   - Rerendering with a different sandbox id refetches the new id and shows the new name; out-of-order responses cannot overwrite newer data (resolve a deferred promise from the first id after the second has resolved); the same holds when a focus refresh for one id overtakes the initial deferred GET.
   - `fireEvent(window, new Event('focus'))` triggers a refetch; assert the call count grows and the label stays correct.
   - The chip is not a button or link: `screen.queryByRole('button')` is null.
2. Run `pnpm exec vitest run tests/component/chat-environment-chip.spec.tsx`; it must fail on the missing module.
3. Create `src/ui/chat/ChatEnvironmentChip.tsx`:
   - `'use client'`. Props: `{ environment: OAIEnvironmentConfig | undefined }`.
   - Derive `id` with `sandboxEnvironmentId`. Keep local state `env: SandboxEnvironment | null` and `error: ApiError | null`, plus a `currentIdRef` holding the id the component currently cares about and a `requestSeqRef` counter. When `id` is undefined, reset state, render `environmentChip(environment, undefined, null)` and make no request.
   - In an effect keyed on `id`: set `currentIdRef.current = id`, clear `env`/`error`, define `refresh = () => { const seq = ++requestSeqRef.current; void api.getSandboxEnvironment(id).then((loaded) => { if (currentIdRef.current === id && seq === requestSeqRef.current) { setEnv(loaded); setError(null) } }, (failure: ApiError) => { if (currentIdRef.current === id && seq === requestSeqRef.current) { setEnv(null); setError(failure) } }) }`, call `refresh()`, and register the same `refresh` on `window` `focus` and `document` `visibilitychange` (the latter only when `document.visibilityState === 'visible'`). Remove listeners and set `currentIdRef.current = undefined` on cleanup. The id ref makes a response from an old chat harmless; the sequence ref makes an older request for the *same* id harmless when focus refreshes overlap. No polling timer. This sequence guard was added after the final review found a same-id race; the spec already required ignoring out-of-order responses.
   - Render `<Token label={chip.label} size="sm" icon={<StatusDot variant={chip.variant} label={chip.label} tooltip={chip.description} />} description={chip.description} />`; import `Token` from `@astryxdesign/core/Token` and `StatusDot` from `@astryxdesign/core/StatusDot` (as existing code does). No `onClick`/`href`.
4. Run the focused test until green. Commit only these two files: `feat: add the chat environment chip component`.

## Task 3: wire the chip into the shared chat header

**Files**

- `tests/component/cards.spec.tsx` (modify)
- `src/ui/chat/Conversation.tsx` (modify)

**Steps**

1. Add a test to `tests/component/cards.spec.tsx` near the other `Conversation` render tests (around line 352). Follow the adjacent 403 test’s pattern: `vi.stubGlobal('fetch', vi.fn(...))` returning the session JSON for `/agents/sessions/sess_chip` (fields as in `tests/component/trajectory.spec.tsx`’s session fixtures, with `environment: { type: 'sandbox', environment_id: 'env_chip' }`), an empty list for `/items`, `[]` for `/models`, an empty frame/200 for `/stream`, and empty lists for other BFF calls. Spy with `vi.spyOn(api, 'getSandboxEnvironment').mockResolvedValue(...)` so the environment request is explicit. Render `<Conversation sessionId="sess_chip" />`, then `findByText('Data box · Running')`. Switch to the Trajectory tab and assert the same chip text is still present. `vi.unstubAllGlobals()` and restore spies in `finally`/`afterEach` as the file already does.
2. Run `pnpm exec vitest run tests/component/cards.spec.tsx`; the new assertion must fail before wiring.
3. In `src/ui/chat/Conversation.tsx`, import `ChatEnvironmentChip` and render `<ChatEnvironmentChip environment={session.environment} />` inside the header `end` `HStack` (currently lines 442–447), immediately before `{session && !blank && <PreviewControls />}` under the same `session && !blank` condition. No other header or stream logic changes.
4. Run `pnpm exec vitest run tests/component/cards.spec.tsx tests/component/trajectory.spec.tsx tests/component/reveal.spec.tsx`; all must pass. Commit only these two files: `feat: show the environment chip in chat headers`.

## Task 4: bookkeeping and whole-repo verification

**Files**

- `CHANGELOG.md` (modify)
- `AGENTS.md` (modify)

**Steps**

1. Add a dated bullet to `CHANGELOG.md` under the current unreleased/version section, matching the file’s existing wording and style: the chat header now identifies the current environment (`Server` or sandbox name + live state), with focus refresh and removed-sandbox handling.
2. Add one P1 entry to `AGENTS.md` marked DONE 2026-11-28, following that file’s priority-list format. Do not rewrite unrelated status text.
3. Run, in order:
   - `pnpm typecheck`
   - `pnpm test` (full Vitest suite; if a loaded machine causes unrelated timeouts, rerun with `pnpm exec vitest run --no-file-parallelism`)
   - `pnpm exec astryx doctor --built src` — if it fails on pre-existing code unrelated to the chip, record the exact output and treat it as a known baseline rather than silently deleting unrelated code.
4. Re-read the diff (`git diff -- docs/superpowers/plans/2026-11-28-chat-environment-chip.md src/ui/chat/environment-chip.ts src/ui/chat/ChatEnvironmentChip.tsx src/ui/chat/Conversation.tsx tests/unit/chat/environment-chip.spec.ts tests/component/chat-environment-chip.spec.tsx tests/component/cards.spec.tsx CHANGELOG.md AGENTS.md`) and confirm no chip token/API key is exposed to the browser and no unrelated file is staged.
5. Commit only `CHANGELOG.md` and `AGENTS.md`: `docs: record the chat environment chip`.

## Completion criteria

- A sandbox chat header shows `Data box · Running` / `Stopped` / `Setting up` / etc.; local and legacy chats show `Server`; a deleted sandbox shows `Removed sandbox`.
- One GET on open, one on focus, no polling, no API/BFF contract change.
- Focused tests, full Vitest suite and typecheck are green; CHANGELOG and AGENTS updated; commits contain only the named files.
- No live-browser check is part of this plan; it remains a separate manual task if the user asks.
