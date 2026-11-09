/**
 * The light / dark / system choice lives in the `agentry_theme` cookie (not
 * httpOnly, holds no secret) so the server renders the chosen mode on first
 * paint. The root layout reads it with `readThemeMode`; settings writes it
 * with `writeThemeCookie` and refreshes the route.
 */
export const THEME_COOKIE = 'agentry_theme'
export const THEME_MODES = ['system', 'light', 'dark'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

const ONE_YEAR_S = 60 * 60 * 24 * 365

/** Any unknown or missing value is `system`. */
export function parseThemeMode(value: string | undefined | null): ThemeMode {
  return value === 'light' || value === 'dark' ? value : 'system'
}

/** `document.cookie` value for a theme choice. */
export function themeCookie(mode: ThemeMode): string {
  return `${THEME_COOKIE}=${mode}; Path=/; Max-Age=${ONE_YEAR_S}; SameSite=Lax`
}

/** Browser only: stores the choice; the caller refreshes the route so the server re-renders. */
export function writeThemeCookie(mode: ThemeMode): void {
  document.cookie = themeCookie(mode)
}
