import { ConfigError, getConfig } from './env'

/**
 * Called from instrumentation.ts when the Node.js server starts. A missing or invalid
 * variable logs the named ConfigError and exits, instead of serving 500s on every request.
 */
export function validateConfigOnStartup(): void {
  try {
    getConfig()
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err
    console.error(`${err.name} (${err.code} ${err.variable}): ${err.message}`)
    process.exit(1)
  }
}
