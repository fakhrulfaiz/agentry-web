import 'server-only'
import { sealData, unsealData } from 'iron-session'
import { getConfig } from '@/config/env'

/** What a preview token grants: one port of one environment, for the credential that minted it. */
export interface PreviewGrant {
  /** The `Authorization` value for Agentry; sealed (encrypted and authenticated), so the URL never exposes it. */
  authorization: string
  environment: string
  port: number
  /** Expiry, epoch milliseconds. */
  exp: number
}

/** A token never lives longer than this. */
export const PREVIEW_TTL_MS = 60 * 60 * 1000

/**
 * Seals a grant into a URL-safe token (`/preview/<token>/`). The session cookie is not needed to use it: the app
 * inside the preview is cross-origin, so its requests carry no cookies.
 * @param password - the session secret (defaults to the configured one).
 */
export async function mintPreviewToken(grant: Omit<PreviewGrant, 'exp'>, ttlMs: number = PREVIEW_TTL_MS, now: number = Date.now(), password: string = getConfig().sessionSecret): Promise<{ token: string; exp: number }> {
  const exp = now + Math.min(ttlMs, PREVIEW_TTL_MS)
  const token = await sealData({ ...grant, exp }, { password, ttl: 0 })
  return { token: encodeURIComponent(token), exp }
}

/** The grant a token carries, or `null` when it is forged, damaged or expired. */
export async function verifyPreviewToken(token: string, now: number = Date.now(), password: string = getConfig().sessionSecret): Promise<PreviewGrant | null> {
  try {
    const data = await unsealData<Partial<PreviewGrant>>(decodeURIComponent(token), { password, ttl: 0 })
    if (typeof data.authorization !== 'string' || typeof data.environment !== 'string' || typeof data.port !== 'number' || typeof data.exp !== 'number') return null
    if (data.exp <= now) return null
    return data as PreviewGrant
  } catch {
    return null
  }
}
