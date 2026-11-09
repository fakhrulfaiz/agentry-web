/**
 * The Agentry theme: astryx `theme-neutral` plus one brand accent (a teal).
 *
 * This is the source; `pnpm exec astryx theme build src/ui/theme/brand.ts --out src/ui/theme/agentry.css`
 * writes the prebuilt `agentry.css` / `agentry.js` / `agentry.d.ts` that the app
 * loads (built themes paint on first render, with no runtime style injection).
 * Rebuild after editing this file or upgrading astryx.
 */
import { defineTheme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral'

/** Brand accent as [light, dark]. */
const ACCENT: [string, string] = ['#0f766e', '#5eead4']
const ACCENT_MUTED: [string, string] = ['#ccebe7', '#134e4a']

export const agentryTheme = defineTheme({
  name: 'agentry',
  extends: neutralTheme,
  tokens: {
    '--color-accent': ACCENT,
    '--color-icon-accent': ACCENT,
    '--color-text-accent': ACCENT,
    '--color-accent-muted': ACCENT_MUTED,
  },
})

export default agentryTheme
