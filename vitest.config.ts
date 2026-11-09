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
    include: ['tests/unit/**/*.spec.ts', 'tests/component/**/*.spec.tsx'],
  },
})
