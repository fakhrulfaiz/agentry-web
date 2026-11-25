/** Display formats shared by the trajectory ledger, overview and inspector. */

const count = new Intl.NumberFormat('en')

export const NOT_RECORDED = 'Not recorded'
export const NOT_AVAILABLE = 'Not available'
/** A ledger cell with no value. */
export const EMPTY = '—'

export function formatTokens(n: number): string {
  return count.format(n)
}

/** `340 ms`, `1.3 s`, `13 s`, `2 m 5 s`. */
export function formatSeconds(seconds: number): string {
  const exact = Math.max(0, seconds)
  if (exact < 1) return `${String(Math.round(exact * 1000))} ms`
  if (exact < 10) return `${(Math.round(exact * 10) / 10).toFixed(1)} s`
  const s = Math.round(exact)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} m ${s % 60} s`
}

/** Unix seconds as a UTC clock time, `2026-11-09 10:20:41 UTC`. */
export function formatClock(unixSeconds: number): string {
  return `${new Date(unixSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ')} UTC`
}
