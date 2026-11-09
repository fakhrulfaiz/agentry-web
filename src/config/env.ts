import 'server-only'

export type AuthMode = 'keycloak' | 'apikey'

export interface WebConfig {
  auth: AuthMode
  /** Agentry API base URL. Server-only; never sent to the browser. */
  apiUrl: string
  sessionSecret: string
  keycloak?: { issuer: string; clientId: string; clientSecret: string }
  /** Configured model ids from `AGENTRY_WEB_MODELS`; the first is the default. Empty when unset. */
  models: string[]
  production: boolean
}

export class ConfigError extends Error {
  readonly code: 'missing' | 'invalid'
  readonly variable: string

  constructor(code: 'missing' | 'invalid', variable: string, detail?: string) {
    super(
      code === 'missing'
        ? `Missing required environment variable ${variable}`
        : `Invalid environment variable ${variable}${detail ? `: ${detail}` : ''}`,
    )
    this.name = 'ConfigError'
    this.code = code
    this.variable = variable
  }
}

const AUTH_MODES: readonly AuthMode[] = ['keycloak', 'apikey']
const MIN_SECRET_BYTES = 32

function required(env: NodeJS.ProcessEnv, variable: string): string {
  const value = env[variable]?.trim()
  if (!value) throw new ConfigError('missing', variable)
  return value
}

function httpUrl(env: NodeJS.ProcessEnv, variable: string): string {
  const value = required(env, variable)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ConfigError('invalid', variable, 'expected an absolute http(s) URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError('invalid', variable, 'expected an absolute http(s) URL')
  }
  return value
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

export function loadConfig(env: NodeJS.ProcessEnv): WebConfig {
  const auth = required(env, 'AGENTRY_WEB_AUTH')
  if (!AUTH_MODES.includes(auth as AuthMode)) {
    throw new ConfigError('invalid', 'AGENTRY_WEB_AUTH', `expected one of ${AUTH_MODES.join(', ')}`)
  }

  const apiUrl = httpUrl(env, 'AGENTRY_API_URL')

  const sessionSecret = env.AGENTRY_WEB_SESSION_SECRET ?? ''
  if (!sessionSecret.trim()) throw new ConfigError('missing', 'AGENTRY_WEB_SESSION_SECRET')
  if (Buffer.byteLength(sessionSecret, 'utf8') < MIN_SECRET_BYTES) {
    throw new ConfigError('invalid', 'AGENTRY_WEB_SESSION_SECRET', `must be at least ${MIN_SECRET_BYTES} bytes`)
  }

  const config: WebConfig = {
    auth: auth as AuthMode,
    apiUrl,
    sessionSecret,
    models: list(env.AGENTRY_WEB_MODELS),
    production: env.NODE_ENV === 'production',
  }

  if (config.auth === 'keycloak') {
    config.keycloak = {
      issuer: httpUrl(env, 'AGENTRY_WEB_KEYCLOAK_ISSUER'),
      clientId: required(env, 'AGENTRY_WEB_KEYCLOAK_CLIENT_ID'),
      clientSecret: required(env, 'AGENTRY_WEB_KEYCLOAK_CLIENT_SECRET'),
    }
  }

  return config
}

let cached: WebConfig | undefined

/** Memoized `loadConfig(process.env)`. Server-only. */
export function getConfig(): WebConfig {
  cached ??= loadConfig(process.env)
  return cached
}
