/**
 * Vitest setup: our own `stylex.create()` calls are compiled by the Next build
 * only, so under Vitest `create` returns empty compiled styles (`{ $$css: true }`
 * per key). Everything else, including `stylex.props` that astryx's prebuilt
 * components call, is the real runtime.
 */
import { vi } from 'vitest'

vi.mock('@stylexjs/stylex', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const create = (styles: Record<string, unknown>) =>
    Object.fromEntries(Object.keys(styles).map((key) => [key, { $$css: true }]))
  return { ...actual, create }
})
