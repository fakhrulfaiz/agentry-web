'use client'

/** Small, non-interactive chat header chip that names the chat's environment and its live state. */
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Token } from '@astryxdesign/core/Token'
import { useEffect, useRef, useState } from 'react'
import { api, type ApiError } from '@/api/client'
import type { OAIEnvironmentConfig, SandboxEnvironment } from '@/api/types'
import { environmentChip, sandboxEnvironmentId } from '@/ui/chat/environment-chip'

export function ChatEnvironmentChip({ environment }: { environment: OAIEnvironmentConfig | undefined }): React.JSX.Element {
  const id = sandboxEnvironmentId(environment)
  const [env, setEnv] = useState<SandboxEnvironment | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const currentIdRef = useRef<string | undefined>(id)

  useEffect(() => {
    currentIdRef.current = id
    if (!id) {
      setEnv(null)
      setError(null)
      return
    }

    setEnv(null)
    setError(null)
    const refresh = () => {
      void api.getSandboxEnvironment(id).then(
        (loaded) => {
          if (currentIdRef.current === id) {
            setEnv(loaded)
            setError(null)
          }
        },
        (failure: ApiError) => {
          if (currentIdRef.current === id) {
            setEnv(null)
            setError(failure)
          }
        },
      )
    }
    const onFocus = () => { refresh() }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    refresh()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      currentIdRef.current = undefined
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [id])

  const chip = environmentChip(environment, env, error)
  return (
    <Token
      label={chip.label}
      size="sm"
      icon={<StatusDot variant={chip.variant} label={chip.label} tooltip={chip.description} />}
      description={chip.description}
    />
  )
}
