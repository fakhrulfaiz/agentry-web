// Validate configuration once when the Node.js server starts, so a missing or invalid
// variable fails startup with a named ConfigError instead of failing requests later.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateConfigOnStartup } = await import('@/config/startup')
    validateConfigOnStartup()
  }
}
