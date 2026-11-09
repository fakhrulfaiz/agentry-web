import 'server-only'
import { createHash } from 'node:crypto'
import NextAuth from 'next-auth'
import Keycloak from 'next-auth/providers/keycloak'
import { getConfig } from '@/config/env'
import { ensureCsrf } from './csrf'
import { identityFromTokens } from './keycloak'
import { getSession } from './session'

/**
 * Auth.js runs only the Keycloak authorization-code flow (PKCE + state). Its
 * sign-in callback copies the tokens into the encrypted `agentry_session`
 * cookie; Auth.js's own JWT keeps nothing but the subject.
 */
export const { handlers, signIn } = NextAuth(() => {
  const config = getConfig()
  const kc = config.keycloak
  return {
    // Derived from the session secret so no extra variable is needed.
    secret: createHash('sha256').update(`authjs:${config.sessionSecret}`).digest('hex'),
    trustHost: true,
    basePath: '/api/auth',
    session: { strategy: 'jwt' },
    pages: { signIn: '/login', error: '/login' },
    providers: kc
      ? [
          Keycloak({
            issuer: kc.issuer,
            clientId: kc.clientId,
            clientSecret: kc.clientSecret,
            checks: ['pkce', 'state'],
          }),
        ]
      : [],
    callbacks: {
      async signIn({ account }) {
        if (account?.provider !== 'keycloak' || !account.access_token || !account.refresh_token || !account.id_token) {
          return false
        }
        const now = Date.now()
        const expiresAt = account.expires_at
          ? account.expires_at * 1000
          : now + (typeof account.expires_in === 'number' ? account.expires_in : 300) * 1000
        const session = await getSession()
        session.credential = {
          kind: 'keycloak',
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          idToken: account.id_token,
          expiresAt,
        }
        session.identity = identityFromTokens(account.access_token, account.id_token)
        delete session.csrf
        ensureCsrf(session)
        await session.save()
        return true
      },
      jwt({ token }) {
        return { sub: token.sub }
      },
      session({ session }) {
        return { expires: session.expires } as typeof session
      },
    },
  }
})
