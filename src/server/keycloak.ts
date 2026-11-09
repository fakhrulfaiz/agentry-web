import 'server-only'
import { getConfig } from '@/config/env'
import type { Credential, Identity } from './session'

type KeycloakCredential = Extract<Credential, { kind: 'keycloak' }>

/** Refresh this long before the access token expires. */
export const REFRESH_MARGIN_MS = 60_000

function keycloakConfig() {
  const kc = getConfig().keycloak
  if (!kc) throw new Error('Keycloak is not configured (AGENTRY_WEB_AUTH is not keycloak)')
  return kc
}

function oidcEndpoint(issuer: string, name: 'token' | 'logout'): string {
  return `${issuer.replace(/\/+$/, '')}/protocol/openid-connect/${name}`
}

/**
 * Outcome of a refresh: a fresh credential; `rejected` when Keycloak refused the
 * refresh token (400/401, e.g. `invalid_grant`), so the session is over; or
 * `unavailable` when Keycloak could not answer (network error, 5xx, malformed
 * body), so the session is kept and the caller retries later.
 */
export type RefreshResult =
  | { status: 'ok'; credential: KeycloakCredential }
  | { status: 'rejected' }
  | { status: 'unavailable' }

/** How long a successful refresh is reused for requests still carrying the old refresh token. */
export const REFRESH_REUSE_MS = 30_000

/**
 * Refreshes keyed by the refresh token they spend. Concurrent requests from one
 * browser (sessions list, models, session, items, stream) share a single token
 * call, so a realm that revokes used refresh tokens does not answer
 * `invalid_grant` to the losers. A success stays here briefly so a request that
 * started with the old cookie, and arrives after the refresh finished, gets the
 * same tokens instead of spending the revoked refresh token again.
 */
const inFlight = new Map<string, Promise<RefreshResult>>()

/**
 * Returns `ok` with the credential unchanged while the access token has more
 * than 60s left; otherwise exchanges the refresh token (once per refresh token,
 * see `inFlight`).
 */
export function refreshIfNeeded(c: KeycloakCredential, now: number): Promise<RefreshResult> {
  if (now < c.expiresAt - REFRESH_MARGIN_MS) return Promise.resolve({ status: 'ok', credential: c })
  const pending = inFlight.get(c.refreshToken)
  if (pending) return pending
  const refresh = exchange(c, now)
  inFlight.set(c.refreshToken, refresh)
  void refresh.then((result) => {
    if (result.status !== 'ok') {
      inFlight.delete(c.refreshToken)
      return
    }
    const timer = setTimeout(() => {
      if (inFlight.get(c.refreshToken) === refresh) inFlight.delete(c.refreshToken)
    }, REFRESH_REUSE_MS)
    timer.unref?.()
  })
  return refresh
}

/** Test hook: forget shared refreshes. */
export function resetRefreshes(): void {
  inFlight.clear()
}

async function exchange(c: KeycloakCredential, now: number): Promise<RefreshResult> {
  const kc = keycloakConfig()
  let res: Response
  try {
    res = await fetch(oidcEndpoint(kc.issuer, 'token'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: c.refreshToken,
        client_id: kc.clientId,
        client_secret: kc.clientSecret,
      }),
      cache: 'no-store',
    })
  } catch {
    return { status: 'unavailable' }
  }
  // Keycloak answers 400 `invalid_grant` for an expired, revoked or reused
  // refresh token (and 401 for a refused client): a definitive refusal.
  if (res.status === 400 || res.status === 401) {
    await res.body?.cancel()
    return { status: 'rejected' }
  }
  if (!res.ok) {
    await res.body?.cancel()
    return { status: 'unavailable' }
  }
  let body: { access_token?: unknown; refresh_token?: unknown; id_token?: unknown; expires_in?: unknown }
  try {
    body = (await res.json()) as typeof body
  } catch {
    return { status: 'unavailable' }
  }
  if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') return { status: 'unavailable' }
  return {
    status: 'ok',
    credential: {
      kind: 'keycloak',
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : c.refreshToken,
      idToken: typeof body.id_token === 'string' ? body.id_token : c.idToken,
      expiresAt: now + body.expires_in * 1000,
    },
  }
}

/** Unverified JWT payload. Only for tokens received directly from the token endpoint. */
function jwtClaims(token: string): Record<string, unknown> {
  try {
    const payload = token.split('.')[1]
    if (!payload) return {}
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return claims && typeof claims === 'object' ? (claims as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Identity from the access token, matching how Agentry resolves the caller:
 * owner is `sub`, roles come from `realm_access.roles`.
 */
export function identityFromTokens(accessToken: string, idToken?: string): Identity {
  const claims = { ...jwtClaims(idToken ?? ''), ...jwtClaims(accessToken) }
  const owner = typeof claims.sub === 'string' ? claims.sub : ''
  const realm = claims.realm_access as { roles?: unknown } | undefined
  const roles = Array.isArray(realm?.roles) ? realm.roles.filter((r): r is string => typeof r === 'string') : []
  const name = [claims.name, claims.preferred_username, claims.email].find(
    (v): v is string => typeof v === 'string' && v !== '',
  )
  return { owner, roles, displayName: name ?? owner }
}

/**
 * Keycloak RP-initiated logout URL. It names the client instead of passing
 * `id_token_hint`, so the ID token never leaves the server (Keycloak then asks
 * the user to confirm the sign-out).
 */
export function endSessionUrl(postLogoutRedirectUri: string): string {
  const kc = keycloakConfig()
  const url = new URL(oidcEndpoint(kc.issuer, 'logout'))
  url.searchParams.set('client_id', kc.clientId)
  url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri)
  return url.toString()
}
