/**
 * Accent hues for icon tiles (agents, skills, environments, artifacts). Tiles
 * mix a hue with transparency, so the same hue reads in light and dark themes.
 */
export const HUES = {
  blue: '#3b82f6',
  violet: '#8b5cf6',
  green: '#22a06b',
  orange: '#f97316',
  pink: '#e5487f',
  teal: '#0e9f9a',
  amber: '#d4930b',
  red: '#e5484d',
  slate: '#7c8794',
} as const

export type HueName = keyof typeof HUES

/** `hue` at `percent` opacity over whatever is behind it. */
export const tint = (hue: string, percent: number): string => `color-mix(in srgb, ${hue} ${percent}%, transparent)`
