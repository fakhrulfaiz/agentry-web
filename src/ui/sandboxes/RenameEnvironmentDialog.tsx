'use client'

/** Renames an environment (the list card menu and the detail page); an empty name clears it. */
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { HStack } from '@astryxdesign/core/HStack'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { type FormEvent, useEffect, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { SandboxEnvironment } from '@/api/types'
import { goToLogin } from '@/chat/use-conversation'

const MAX_NAME = 80

export function RenameEnvironmentDialog({
  environment,
  onClose,
  onRenamed,
}: {
  environment: SandboxEnvironment | null
  onClose(): void
  onRenamed(updated: SandboxEnvironment): void
}) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!environment) return
    setName(environment.name ?? '')
    setError(null)
  }, [environment])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!environment || saving) return
    const next = name.trim()
    if (next.length > MAX_NAME) return setError(`Use at most ${String(MAX_NAME)} characters.`)
    setSaving(true)
    try {
      onRenamed(await api.renameSandboxEnvironment(environment.id, next))
      onClose()
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setError(err instanceof ApiError ? err.message : 'Could not rename the environment.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog isOpen={environment !== null} onOpenChange={(open: boolean) => !open && onClose()} purpose="form" width={440}>
      <DialogHeader title="Rename environment" onOpenChange={(open: boolean) => !open && onClose()} />
      <form onSubmit={(e) => void save(e)}>
        <VStack gap={4} padding={4}>
          <TextInput
            label="Name"
            placeholder="Data analysis"
            description="Leave it empty to show the environment's id instead."
            value={name}
            onChange={(v) => { setName(v); setError(null) }}
            hasAutoFocus
            status={error ? { type: 'error', message: error } : undefined}
            statusVariant="detached"
          />
          <HStack gap={2} hAlign="end">
            <Button label="Cancel" variant="ghost" onClick={onClose} />
            <Button label="Save" variant="primary" type="submit" isLoading={saving} />
          </HStack>
        </VStack>
      </form>
    </Dialog>
  )
}
