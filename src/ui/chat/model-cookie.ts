/**
 * The default model for new chats lives in the `agentry_model` cookie (not
 * httpOnly, holds no secret). Settings writes it; the new-chat page reads it
 * and falls back to the first offered model when it is missing or no longer
 * offered.
 */
export const MODEL_COOKIE = 'agentry_model'
const ONE_YEAR_S = 60 * 60 * 24 * 365

/** Browser only. */
export function readModelCookie(): string | null {
  if (typeof document === 'undefined') return null
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === MODEL_COOKIE) return decodeURIComponent(rest.join('=')) || null
  }
  return null
}

/** Browser only. */
export function writeModelCookie(model: string): void {
  document.cookie = `${MODEL_COOKIE}=${encodeURIComponent(model)}; Path=/; Max-Age=${ONE_YEAR_S}; SameSite=Lax`
}

/** The model to preselect: the saved one when still offered, else the first offered. */
export function pickModel(models: string[], saved: string | null): string {
  return saved && models.includes(saved) ? saved : (models[0] ?? '')
}
