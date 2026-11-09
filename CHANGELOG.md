# Changelog

All notable changes to Agentry Web are recorded here.

## Unreleased

- 2026-11-08: Scaffold the Next.js app (App Router, TypeScript strict) with astryx 0.7.11 (`theme-neutral`, following the OS light/dark preference) and StyleX 0.19.1. Server configuration is validated at startup: a missing or invalid `AGENTRY_WEB_AUTH`, `AGENTRY_API_URL`, `AGENTRY_WEB_SESSION_SECRET` (≥ 32 bytes) or Keycloak variable stops the server with a named `ConfigError`; optional `AGENTRY_WEB_MODELS` lists the offered models. Adds Vitest and Playwright setup.
