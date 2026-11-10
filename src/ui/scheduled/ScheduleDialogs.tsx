'use client'

/**
 * Shared schedule dialogs. Today only the delete confirmation; kept separate so
 * the list and the detail page use the same wording and failure handling.
 */
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { useEffect, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { AgentSchedule } from '@/api/types'
import { goToLogin } from '@/chat/use-conversation'

export function DeleteScheduleDialog({
  schedule,
  onClose,
  onDeleted,
}: {
  schedule: AgentSchedule | null
  onClose(): void
  onDeleted(id: string): void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setError(null), [schedule])

  const remove = async () => {
    if (!schedule) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteSchedule(schedule.id)
      onDeleted(schedule.id)
      onClose()
    } catch (err) {
      if (err instanceof ApiError && isSignedOut(err)) {
        goToLogin()
        return
      }
      setError(err instanceof ApiError ? err.message : 'Could not delete the task.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog
      isOpen={schedule !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Delete task?"
      description={
        error ?? (schedule ? `“${schedule.title}” and its delivery history will be permanently deleted.` : '')
      }
      actionLabel="Delete"
      onAction={() => void remove()}
      isActionLoading={busy}
      cancelLabel="Cancel"
    />
  )
}
