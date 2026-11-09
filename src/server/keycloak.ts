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
 * Returns the credential unchanged while the access token has more than 60s
 * left; otherwise exchanges the refresh token. `null` when the refresh fails
 * (the caller signs the user out).
 */
export async function refreshIfNeeded(c: KeycloakCredential, now: number): Promise<Credential | null> {
  if (now < c.expiresAt - REFRESH_MARGIN_MS) return c
  const kc = keycloakConfig()
  try {
    const res = await fetch(oidcEndpoint(kc.issuer, 'token'), {
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
    if (!res.ok) return null
    const body = (await res.json()) as {
      access_token?: unknown
      refresh_token?: unknown
      id_token?: unknown
      expires_in?: unknown
    }
    if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') return null
    return {
      kind: 'keycloak',
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : c.refreshToken,
      idToken: typeof body.id_token === 'string' ? body.id_token : c.idToken,
      expiresAt: now + body.expires_in * 1000,
    }
  } catch {
    return null
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

/** Keycloak RP-initiated logout URL. */
export function endSessionUrl(idToken: string, postLogoutRedirectUri: string): string {
  const kc = keycloakConfig()
  const url = new URL(oidcEndpoint(kc.issuer, 'logout'))
  url.searchParams.set('id_token_hint', idToken)
  url.searchParams.set('client_id', kc.clientId)
  url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri)
  return url.toString()
}
