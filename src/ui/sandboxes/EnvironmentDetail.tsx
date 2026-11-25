'use client'

/**
 * One environment: its status, where it came from, and a file browser (list,
 * download, upload). Deleting it removes its workspace.
 */
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { FileInput } from '@astryxdesign/core/FileInput'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { StackItem } from '@astryxdesign/core/Layout'
import { Link } from '@astryxdesign/core/Link'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Switch } from '@astryxdesign/core/Switch'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { ArrowDownTrayIcon, DocumentIcon } from '@heroicons/react/24/outline'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { EnvironmentFile, SandboxEnvironment } from '@/api/types'
import { goToLogin } from '@/chat/use-conversation'
import { canChatIn, environmentLook, environmentName, formatBytes, lastUsed, providerTitle, shortDate, shortId, toBase64 } from './format'

const COLUMN_WIDTH = 880
const WORKSPACE = '/workspace/'
const MAX_UPLOAD = 5 * 1024 * 1024

/** The download URL of an absolute `/workspace/...` path. */
const fileHref = (environmentId: string, path: string, download: boolean): string => {
  const relative = path.startsWith(WORKSPACE) ? path.slice(WORKSPACE.length) : path.replace(/^\/+/u, '')
  const encoded = relative.split('/').map(encodeURIComponent).join('/')
  return `/api/agentry/agents/environments/${encodeURIComponent(environmentId)}/files/${encoded}${download ? '?download' : ''}`
}

export function EnvironmentDetail({ environmentId }: { environmentId: string }) {
  const router = useRouter()
  const [env, setEnv] = useState<SandboxEnvironment | null>(null)
  const [files, setFiles] = useState<EnvironmentFile[] | null>(null)
  const [next, setNext] = useState<string | undefined>()
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [picked, setPicked] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [keepWorkspace, setKeepWorkspace] = useState(true)
  const [acting, setActing] = useState<'start' | 'stop' | 'reset' | null>(null)

  // The environment and its files load separately: a sandbox lists files slowly, and the header and actions should not wait for it.
  const loadFiles = useCallback(async () => {
    try {
      const page = await api.listEnvironmentFiles(environmentId)
      setFiles(page.data)
      setNext(page.next)
      setFilesError(null)
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setFiles((cur) => cur ?? [])
      setFilesError(err instanceof ApiError ? err.message : 'Could not list the files.')
    }
  }, [environmentId])
  const load = useCallback(async () => {
    void loadFiles()
    try {
      setEnv(await api.getSandboxEnvironment(environmentId))
      setError(null)
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      if (err instanceof ApiError && err.status === 404) return setMissing(true)
      setError(err instanceof ApiError ? err.message : 'Could not load this environment.')
    }
  }, [environmentId, loadFiles])
  useEffect(() => {
    void load()
  }, [load])

  async function more() {
    if (!next) return
    try {
      const page = await api.listEnvironmentFiles(environmentId, next)
      setFiles((cur) => [...(cur ?? []), ...page.data])
      setNext(page.next)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more files.')
    }
  }

  async function upload(file: File | null) {
    setPicked(file)
    if (!file) return
    if (file.size > MAX_UPLOAD) {
      setPicked(null)
      return setError(`${file.name} is larger than ${formatBytes(MAX_UPLOAD)}.`)
    }
    setUploading(true)
    try {
      await api.uploadEnvironmentFile(environmentId, `${WORKSPACE}${file.name}`, await toBase64(file))
      setPicked(null)
      await loadFiles()
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setError(err instanceof ApiError ? err.message : 'Could not upload the file.')
    } finally {
      setUploading(false)
    }
  }

  /** Start, stop or rebuild the sandbox; the answer is the updated environment. */
  async function act(action: 'start' | 'stop' | 'reset') {
    setActing(action)
    setError(null)
    try {
      const updated = action === 'start'
        ? await api.startSandboxEnvironment(environmentId)
        : action === 'stop'
          ? await api.stopSandboxEnvironment(environmentId)
          : await api.resetSandboxEnvironment(environmentId, keepWorkspace)
      setEnv(updated)
      if (action === 'reset') {
        setConfirmReset(false)
        await load()
      }
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setConfirmReset(false)
      setError(err instanceof ApiError ? err.message : `Could not ${action} the environment.`)
    } finally {
      setActing(null)
    }
  }

  async function remove() {
    try {
      await api.deleteSandboxEnvironment(environmentId)
      router.push('/sandboxes')
    } catch (err) {
      setConfirmDelete(false)
      setError(err instanceof ApiError ? err.message : 'Could not delete the environment.')
    }
  }

  if (missing) {
    return (
      <div style={{ width: '100%', maxWidth: COLUMN_WIDTH, margin: '0 auto', padding: '24px 16px' }}>
        <EmptyState title="This environment no longer exists." description="It may have been deleted." actions={<Button label="Back to sandboxes" onClick={() => router.push('/sandboxes')} />} />
      </div>
    )
  }
  // Dot-folders (tool caches, .git) hide by default so the agent's own files are easy to find.
  const relative = (path: string) => (path.startsWith(WORKSPACE) ? path.slice(WORKSPACE.length) : path.replace(/^\/+/u, ''))
  const isHidden = (path: string) => relative(path).split('/').some((seg) => seg.startsWith('.'))
  const hiddenCount = files?.filter((f) => isHidden(f.path)).length ?? 0
  const shown = files?.filter((f) => showHidden || !isHidden(f.path)) ?? null
  const look = env ? environmentLook(env) : null
  const state = env?.sandbox?.state
  const used = lastUsed(env?.sandbox?.last_used_at)

  return (
    <div style={{ width: '100%', maxWidth: COLUMN_WIDTH, margin: '0 auto', padding: '24px 16px' }}>
      <VStack gap={5}>
        <Link href="/sandboxes">Sandboxes</Link>
        <VStack gap={3}>
          <HStack gap={3} vAlign="center" wrap="wrap">
            <StackItem size="fill">
              <VStack gap={1}>
                {env ? <Heading level={1} type="display-2" maxLines={1}>{environmentName(env)}</Heading> : <Skeleton width={280} height={36} />}
                {env && look && (
                  <HStack gap={3} vAlign="center" wrap="wrap">
                    <HStack gap={1.5} vAlign="center"><StatusDot variant={look.variant} label={look.text} /><Text weight="medium">{look.text}</Text></HStack>
                    <Text type="supporting" color="secondary">{providerTitle(env.provider)}</Text>
                    {env.sandbox?.image && <Text type="supporting" color="secondary">{env.sandbox.image}</Text>}
                    <Text type="supporting" color="secondary">{used ?? `Created ${shortDate(env.created_at)}`}</Text>
                    <Text type="supporting" color="secondary">{shortId(env.id)}</Text>
                  </HStack>
                )}
              </VStack>
            </StackItem>
            {env && canChatIn(env) && <Button label="New chat here" variant="primary" onClick={() => router.push(`/?environment=${encodeURIComponent(environmentId)}`)} />}
          </HStack>
          {env && (
            <HStack gap={2} vAlign="center" wrap="wrap" role="group" aria-label="Environment actions">
              {state === 'stopped' && <Button label="Start" size="sm" isLoading={acting === 'start'} isDisabled={acting !== null} onClick={() => void act('start')} />}
              {state === 'running' && <Button label="Stop" size="sm" isLoading={acting === 'stop'} isDisabled={acting !== null} onClick={() => void act('stop')} />}
              {state !== undefined && state !== 'gone' && <Button label="Reset" size="sm" isDisabled={acting !== null} onClick={() => setConfirmReset(true)} />}
              {env.session_id && <Button label="Open its chat" size="sm" variant="ghost" onClick={() => router.push(`/c/${encodeURIComponent(env.session_id!)}`)} />}
              <StackItem size="fill">{null}</StackItem>
              <Button label="Delete environment" size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} />
            </HStack>
          )}
        </VStack>
        {env?.error && <Banner status="error" title={env.error} />}
        {state === 'unknown' && <Banner status="warning" title="Agentry Sandbox is not answering, so this environment's state is unknown." />}
        {state === 'gone' && <Banner status="error" title="This sandbox no longer exists in Agentry Sandbox. Delete the environment and create a new one." />}
        {error !== null && <Banner status="error" title={error} endContent={<Button label="Retry" size="sm" onClick={() => void load()} />} />}

        <VStack gap={2}>
          <HStack gap={3} vAlign="end" wrap="wrap">
            <StackItem size="fill"><Heading level={2}>Files</Heading></StackItem>
            {hiddenCount > 0 && (
              <Button label={showHidden ? 'Hide hidden files' : `Show ${hiddenCount} hidden ${hiddenCount === 1 ? 'file' : 'files'}`} size="sm" variant="ghost" onClick={() => setShowHidden((v) => !v)} />
            )}
          </HStack>
          <FileInput label="Add a file" isLabelHidden description={`Upload into the workspace, up to ${formatBytes(MAX_UPLOAD)}.`} value={picked} onChange={(v) => void upload(Array.isArray(v) ? (v[0] ?? null) : v)} isDisabled={uploading || state === 'gone'} />
          {filesError !== null && <Banner status="warning" title={filesError} endContent={<Button label="Retry" size="sm" onClick={() => void loadFiles()} />} />}
          {shown === null ? (
            <Skeleton height={120} />
          ) : shown.length === 0 ? (
            <Text type="supporting" color="secondary" role="status">{hiddenCount > 0 ? 'Only hidden files so far.' : 'No files yet. Files the agent writes appear here.'}</Text>
          ) : (
            <ul aria-label="Files" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {shown.map((file) => (
                <li key={file.path}>
                  <HStack gap={3} vAlign="center" padding={2}>
                    <Icon icon={DocumentIcon} size="sm" color="secondary" />
                    <StackItem size="fill">
                      <Link href={fileHref(environmentId, file.path, false)} target="_blank">
                        <Text maxLines={1}>{relative(file.path)}</Text>
                      </Link>
                    </StackItem>
                    <Text type="supporting" color="secondary">{formatBytes(file.size_bytes)}</Text>
                    <Link href={fileHref(environmentId, file.path, true)} aria-label={`Download ${file.path}`}>
                      <Icon icon={ArrowDownTrayIcon} size="sm" />
                    </Link>
                  </HStack>
                </li>
              ))}
            </ul>
          )}
          {next !== undefined && <Button label="Show more files" onClick={() => void more()} />}
        </VStack>
      </VStack>
      <Dialog isOpen={confirmReset} onOpenChange={(open: boolean) => { setConfirmReset(open); if (!open) setKeepWorkspace(true) }} purpose="form" width={440}>
        <DialogHeader title="Reset this environment?" onOpenChange={(open: boolean) => { setConfirmReset(open); if (!open) setKeepWorkspace(true) }} />
        <VStack gap={3} padding={4}>
          <Text>
            {keepWorkspace
              ? 'The sandbox is rebuilt from its template: installed software and anything outside the workspace are lost. Workspace files are kept.'
              : 'The sandbox is rebuilt from its template and every workspace file is deleted.'}
          </Text>
          <Switch label="Keep workspace files" value={keepWorkspace} onChange={setKeepWorkspace} />
          <HStack gap={2} hAlign="end">
            <Button label="Cancel" onClick={() => setConfirmReset(false)} />
            <Button label={keepWorkspace ? 'Reset, keep files' : 'Reset and delete files'} variant="destructive" isLoading={acting === 'reset'} onClick={() => void act('reset')} />
          </HStack>
        </VStack>
      </Dialog>
      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this environment?"
        description="Its workspace and every file in it are removed. Chats that used it keep their history."
        actionLabel="Delete environment"
        onAction={() => void remove()}
      />
    </div>
  )
}
