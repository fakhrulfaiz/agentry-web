'use client'

/**
 * One environment: its status, where it came from, and a file browser (list,
 * download, upload). Deleting it removes its workspace.
 */
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { FileInput } from '@astryxdesign/core/FileInput'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { StackItem } from '@astryxdesign/core/Layout'
import { Link } from '@astryxdesign/core/Link'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { ArrowDownTrayIcon, DocumentIcon } from '@heroicons/react/24/outline'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { EnvironmentFile, SandboxEnvironment } from '@/api/types'
import { goToLogin } from '@/chat/use-conversation'
import { formatBytes, shortDate, statusLook } from './format'

const COLUMN_WIDTH = 880
const WORKSPACE = '/workspace/'
const MAX_UPLOAD = 5 * 1024 * 1024

/** The download URL of an absolute `/workspace/...` path. */
const fileHref = (environmentId: string, path: string, download: boolean): string => {
  const relative = path.startsWith(WORKSPACE) ? path.slice(WORKSPACE.length) : path.replace(/^\/+/u, '')
  const encoded = relative.split('/').map(encodeURIComponent).join('/')
  return `/api/agentry/agents/environments/${encodeURIComponent(environmentId)}/files/${encoded}${download ? '?download' : ''}`
}

/** Base64 of a file's bytes, in chunks so a large file does not overflow the call stack. */
async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function EnvironmentDetail({ environmentId }: { environmentId: string }) {
  const router = useRouter()
  const [env, setEnv] = useState<SandboxEnvironment | null>(null)
  const [files, setFiles] = useState<EnvironmentFile[] | null>(null)
  const [next, setNext] = useState<string | undefined>()
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(async () => {
    try {
      const [environment, page] = await Promise.all([api.getSandboxEnvironment(environmentId), api.listEnvironmentFiles(environmentId)])
      setEnv(environment)
      setFiles(page.data)
      setNext(page.next)
      setError(null)
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      if (err instanceof ApiError && err.status === 404) return setMissing(true)
      setError(err instanceof ApiError ? err.message : 'Could not load this environment.')
      setFiles((cur) => cur ?? [])
    }
  }, [environmentId])
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
      await load()
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setError(err instanceof ApiError ? err.message : 'Could not upload the file.')
    } finally {
      setUploading(false)
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
  const look = env ? statusLook(env.status) : null

  return (
    <div style={{ width: '100%', maxWidth: COLUMN_WIDTH, margin: '0 auto', padding: '24px 16px' }}>
      <VStack gap={4}>
        <Link href="/sandboxes">Sandboxes</Link>
        <HStack gap={3} vAlign="center">
          <StackItem size="fill">
            <Heading level={1} type="display-2" maxLines={1}>{environmentId}</Heading>
          </StackItem>
          <Button label="Delete" variant="destructive" onClick={() => setConfirmDelete(true)} />
        </HStack>
        {env && look && (
          <HStack gap={4} vAlign="center" wrap="wrap">
            <HStack gap={2} vAlign="center"><StatusDot variant={look.variant} label={look.text} /><Text>{look.text}</Text></HStack>
            <Text type="supporting" color="secondary">{env.provider}</Text>
            <Text type="supporting" color="secondary">Created {shortDate(env.created_at)}</Text>
            {env.session_id && <Link href={`/c/${encodeURIComponent(env.session_id)}`}>Open its chat</Link>}
          </HStack>
        )}
        {env?.error && <Banner status="error" title={env.error} />}
        {error !== null && <Banner status="error" title={error} endContent={<Button label="Retry" size="sm" onClick={() => void load()} />} />}

        <FileInput label="Add a file" description={`Saved to ${WORKSPACE}. Up to ${formatBytes(MAX_UPLOAD)}.`} value={picked} onChange={(v) => void upload(Array.isArray(v) ? (v[0] ?? null) : v)} isDisabled={uploading} />

        <VStack gap={1}>
          <Heading level={2}>Files</Heading>
          {files === null ? (
            <Skeleton height={120} />
          ) : files.length === 0 ? (
            <Text type="supporting" color="secondary" role="status">No files yet. Files the agent writes appear here.</Text>
          ) : (
            <ul aria-label="Files" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {files.map((file) => (
                <li key={file.path}>
                  <HStack gap={3} vAlign="center" padding={2}>
                    <Icon icon={DocumentIcon} size="sm" color="secondary" />
                    <StackItem size="fill">
                      <Link href={fileHref(environmentId, file.path, false)} target="_blank">
                        <Text maxLines={1}>{file.path.startsWith(WORKSPACE) ? file.path.slice(WORKSPACE.length) : file.path}</Text>
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
