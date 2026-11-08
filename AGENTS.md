# Agentry Web — agent guide

Read this first in every session. `CLAUDE.md` is a symlink to this file; edit `AGENTS.md`.

## What this is

**Agentry Web**: the claude.ai-style frontend for Agentry. Next.js (App Router) + astryx design system + StyleX, with a backend-for-frontend (BFF) that keeps every Agentry credential out of the browser. Backend: Agentry API in `~/code/dsh-agents-api` (`@agentry/api`, OpenAI Agents API–compatible; see its `AGENTS.md`).

## Status

- F1 (shell + sign-in + chat): spec approved, plan written, **implementation not started**.
  - Spec: `docs/superpowers/specs/2026-11-08-agentry-web-f1-design.md`
  - Plan: `docs/superpowers/plans/2026-11-08-agentry-web-f1.md` (8 tasks)
- Later specs: F2 admin, F3 artifacts/files, F4 trace inspector + subagent views.

## Resume / start the F1 plan

In a Claude Code session opened in `~/code/agentry-web`, say:

> Execute docs/superpowers/plans/2026-11-08-agentry-web-f1.md with subagent-driven-development (implementers on Opus, reviewers on Sonnet).

Progress is tracked in the plan's ledger under `.superpowers/sdd/` (git-ignored); if one exists, resume from it instead of restarting.

## Rules

- Never add `Co-Authored-By` or any AI attribution to commits or PRs. Commit as `fakhrulfaiz <fakhrulfaiz2003@gmail.com>`.
- Follow the plan's Global Constraints (credentials never reach the browser; exact astryx/StyleX versions; no Anthropic branding).
- Update `CHANGELOG.md` with every behavior change.
