'use client'

/**
 * The Snapshots tab of an environment: save a snapshot (one camera button and a
 * small dialog), list them, and restore, start a new environment from, or
 * delete one. The list polls while any snapshot is still being saved.
 */
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { FileInput } from '@astryxdesign/core/FileInput'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { StackItem } from '@astryxdesign/core/Layout'
import { MoreMenu } from '@astryxdesign/core/MoreMenu'
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { ArrowDownTrayIcon, ArrowUpTrayIcon, CameraIcon } from '@heroicons/react/24/outline'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { EnvironmentSnapshot, SandboxEnvironment, SnapshotLevel } from '@/api/types'
import { goToLogin } from '@/chat/use-conversation'
import { formatBytes } from './format'
import { ago } from './overview'
import { anySaving, LEVEL_ORDER, levelChoice, levelShort, restoreWarning } from './snapshots'

const POLL_MS = 2000
const MAX_NAME = 80

const message = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)

function SaveDialog({ environmentId, levels, isOpen, onClose, onSaved }: {
  environmentId: string
  levels: readonly SnapshotLevel[]
  isOpen: boolean
  onClose(): void
  onSaved(snapshot: EnvironmentSnapshot): void
}) {
  const [name, setName] = useState('')
  const [level, setLevel] = useState<SnapshotLevel>('workspace')
  const [stopFirst, setStopFirst] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const offered = LEVEL_ORDER.filter((l) => levels.includes(l))

  useEffect(() => {
    if (!isOpen) return
    setName('')
    setLevel(offered.includes('workspace') ? 'workspace' : (offered[0] ?? 'workspace'))
    setStopFirst(false)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving || offered.length === 0) return
    if (name.trim().length > MAX_NAME) return setError(`Use at most ${String(MAX_NAME)} characters.`)
    setSaving(true)
    try {
      onSaved(await api.saveEnvironmentSnapshot(environmentId, { ...(name.trim() ? { name: name.trim() } : {}), level, stopFirst: level !== 'workspace' && stopFirst }))
      onClose()
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setError(message(err, 'Could not save the snapshot.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={(open: boolean) => !open && onClose()} purpose="form" width={480}>
      <DialogHeader title="Save snapshot" onOpenChange={(open: boolean) => !open && onClose()} />
      <form onSubmit={(e) => void save(e)}>
        <VStack gap={4} padding={4}>
          {offered.length === 0 ? (
            <Banner status="info" title="Snapshots are not set up on this service." />
          ) : (
            <>
              <TextInput label="Name" isOptional placeholder="Before the refactor" value={name} onChange={(v) => { setName(v); setError(null) }} hasAutoFocus />
              <RadioList label="What to keep" value={level} onChange={(v) => setLevel(v as SnapshotLevel)}>
                {offered.map((l) => <RadioListItem key={l} value={l} label={levelChoice[l].label} description={levelChoice[l].description} />)}
              </RadioList>
              {level !== 'workspace' && <CheckboxInput label="Stop the sandbox while saving" value={stopFirst} onChange={setStopFirst} />}
            </>
          )}
          {error !== null && <Banner status="error" title={error} />}
          <HStack gap={2} hAlign="end">
            <Button label="Cancel" variant="ghost" onClick={onClose} />
            <Button label="Save snapshot" variant="primary" type="submit" isLoading={saving} isDisabled={offered.length === 0} />
          </HStack>
        </VStack>
      </form>
    </Dialog>
  )
}

function UploadDialog({ isOpen, onClose, onUploaded }: { isOpen: boolean; onClose(): void; onUploaded(snapshot: EnvironmentSnapshot): void }) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = progress !== null

  useEffect(() => {
    if (isOpen) { setFile(null); setName(''); setProgress(null); setError(null) }
  }, [isOpen])

  async function upload(event: FormEvent) {
    event.preventDefault()
    if (!file || busy) return
    if (name.trim().length > MAX_NAME) return setError(`Use at most ${String(MAX_NAME)} characters.`)
    setError(null)
    setProgress(0)
    try {
      const snap = await api.importEnvironmentSnapshot(file, { ...(name.trim() ? { name: name.trim() } : {}), onProgress: setProgress })
      onUploaded(snap)
      onClose()
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setError(message(err, 'Could not upload the snapshot.'))
    } finally {
      setProgress(null)
    }
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={(open: boolean) => !open && !busy && onClose()} purpose="form" width={460}>
      <DialogHeader title="Upload snapshot" subtitle="A .tar.gz of workspace files, such as one you downloaded." onOpenChange={(open: boolean) => !open && !busy && onClose()} />
      <form onSubmit={(e) => void upload(e)}>
        <VStack gap={4} padding={4}>
          <FileInput label="Archive" accept=".tar.gz,.tgz,.tar,application/gzip,application/x-tar" value={file} onChange={(v) => { setFile(Array.isArray(v) ? (v[0] ?? null) : v); setError(null) }} isDisabled={busy} />
          <TextInput label="Name" isOptional placeholder="Before the refactor" value={name} onChange={(v) => { setName(v); setError(null) }} isDisabled={busy} />
          {busy && <ProgressBar label="Uploading" value={Math.round(progress * 100)} />}
          {error !== null && <Banner status="error" title={error} />}
          <HStack gap={2} hAlign="end">
            <Button label="Cancel" variant="ghost" onClick={onClose} isDisabled={busy} />
            <Button label="Upload" variant="primary" type="submit" isLoading={busy} isDisabled={!file} />
          </HStack>
        </VStack>
      </form>
    </Dialog>
  )
}

export function NewFromDialog({ snapshot, onClose, onCreated }: { snapshot: EnvironmentSnapshot | null; onClose(): void; onCreated(): void }) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (snapshot) { setName(''); setError(null) }
  }, [snapshot])

  async function create(event: FormEvent) {
    event.preventDefault()
    if (!snapshot || creating) return
    setCreating(true)
    try {
      await api.createSandboxEnvironment({ provider: 'sandbox', snapshotId: snapshot.id, ...(snapshot.level !== 'workspace' ? { place: snapshot.place } : {}), ...(name.trim() ? { name: name.trim() } : {}) })
      onClose()
      onCreated()
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setError(message(err, 'Could not create the environment.'))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog isOpen={snapshot !== null} onOpenChange={(open: boolean) => !open && onClose()} purpose="form" width={440}>
      <DialogHeader title="New environment from snapshot" subtitle={snapshot ? `Starting from ${snapshot.name}` : undefined} onOpenChange={(open: boolean) => !open && onClose()} />
      <form onSubmit={(e) => void create(e)}>
        <VStack gap={4} padding={4}>
          <TextInput label="Name" isOptional placeholder="Data analysis" value={name} onChange={setName} hasAutoFocus />
          {error !== null && <Banner status="error" title={error} />}
          <HStack gap={2} hAlign="end">
            <Button label="Cancel" variant="ghost" onClick={onClose} />
            <Button label="Create environment" variant="primary" type="submit" isLoading={creating} />
          </HStack>
        </VStack>
      </form>
    </Dialog>
  )
}

export function SnapshotList({ label, snaps, onRestore, onNewFrom, onDelete }: {
  label: string
  snaps: readonly EnvironmentSnapshot[]
  /** Omit where there is no environment to restore into. */
  onRestore?(snap: EnvironmentSnapshot): void
  onNewFrom(snap: EnvironmentSnapshot): void
  onDelete(snap: EnvironmentSnapshot): void
}) {
  return (
    <ul aria-label={label} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {snaps.map((snap) => {
        const items = snap.state === 'ready'
          ? [
              ...(onRestore ? [{ label: 'Restore', onClick: () => onRestore(snap) }] : []),
              { label: 'New environment from this snapshot', onClick: () => onNewFrom(snap) },
              { type: 'divider' as const },
              { label: 'Delete', variant: 'destructive' as const, onClick: () => onDelete(snap) },
            ]
          : snap.state === 'failed'
            ? [{ label: 'Delete', variant: 'destructive' as const, onClick: () => onDelete(snap) }]
            : []
        return (
          <li key={snap.id}>
            <HStack gap={3} vAlign="center" padding={2}>
              <StackItem size="fill">
                <VStack gap={0.5}>
                  <Text weight="medium" maxLines={1}>{snap.name}</Text>
                  {snap.state === 'failed' && <Text type="supporting" color="secondary">{snap.error ?? 'Saving failed.'}</Text>}
                </VStack>
              </StackItem>
              <Text type="supporting" color="secondary">{levelShort[snap.level]}</Text>
              {snap.size_bytes !== null && <Text type="supporting" color="secondary">{formatBytes(snap.size_bytes)}</Text>}
              <Text type="supporting" color="secondary">{ago(snap.created_at)}</Text>
              {snap.state === 'saving' && (
                <HStack gap={1} vAlign="center"><Spinner size="sm" /><Text type="supporting">Saving…</Text></HStack>
              )}
              {snap.state === 'failed' && <Text type="supporting" color="secondary">Failed</Text>}
              {snap.state === 'ready' && snap.level === 'workspace' && snap.place === 'service' && (
                <IconButton label={`Download ${snap.name}`} tooltip="Download" size="sm" variant="ghost" icon={<Icon icon={ArrowDownTrayIcon} />} href={api.snapshotDownloadUrl(snap.id)} />
              )}
              {items.length > 0 && <MoreMenu label={`More options for ${snap.name}`} size="sm" alignment="end" items={items} />}
            </HStack>
          </li>
        )
      })}
    </ul>
  )
}

export function SnapshotsPanel({ environmentId, levels, canSave, onRestored, onNewEnvironment, onCount }: {
  environmentId: string
  /** The levels this sandbox's place can take. */
  levels: readonly SnapshotLevel[]
  /** False while the sandbox is not in a state that can be snapshotted. */
  canSave: boolean
  onRestored(env: SandboxEnvironment): void
  /** A new environment was started from a snapshot. */
  onNewEnvironment(): void
  onCount?(count: number): void
}) {
  const [snaps, setSnaps] = useState<EnvironmentSnapshot[] | null>(null)
  // Snapshots with no environment: uploaded ones and those whose environment was deleted. Any of them can be restored here.
  const [others, setOthers] = useState<EnvironmentSnapshot[]>([])
  const [uploadOpen, setUploadOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [restoring, setRestoring] = useState<EnvironmentSnapshot | null>(null)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [deleting, setDeleting] = useState<EnvironmentSnapshot | null>(null)
  const [newFrom, setNewFrom] = useState<EnvironmentSnapshot | null>(null)

  const load = useCallback(async () => {
    try {
      const [page, all] = await Promise.all([
        api.listEnvironmentSnapshots(environmentId),
        api.listAllEnvironmentSnapshots().catch((err: unknown) => { if (isSignedOut(err)) throw err; return null }),
      ])
      if (all) setOthers(all.data.filter((x) => x.environment_id === null))
      setSnaps(page.data)
      onCount?.(page.data.length)
      setError(null)
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setSnaps((cur) => cur ?? [])
      setError(message(err, 'Could not load the snapshots.'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environmentId])
  useEffect(() => { void load() }, [load])

  const saving = snaps !== null && (anySaving(snaps) || anySaving(others))
  useEffect(() => {
    if (!saving) return
    const timer = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(timer)
  }, [saving, load])

  async function restore() {
    const snap = restoring
    if (!snap) return
    setRestoreBusy(true)
    try {
      onRestored(await api.restoreEnvironmentSnapshot(environmentId, snap.id))
      setError(null)
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setError(message(err, 'Could not restore the snapshot.'))
    } finally {
      setRestoreBusy(false)
      setRestoring(null)
    }
  }

  async function remove() {
    const snap = deleting
    if (!snap) return
    setDeleting(null)
    try {
      await api.deleteEnvironmentSnapshot(snap.id)
      await load()
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setError(message(err, 'Could not delete the snapshot.'))
    }
  }

  const noLevels = levels.length === 0
  return (
    <VStack gap={3}>
      <HStack gap={2} vAlign="center">
        <StackItem size="fill" />
        <IconButton
          label="Upload snapshot"
          tooltip="Upload snapshot"
          size="sm"
          variant="ghost"
          icon={<Icon icon={ArrowUpTrayIcon} />}
          onClick={() => setUploadOpen(true)}
        />
        <IconButton
          label="Save snapshot"
          tooltip={noLevels ? 'Snapshots are not set up on this service.' : 'Save snapshot'}
          size="sm"
          variant="ghost"
          icon={<Icon icon={CameraIcon} />}
          isDisabled={!canSave || noLevels}
          onClick={() => setSaveOpen(true)}
        />
      </HStack>
      {error !== null && <Banner status="error" title={error} endContent={<Button label="Retry" size="sm" onClick={() => void load()} />} />}
      {snaps === null ? (
        <Skeleton height={96} />
      ) : snaps.length === 0 ? (
        <EmptyState title="No snapshots yet." description="Save one before a risky change." />
      ) : (
        <SnapshotList label="Snapshots" snaps={snaps} onRestore={setRestoring} onNewFrom={setNewFrom} onDelete={setDeleting} />
      )}
      {others.length > 0 && (
        <VStack gap={1}>
          <Text type="supporting" color="secondary" weight="medium">Uploaded and from deleted environments</Text>
          <SnapshotList label="Uploaded snapshots" snaps={others} onRestore={setRestoring} onNewFrom={setNewFrom} onDelete={setDeleting} />
        </VStack>
      )}
      <UploadDialog isOpen={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={(snap) => setOthers((cur) => [snap, ...cur])} />
      <SaveDialog
        environmentId={environmentId}
        levels={levels}
        isOpen={saveOpen}
        onClose={() => setSaveOpen(false)}
        onSaved={(snap) => { setSnaps((cur) => [snap, ...(cur ?? [])]); onCount?.((snaps?.length ?? 0) + 1) }}
      />
      <NewFromDialog snapshot={newFrom} onClose={() => setNewFrom(null)} onCreated={onNewEnvironment} />
      <AlertDialog
        isOpen={restoring !== null}
        onOpenChange={(open: boolean) => !open && !restoreBusy && setRestoring(null)}
        title={`Restore ${restoring?.name ?? 'this snapshot'}?`}
        description={restoring ? restoreWarning(restoring.level) : ''}
        actionLabel="Restore"
        onAction={() => void restore()}
      />
      <AlertDialog
        isOpen={deleting !== null}
        onOpenChange={(open: boolean) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'this snapshot'}?`}
        description="This cannot be undone."
        actionLabel="Delete snapshot"
        onAction={() => void remove()}
      />
    </VStack>
  )
}
