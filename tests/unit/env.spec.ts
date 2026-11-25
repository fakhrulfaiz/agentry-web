import { describe, expect, it } from 'vitest'
import { ConfigError, loadConfig } from '@/config/env'

const SECRET = 'x'.repeat(32)

const apikeyEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  AGENTRY_WEB_AUTH: 'apikey',
  AGENTRY_API_URL: 'http://localhost:4000',
  AGENTRY_WEB_SESSION_SECRET: SECRET,
}

const keycloakEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  AGENTRY_WEB_AUTH: 'keycloak',
  AGENTRY_API_URL: 'http://localhost:4000',
  AGENTRY_WEB_SESSION_SECRET: SECRET,
  AGENTRY_WEB_KEYCLOAK_ISSUER: 'http://localhost:8080/realms/agentry',
  AGENTRY_WEB_KEYCLOAK_CLIENT_ID: 'agentry-web',
  AGENTRY_WEB_KEYCLOAK_CLIENT_SECRET: 'client-secret',
}

function configError(env: NodeJS.ProcessEnv): ConfigError {
  try {
    loadConfig(env)
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError)
    return err as ConfigError
  }
  throw new Error('expected loadConfig to throw')
}

describe('loadConfig', () => {
  it('accepts a valid apikey env', () => {
    expect(loadConfig(apikeyEnv)).toEqual({
      auth: 'apikey',
      apiUrl: 'http://localhost:4000',
      sessionSecret: SECRET,
      models: [],
      production: false,
      cookieSecure: 'auto',
    })
  })

  it('reads AGENTRY_WEB_COOKIE_SECURE (auto by default, always) and rejects anything else', () => {
    expect(loadConfig({ ...apikeyEnv, AGENTRY_WEB_COOKIE_SECURE: 'always' }).cookieSecure).toBe('always')
    expect(loadConfig({ ...apikeyEnv, AGENTRY_WEB_COOKIE_SECURE: ' ' }).cookieSecure).toBe('auto')
    const err = configError({ ...apikeyEnv, AGENTRY_WEB_COOKIE_SECURE: 'never' })
    expect(err).toMatchObject({ code: 'invalid', variable: 'AGENTRY_WEB_COOKIE_SECURE' })
  })

  it('accepts a valid keycloak env', () => {
    const config = loadConfig({ ...keycloakEnv, NODE_ENV: 'production' })
    expect(config.auth).toBe('keycloak')
    expect(config.keycloak).toEqual({
      issuer: 'http://localhost:8080/realms/agentry',
      clientId: 'agentry-web',
      clientSecret: 'client-secret',
    })
    expect(config.production).toBe(true)
  })

  it('fails with missing AGENTRY_API_URL', () => {
    const { AGENTRY_API_URL: _, ...env } = apikeyEnv
    const err = configError(env)
    expect(err.code).toBe('missing')
    expect(err.variable).toBe('AGENTRY_API_URL')
    expect(err.name).toBe('ConfigError')
    expect(err.message).toContain('AGENTRY_API_URL')
  })

  it('treats an empty value as missing', () => {
    const err = configError({ ...apikeyEnv, AGENTRY_WEB_SESSION_SECRET: '' })
    expect(err).toMatchObject({ code: 'missing', variable: 'AGENTRY_WEB_SESSION_SECRET' })
  })

  it('rejects an unknown AGENTRY_WEB_AUTH', () => {
    const err = configError({ ...apikeyEnv, AGENTRY_WEB_AUTH: 'foo' })
    expect(err).toMatchObject({ code: 'invalid', variable: 'AGENTRY_WEB_AUTH' })
  })

  it('rejects a 31-byte session secret', () => {
    const err = configError({ ...apikeyEnv, AGENTRY_WEB_SESSION_SECRET: 'x'.repeat(31) })
    expect(err).toMatchObject({ code: 'invalid', variable: 'AGENTRY_WEB_SESSION_SECRET' })
  })

  it('measures the session secret in bytes, not characters', () => {
    // 16 two-byte characters = 32 bytes.
    expect(loadConfig({ ...apikeyEnv, AGENTRY_WEB_SESSION_SECRET: 'é'.repeat(16) }).sessionSecret).toBe(
      'é'.repeat(16),
    )
  })

  it('rejects an AGENTRY_API_URL that is not an http(s) URL', () => {
    const err = configError({ ...apikeyEnv, AGENTRY_API_URL: 'localhost:4000' })
    expect(err).toMatchObject({ code: 'invalid', variable: 'AGENTRY_API_URL' })
  })

  it('requires the keycloak client secret in keycloak mode', () => {
    const { AGENTRY_WEB_KEYCLOAK_CLIENT_SECRET: _, ...env } = keycloakEnv
    const err = configError(env)
    expect(err).toMatchObject({ code: 'missing', variable: 'AGENTRY_WEB_KEYCLOAK_CLIENT_SECRET' })
  })

  it('ignores keycloak variables in apikey mode', () => {
    expect(loadConfig({ ...keycloakEnv, AGENTRY_WEB_AUTH: 'apikey' }).keycloak).toBeUndefined()
  })

  it('parses AGENTRY_WEB_MODELS as a trimmed list with empty entries dropped', () => {
    const config = loadConfig({ ...apikeyEnv, AGENTRY_WEB_MODELS: ' deepseek-chat, ,gpt-4o ,, ' })
    expect(config.models).toEqual(['deepseek-chat', 'gpt-4o'])
  })
})
