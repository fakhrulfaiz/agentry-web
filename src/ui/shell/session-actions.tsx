'use client'

/**
 * Chat actions shared by the sidebar rows and the chat title menu: Star /
 * Unstar, the Rename dialog and the Delete confirmation, and the window event
 * that keeps every view of a chat in step.
 *
 * Every change is broadcast as `SESSIONS_CHANGED` on `window`, with the new
 * metadata (or `deleted`) in `detail`; a plain event with no detail means
 * "the list changed, reload it" (a chat was created). Starring is optimistic:
 * the change is broadcast at once, and rolled back with an error toast if
 * Agentry refuses it.
 */
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { HStack } from '@astryxdesign/core/HStack'
import { TextInput } from '@astryxdesign/core/TextInput'
import { useToast } from '@astryxdesign/core/Toast'
import { VStack } from '@astryxdesign/core/VStack'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, isSignedOut, mergeMetadata, STARRED_KEY } from '@/api/client'
import { sessionTitle } from './group'

/** Event dispatched on `window` when a chat was created, renamed, starred or deleted. */
export const SESSIONS_CHANGED = 'agentry:sessions-changed'

export type SessionChange = { id: string; metadata: Record<string, string> } | { id: string; deleted: true }

/** What the actions need to know about a chat. */
export interface SessionRef {
  id: string
  metadata?: Record<string, string> | null
}

/** Broadcasts a chat change (or, with none, asks lists to reload). */
export function announceSessions(change?: SessionChange): void {
  window.dispatchEvent(new CustomEvent<SessionChange | undefined>(SESSIONS_CHANGED, { detail: change }))
}

/** Calls `handler` for each broadcast: the change, or `null` for a plain "reload" event. */
export function useSessionChanges(handler: (change: SessionChange | null) => void): void {
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  })
  useEffect(() => {
    const listen = (event: Event) => {
      const detail = (event as CustomEvent<SessionChange | undefined>).detail
      latest.current(detail && typeof detail === 'object' && typeof detail.id === 'string' ? detail : null)
    }
    window.addEventListener(SESSIONS_CHANGED, listen)
    return () => window.removeEventListener(SESSIONS_CHANGED, listen)
  }, [])
}

export function isStarred(session: { metadata?: Record<string, string> | null }): boolean {
  return session.metadata?.[STARRED_KEY] === 'true'
}

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.'
}

/** Returns `toggle(session)`: stars or unstars it, optimistically. */
export function useStarToggle(): (session: SessionRef) => Promise<void> {
  const toast = useToast()
  return useCallback(
    async (session: SessionRef) => {
      const before = { ...session.metadata }
      const starring = !isStarred(session)
      announceSessions({ id: session.id, metadata: mergeMetadata(before, { [STARRED_KEY]: starring ? 'true' : null }) })
      try {
        const saved = await api.setStarred(session.id, starring)
        announceSessions({ id: session.id, metadata: saved })
      } catch (error) {
        if (isSignedOut(error)) {
          window.location.assign('/login')
          return
        }
        announceSessions({ id: session.id, metadata: before })
        toast({
          type: 'error',
          body: starring ? 'Could not star the chat. Try again.' : 'Could not unstar the chat. Try again.',
          uniqueID: `star-${session.id}`,
        })
      }
    },
    [toast],
  )
}

export function RenameDialog({ session, onClose }: { session: SessionRef | null; onClose(): void }) {
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (session) {
      setTitle(sessionTitle(session))
      setError(null)
    }
  }, [session])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!session || saving) return
    const next = title.trim()
    if (!next) {
      setError('Enter a title.')
      return
    }
    setSaving(true)
    try {
      // The map just saved: it has keys changed since the dialog opened (a star).
      const metadata = await api.renameSession(session.id, next)
      announceSessions({ id: session.id, metadata })
      onClose()
    } catch (e) {
      if (isSignedOut(e)) window.location.assign('/login')
      setError(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog isOpen={session !== null} onOpenChange={(open) => !open && onClose()} purpose="form">
      <DialogHeader title="Rename chat" />
      <form onSubmit={save}>
        <VStack gap={4}>
          <TextInput
            label="Title"
            value={title}
            onChange={(v) => {
              setTitle(v)
              setError(null)
            }}
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

export function DeleteDialog({
  session,
  onClose,
  onDeleted,
}: {
  session: SessionRef | null
  onClose(): void
  onDeleted?(id: string): void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setError(null), [session])

  async function remove() {
    if (!session || busy) return
    setBusy(true)
    try {
      await api.deleteSession(session.id)
      announceSessions({ id: session.id, deleted: true })
      onDeleted?.(session.id)
      onClose()
    } catch (e) {
      if (isSignedOut(e)) window.location.assign('/login')
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const title = session ? sessionTitle(session) : ''
  return (
    <AlertDialog
      isOpen={session !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Delete chat?"
      description={error ?? `“${title}” and its history will be permanently deleted.`}
      actionLabel="Delete"
      onAction={remove}
      isActionLoading={busy}
    />
  )
}
