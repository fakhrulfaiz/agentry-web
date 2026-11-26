import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const src = fileURLToPath(new URL('./src', import.meta.url))
const serverOnlyStub = fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': src,
      // `server-only` throws outside a React Server Components bundle; tests import server modules directly.
      'server-only': serverOnlyStub,
    },
  },
  test: {
    // Node by default; DOM tests opt in per file with `// @vitest-environment jsdom`.
    environment: 'node',
    // Our stylex.create() calls are not compiled under Vitest; see the stub.
    setupFiles: ['tests/stubs/stylex-setup.ts', 'tests/stubs/page-cache-reset.ts'],
    // jsdom renders of the whole app are CPU heavy: with a worker per core the 5s test timeout
    // trips under contention (reveal, schedule-detail, agent-form, sandboxes). Fewer workers keep it steady.
    maxWorkers: 3,
    include: ['tests/unit/**/*.spec.ts', 'tests/component/**/*.spec.tsx'],
    // next-auth imports `next/server` without an extension, which Node's ESM loader cannot
    // resolve (next has no exports map); inlining lets Vite resolve it.
    server: { deps: { inline: ['next-auth'] } },
  },
})
