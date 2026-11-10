/**
 * The Agentry theme: astryx `theme-neutral` re-coloured to a shadcn-style palette (blue accent,
 * flat neutral greys, small radii, Inter for text and headings, JetBrains Mono for code).
 *
 * This is the source; `pnpm exec astryx theme build src/ui/theme/brand.ts --out src/ui/theme/agentry.css`
 * writes the prebuilt `agentry.css` / `agentry.js` / `agentry.d.ts` that the app
 * loads (built themes paint on first render, with no runtime style injection).
 * Rebuild after editing this file or upgrading astryx.
 */
import { defineTheme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral'

/** Fonts loaded by `app/layout.tsx` through next/font (`--font-sans`, `--font-mono`). */
const SANS = 'var(--font-sans), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
const MONO = 'var(--font-mono), ui-monospace, "SF Mono", Menlo, Consolas, monospace'

/** Palette as [light, dark]. */
const ACCENT: [string, string] = ['#3b82f6', '#3b82f6']
/** Accent used as text or icon colour: darker on light for contrast, lighter on dark. */
const ACCENT_TEXT: [string, string] = ['#2563eb', '#60a5fa']
const ACCENT_MUTED: [string, string] = ['#e0f2fe', '#1e3a8a']
const BODY: [string, string] = ['#ffffff', '#171717']
const CARD: [string, string] = ['#ffffff', '#262626']
const SURFACE: [string, string] = ['#f9fafb', '#1f1f1f']
const MUTED: [string, string] = ['#f3f4f6', '#262626']
const BORDER: [string, string] = ['#e5e7eb', '#404040']
const TEXT: [string, string] = ['#333333', '#e5e5e5']
const TEXT_SECONDARY: [string, string] = ['#6b7280', '#a3a3a3']

/**
 * Input controls sit one step lower on the radius scale than astryx's
 * defaults, for a quieter look: fields and selects use `--radius-inner`
 * (instead of `--radius-element`, which buttons keep), and the chat composer
 * `--radius-container` (instead of `--radius-chat`, which only it uses).
 */
const INPUT_RADIUS = { borderRadius: 'var(--radius-inner)' }

export const agentryTheme = defineTheme({
  name: 'agentry',
  extends: neutralTheme,
  tokens: {
    '--color-accent': ACCENT,
    '--color-icon-accent': ACCENT_TEXT,
    '--color-text-accent': ACCENT_TEXT,
    '--color-accent-muted': ACCENT_MUTED,
    '--color-background-body': BODY,
    '--color-background-card': CARD,
    '--color-background-popover': CARD,
    '--color-background-surface': SURFACE,
    '--color-background-muted': MUTED,
    '--color-border': BORDER,
    '--color-text-primary': TEXT,
    '--color-text-secondary': TEXT_SECONDARY,
    '--radius-inner': '0.25rem',
    '--radius-element': '0.375rem',
    '--radius-container': '0.5rem',
    '--radius-chat': '1rem',
    '--radius-page': '0.75rem',
    '--font-family-body': SANS,
    '--font-family-heading': SANS,
    '--font-family-code': MONO,
  },
  components: {
    'text-input': { base: INPUT_RADIUS },
    'text-area': { base: INPUT_RADIUS },
    selector: { base: INPUT_RADIUS },
    typeahead: { base: INPUT_RADIUS },
  },
})

export default agentryTheme
