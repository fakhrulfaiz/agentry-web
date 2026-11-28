import type { ApiError } from '@/api/client'
import type { OAIEnvironmentConfig, SandboxEnvironment } from '@/api/types'
import { environmentLook, environmentName, providerTitle, shortId } from '@/ui/sandboxes/format'

/** The label, dot variant and accessible detail shown by the chat header's environment chip. */
export type EnvironmentChip = {
  label: string
  variant: 'success' | 'warning' | 'error' | 'neutral'
  description: string
}

/** The sandbox id in a session's environment config, if this chat runs in a sandbox. */
export function sandboxEnvironmentId(environment: OAIEnvironmentConfig | undefined): string | undefined {
  if (environment?.type !== 'sandbox') return undefined
  const id = environment.environment_id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/** Turns the session config and its (possibly missing) environment resource into chip text. */
export function environmentChip(
  environment: OAIEnvironmentConfig | undefined,
  env: SandboxEnvironment | null | undefined,
  error?: ApiError | null,
): EnvironmentChip {
  const id = sandboxEnvironmentId(environment)
  if (!id) return { label: 'Server', variant: 'neutral', description: 'Runs on this server, not in a sandbox' }

  if (!env) {
    if (error?.status === 404) {
      return { label: 'Removed sandbox', variant: 'neutral', description: 'This chat’s sandbox no longer exists' }
    }
    if (error) {
      return { label: 'Sandbox', variant: 'neutral', description: `Could not load sandbox details (${shortId(id)})` }
    }
    return { label: 'Sandbox', variant: 'neutral', description: 'Loading sandbox details…' }
  }

  const look = environmentLook(env)
  return {
    label: `${environmentName(env)} · ${look.text}`,
    variant: look.variant,
    description: `${providerTitle(env.provider)} · ${look.text}`,
  }
}
