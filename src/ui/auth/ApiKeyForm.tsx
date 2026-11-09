'use client'

import { Button } from '@astryxdesign/core/Button'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { useState, type FormEvent } from 'react'

const MESSAGES: Record<string, string> = {
  invalid_key: 'Agentry rejected this API key.',
  invalid_request: 'Enter an API key.',
}

/** apikey sign-in: posts the key to the BFF, which keeps it server-side. */
export function ApiKeyForm() {
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    if (!key.trim()) {
      setError(MESSAGES.invalid_request)
      return
    }
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/apikey', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key }),
        redirect: 'manual',
      })
      if (res.type === 'opaqueredirect' || res.ok) {
        setKey('')
        window.location.assign('/')
        return
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setError(MESSAGES[body?.error ?? ''] ?? 'Sign-in failed. Try again.')
    } catch {
      setError('Agentry is unreachable. Try again.')
    }
    setPending(false)
  }

  return (
    <form onSubmit={submit} noValidate>
      <VStack gap={4}>
        <TextInput
          label="API key"
          type="password"
          htmlName="key"
          value={key}
          onChange={(value) => {
            setKey(value)
            setError(null)
          }}
          hasAutoFocus
          isRequired
          status={error ? { type: 'error', message: error } : undefined}
          statusVariant="detached"
        />
        <Button type="submit" variant="primary" label="Sign in" width="100%" isLoading={pending} />
      </VStack>
    </form>
  )
}
