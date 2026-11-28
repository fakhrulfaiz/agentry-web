# Agent Library (2026-11-28)

Replaces the removed bundled starters with a **Library**: agents from sources you browse and pick from. Nothing becomes an agent automatically.

## Decisions (user, 2026-11-28)

- Name: **Library**. Agents page tabs: **Yours** | **Library**.
- Same name on add: the name field is prefilled as "<Name> (<source label>)" when the user already has an agent with that name; editable. Saved agents remember their source (`metadata.library_source`, `metadata.library_ref` = source label + file path/URL).
- Built-in source: **copied from ECC and adapted to Agentry**, not a blind copy. ECC (`~/code/ECC`, https://github.com/affaan-m/ECC) is MIT: keep its copyright and license text in `src/agents/library/NOTICE.md` and put `source:` / `license: MIT (ECC, Affaan Mustafa)` in each adapted file's front matter.
- Every agent can be exported as `.md` (already on agent cards: JSON or Markdown); Library items also get a "Download .md".

## Built-in library (web repo, `src/agents/library/*.md`)

Pick ~15 broadly useful ECC agents (not language-specific reviewers, except Python and TypeScript): planner, architect, code-reviewer, security-reviewer, tdd-guide, refactor-cleaner, doc-updater, docs-lookup, performance-optimizer, build-error-resolver, e2e-runner, code-explorer, spec-miner, chief-of-staff, marketing-agent or seo-specialist, python-reviewer, typescript-reviewer. For each, write an Agentry version:
- Same purpose, same useful method; shorter where ECC is long.
- Tools in Agentry terms (the server's tool names: `read`, `write`, `edit`, `grep`, `glob`, `bash`, `web_fetch`, `web_search`, `todo_write`, …; use `GET /v1/agents/tools` for the list). Mention Agentry capabilities where they help: the sandbox and `/workspace`, the browser (Playwright, "Web browser" switch; e2e-runner should use it), connected apps via Composio (chief-of-staff: Gmail/Calendar), subagents (turn on `Task` → multi-agent only where ECC uses delegation), files delivered to the user (the `present` tool), skills.
- Remove Claude-Code-only content: CLAUDE.md/AGENTS.md conventions unless generic, slash commands, hooks, `mcp__*` tool names, model names (no `model:`; the user's default applies), plugin/marketplace talk, ECC-internal references.
- Front matter: `name`, `description`, `tools`, `source` (ECC path), `license`, optional `browser: true`, `apps: …` hints if the form supports them.
Ship them as data the web app reads at build time (import the .md files as text, or a generated `index.ts`); parse with the same parser rules as Import (reuse `src/agents/draft.ts` / the API parser shape so `Add` opens the same prefilled editor with notes).

## User sources

- A source = a label ("ECC") + a GitHub folder or gist URL (Import's host rules: GitHub/gist only). Stored per owner in the API (`GET/POST/DELETE /v1/agents/library/sources`, owner-scoped, small table or the owner's metadata; max ~10 sources). Listing a source reuses the import fetch (folder → candidate files with name/description) with a short server cache (~10 min) and a manual refresh.
- Built-in source is always listed first, label "Agentry".

## UI (web)

- Library tab: search box, source filter (chips or a select), cards in a grid (reuse `EntityCard`/`CardGrid`/`IconTile`): name, one-line description, source badge. Per card: **Add** (primary small button or icon — opens the editor prefilled; name collision rule above), **Preview** (icon: read the prompt in a side dialog), **Download .md** (icon). Already-added items show "Added" (match by `metadata.library_ref`).
- ⚙ icon on the Library tab: "Sources" dialog — list, add (label + link, validated), remove. Minimal buttons: icon buttons with tooltips + ⋯ menus.
- Empty "Yours" state: buttons "Browse the Library" and "Import an agent".

## Tests (minimal, per the user)

Parser/front-matter for built-in files (all parse, tools exist in the mapping), name-collision naming, sources route owner scoping and host refusal, the Library listing merge. No big component suites.
