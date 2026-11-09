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
    '--color-icon-accent': ACCENT,
    '--color-text-accent': ACCENT,
    '--color-accent-muted': ACCENT_MUTED,
    '--radius-chat': 'var(--radius-container)',
  },
  components: {
    'text-input': { base: INPUT_RADIUS },
    'text-area': { base: INPUT_RADIUS },
    selector: { base: INPUT_RADIUS },
    typeahead: { base: INPUT_RADIUS },
  },
})

export default agentryTheme
