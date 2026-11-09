/**
 * Vitest setup: our own `stylex.create()` calls are compiled by the Next build
 * only, so under Vitest `create` returns empty compiled styles (`{ $$css: true }`
 * per key, or a function returning that for a dynamic style). Everything else, including `stylex.props` that astryx's prebuilt
 * components call, is the real runtime.
 */
import { vi } from 'vitest'

vi.mock('@stylexjs/stylex', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  // A dynamic style (a function) returns the same empty style for any argument.
  const create = (styles: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(styles).map(([key, value]) => [key, typeof value === 'function' ? () => ({ $$css: true }) : { $$css: true }]))
  return { ...actual, create }
})
