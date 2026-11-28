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
import { IconButton } from '@astryxdesign/core/IconButton'
import { Link } from '@astryxdesign/core/Link'
import { MoreMenu } from '@astryxdesign/core/MoreMenu'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { Token } from '@astryxdesign/core/Token'
import { colorVars, radiusVars } from '@astryxdesign/core/theme/tokens.stylex'
import * as stylex from '@stylexjs/stylex'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Switch } from '@astryxdesign/core/Switch'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { ArrowDownTrayIcon, ArrowUpTrayIcon, ChatBubbleLeftEllipsisIcon, EyeIcon, EyeSlashIcon, PencilIcon, PlayIcon, StopIcon } from '@heroicons/react/24/outline'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { EnvironmentFile, SandboxEnvironment, SandboxPlace, SandboxTemplate } from '@/api/types'
import { goToLogin } from '@/chat/use-conversation'
import { Terminal } from '@/ui/terminal/Terminal'
import { sessionTitle } from '@/ui/shell/group'
import { FileTree } from '@/ui/preview/FileTree'
import { CopyButton } from '@/ui/shared/CopyButton'
import { DefinitionRow } from '@/ui/shared/DefinitionRow'
import { buildTree } from '@/preview/tree'
import { RenameEnvironmentDialog } from './RenameEnvironmentDialog'
import { ago, cardName, statusLine, templateFacts } from './overview'
import { useEnvironmentChats } from './use-environment-chats'
import { canChatIn, formatBytes, gpuLabel, providerTitle, setupProgressText, shortDate, shortId, toBase64 } from './format'

const COLUMN_WIDTH = 1100
const WORKSPACE = '/workspace/'
const MAX_UPLOAD = 5 * 1024 * 1024

/** What went wrong listing files, in the three cases that need different next steps. */
type FilesProblem = 'not-running' | 'unreachable' | 'other'
const classifyFilesError = (err: unknown): FilesProblem => {
  if (!(err instanceof ApiError)) return 'unreachable'
  if (/not running|not started|stopped/iu.test(err.message)) return 'not-running'
  if ([502, 503, 504].includes(err.status) || /unreachable|not answering|network|timed? ?out|unavailable/iu.test(`${err.code} ${err.message}`)) return 'unreachable'
  return 'other'
}

/** The download URL of an absolute `/workspace/...` path. */
const fileHref = (environmentId: string, path: string, download: boolean): string => {
  const relative = path.startsWith(WORKSPACE) ? path.slice(WORKSPACE.length) : path.replace(/^\/+/u, '')
  const encoded = relative.split('/').map(encodeURIComponent).join('/')
  return `/api/agentry/agents/environments/${encodeURIComponent(environmentId)}/files/${encoded}${download ? '?download' : ''}`
}

const layout = stylex.create({
  columns: {
    display: 'grid',
    gap: 24,
    alignItems: 'start',
    gridTemplateColumns: { default: 'minmax(0, 1fr)', '@media (min-width: 1024px)': 'minmax(0, 1fr) 300px' },
  },
  about: { gridColumn: 1, gridRow: { default: 1, '@media (min-width: 1024px)': 1 }, '@media (min-width: 1024px)': { gridColumn: 2 } },
  main: { gridColumn: 1, gridRow: { default: 2, '@media (min-width: 1024px)': 1 }, minWidth: 0 },
  aboutBox: { padding: 16, borderWidth: 1, borderStyle: 'solid', borderColor: colorVars['--color-border'], borderRadius: radiusVars['--radius-container'] },
})

const SETTLING_POLL_MS = 3000
/** A sandbox the server is still creating: nothing can start, stop or list files yet. */
const isSettingUp = (env: SandboxEnvironment): boolean => env.status === 'pending' || env.sandbox?.state === 'provisioning'

export function EnvironmentDetail({ environmentId }: { environmentId: string }) {
  const router = useRouter()
  const [env, setEnv] = useState<SandboxEnvironment | null>(null)
  const [files, setFiles] = useState<EnvironmentFile[] | null>(null)
  const [next, setNext] = useState<string | undefined>()
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filesError, setFilesError] = useState<FilesProblem | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [picked, setPicked] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [keepWorkspace, setKeepWorkspace] = useState(true)
  const [places, setPlaces] = useState<SandboxPlace[]>([])
  const [acting, setActing] = useState<'start' | 'stop' | 'reset' | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [tab, setTab] = useState<'files' | 'terminal' | 'chats'>('files')
  const [templates, setTemplates] = useState<SandboxTemplate[]>([])
  const [showAllSoftware, setShowAllSoftware] = useState(false)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const chatsByEnv = useEnvironmentChats()
  const chats = chatsByEnv?.get(environmentId) ?? []

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
      setFilesError(classifyFilesError(err))
    }
  }, [environmentId])
  const load = useCallback(async () => {
    try {
      const loaded = await api.getSandboxEnvironment(environmentId)
      setEnv(loaded)
      setError(null)
      // A gone sandbox has no files to list, and one still being set up has no workspace yet.
      if (loaded.sandbox?.state === 'gone' || isSettingUp(loaded)) return
      void loadFiles()
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      if (err instanceof ApiError && err.status === 404) return setMissing(true)
      setError(err instanceof ApiError ? err.message : 'Could not load this environment.')
      void loadFiles()
    }
  }, [environmentId, loadFiles])
  useEffect(() => {
    void load()
  }, [load])
  // While the sandbox is being set up, refresh until it settles; then list its files.
  const settingUp = env !== null && isSettingUp(env)
  useEffect(() => {
    if (!settingUp) return
    const timer = setInterval(() => {
      api.getSandboxEnvironment(environmentId).then((loaded) => {
        setEnv(loaded)
        if (!isSettingUp(loaded) && loaded.sandbox?.state !== 'failed' && loaded.status !== 'failed') void loadFiles()
      }, () => undefined)
    }, SETTLING_POLL_MS)
    return () => clearInterval(timer)
  }, [settingUp, environmentId, loadFiles])
  // The places give the place's name and whether it can reset; the page works without them.
  useEffect(() => {
    void (async () => {
      try {
        const page = await api.listSandboxProviders()
        setPlaces(page.data.flatMap((p) => p.places ?? []))
      } catch {
        setPlaces([])
      }
    })()
  }, [])
  useEffect(() => {
    void (async () => {
      try {
        setTemplates((await api.listSandboxTemplates()).data)
      } catch {
        setTemplates([])
      }
    })()
  }, [])
  const place = places.find((pl) => pl.id === env?.sandbox?.place)
  const placeName = place?.name ?? env?.sandbox?.place ?? ''
  const gpuText = gpuLabel(typeof env?.sandbox?.gpus === 'number' ? env.sandbox.gpus : undefined) ?? (env?.sandbox?.gpus === 'all' ? 'All GPUs' : null)
  const canReset = place?.capabilities.reset !== false
  // A place that cannot keep files across a reset (E2B) deletes them: no keep-files choice, and the request says so.
  const canKeep = place?.capabilities.keepFilesOnReset !== false
  const keeping = canKeep && keepWorkspace

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
          : await api.resetSandboxEnvironment(environmentId, keeping)
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
  const state = env?.sandbox?.state
  const notRunning = state === 'stopped'
  const filesProblem = filesError === null ? null : notRunning ? 'not-running' : filesError
  const line = env ? statusLine(env, places) : null
  const template = templates.find((t) => t.id === env?.template_id)
  const facts = templateFacts(template)
  const image = env?.sandbox?.image ?? template?.image
  const software = template ? [...template.packages.system, ...template.packages.python, ...template.packages.npm] : []
  const visibleSoftware = showAllSoftware ? software : software.slice(0, 8)
  const canChat = env ? canChatIn(env) : false
  const tabs = [
    { value: 'files', label: 'Files' },
    ...(env?.provider === 'sandbox' ? [{ value: 'terminal', label: 'Terminal' }] : []),
    { value: 'chats', label: 'Chats' },
  ]
  const startChat = () => router.push(`/?environment=${encodeURIComponent(environmentId)}`)
  const menu = [
    ...(state !== undefined && state !== 'gone' && !settingUp && canReset ? [{ label: 'Reset', onClick: () => setConfirmReset(true) }] : []),
    { label: 'Rename', onClick: () => setRenaming(true) },
    ...(state !== 'gone' ? [{ type: 'divider' as const }, { label: 'Delete environment', variant: 'destructive' as const, onClick: () => setConfirmDelete(true) }] : []),
  ]

  const about = env && (
    <section aria-label="About" {...stylex.props(layout.aboutBox)}>
      <VStack gap={3}>
        <Heading level={2}>About</Heading>
        <DefinitionRow label="Runs on">{env.provider === 'local' ? 'This server' : placeName || providerTitle(env.provider)}</DefinitionRow>
        {env.template_id && <DefinitionRow label="Template">{template?.name || 'Deleted template'}</DefinitionRow>}
        {image && <DefinitionRow label="Image" stacked><Text type="code" color="primary">{image}</Text></DefinitionRow>}
        {facts.cpu && <DefinitionRow label="CPU">{facts.cpu}</DefinitionRow>}
        {facts.memory && <DefinitionRow label="Memory">{facts.memory}</DefinitionRow>}
        {gpuText && <DefinitionRow label="GPUs">{gpuText}</DefinitionRow>}
        {facts.internet && (
          <DefinitionRow label="Internet" stacked={template?.network.access === 'restricted'}>
            {facts.internet.replace('Internet ', '').replace(/^./u, (c) => c.toUpperCase())}
            {template?.network.access === 'restricted' && template.network.allowed_domains.length > 0 && <Text type="supporting" color="secondary">{template.network.allowed_domains.join(', ')}</Text>}
          </DefinitionRow>
        )}
        {software.length > 0 && (
          <DefinitionRow label="Software" stacked>
            <HStack gap={1} wrap="wrap">
              {visibleSoftware.map((name) => <Token key={name} label={name} size="sm" />)}
            </HStack>
            {software.length > 8 && <Button label={showAllSoftware ? 'Show fewer' : `Show all ${software.length}`} size="sm" variant="ghost" onClick={() => setShowAllSoftware((v) => !v)} />}
          </DefinitionRow>
        )}
        <DefinitionRow label="Created">{shortDate(env.created_at)}</DefinitionRow>
        {env.sandbox?.last_used_at ? <DefinitionRow label="Last used">{ago(env.sandbox.last_used_at)}</DefinitionRow> : null}
        <DefinitionRow label="Environment ID">
          <HStack gap={1} vAlign="center" hAlign="end">
            <Text type="code" color="primary">{shortId(env.id)}</Text>
            <CopyButton text={env.id} label="Copy environment ID" />
          </HStack>
        </DefinitionRow>
      </VStack>
    </section>
  )

  const tree = shown && shown.length > 0 ? buildTree(shown.map((f) => ({ path: relative(f.path), size: f.size_bytes })), () => true) : null
  const filesPanel = (
    <VStack gap={3}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <StackItem size="fill">
          {showHidden && hiddenCount > 0 ? <Text type="supporting" color="secondary">{`Showing ${hiddenCount} hidden ${hiddenCount === 1 ? 'file' : 'files'}`}</Text> : null}
        </StackItem>
        {hiddenCount > 0 && (
          <IconButton
            label={showHidden ? 'Hide hidden files' : `Show ${hiddenCount} hidden ${hiddenCount === 1 ? 'file' : 'files'}`}
            tooltip={showHidden ? 'Hide hidden files' : `Show ${hiddenCount} hidden ${hiddenCount === 1 ? 'file' : 'files'}`}
            size="sm"
            variant="ghost"
            icon={<Icon icon={showHidden ? EyeSlashIcon : EyeIcon} />}
            onClick={() => setShowHidden((v) => !v)}
          />
        )}
        <input ref={fileInput} type="file" hidden aria-label="Add a file" onChange={(e) => { void upload(e.target.files?.[0] ?? null); e.target.value = '' }} />
        <IconButton label="Upload file" tooltip="Upload file" size="sm" variant="ghost" icon={<Icon icon={ArrowUpTrayIcon} />} isLoading={uploading} isDisabled={!uploading && state !== undefined && state !== 'running'} onClick={() => fileInput.current?.click()} />
      </HStack>
      {picked && uploading && <Text type="supporting" color="secondary">{`Uploading ${picked.name}`}</Text>}
      {state !== undefined && state !== 'running' && <Text type="supporting" color="secondary">Uploads need a running environment.</Text>}
      {filesProblem === 'not-running' && (
        <Banner status="info" title="Start the environment to see its files." endContent={notRunning ? <Button label="Start" size="sm" isLoading={acting === 'start'} isDisabled={acting !== null} onClick={() => void act('start')} /> : undefined} />
      )}
      {filesProblem === 'unreachable' && <Banner status="warning" title="Couldn't reach the sandbox to list files." endContent={<Button label="Retry" size="sm" onClick={() => void loadFiles()} />} />}
      {filesProblem === 'other' && <Banner status="warning" title="Couldn't list the files." />}
      {shown === null ? (
        <Skeleton height={120} />
      ) : tree === null ? (
        <Text type="supporting" color="secondary" role="status">{hiddenCount > 0 ? 'Only hidden files so far.' : 'No files yet. Files the agent writes in /workspace show here.'}</Text>
      ) : (
        <FileTree
          tree={tree}
          expandTop
          onOpen={(path) => window.open(fileHref(environmentId, `${WORKSPACE}${path}`, false), '_blank', 'noopener')}
          renderEnd={(node) => node.kind === 'file' ? (
            <>
              {node.size !== undefined && <Text type="supporting" color="secondary">{formatBytes(node.size)}</Text>}
              <Link href={fileHref(environmentId, `${WORKSPACE}${node.path}`, true)} aria-label={`Download ${node.path}`} onClick={(e) => e.stopPropagation()}><Icon icon={ArrowDownTrayIcon} size="sm" /></Link>
            </>
          ) : null}
        />
      )}
      {next !== undefined && <Button label="Show more files" onClick={() => void more()} />}
    </VStack>
  )

  const terminalPanel = (
    <VStack gap={2}>
      <Terminal environmentId={environmentId} isDisabled={state !== undefined && state !== 'running' && state !== 'stopped'} />
    </VStack>
  )

  const chatsPanel = chats.length === 0 ? (
    <EmptyState title="No chats here yet." description={chatsByEnv ? 'Chats you start in this environment are listed here.' : 'Chats on this environment will show here once they load.'} actions={canChat ? <Button label="New chat here" onClick={startChat} /> : undefined} />
  ) : (
    <ul aria-label="Chats" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {chats.slice(0, 50).map((chat) => (
        <li key={chat.id}>
          <HStack gap={3} vAlign="center" padding={2}>
            <StackItem size="fill"><Link href={`/c/${encodeURIComponent(chat.id)}`}><Text maxLines={1}>{sessionTitle(chat)}</Text></Link></StackItem>
            <Text type="supporting" color="secondary">{ago(chat.last_active_at)}</Text>
          </HStack>
        </li>
      ))}
    </ul>
  )

  const brokenSetup = env?.status === 'failed' && env.provider === 'sandbox' && state === 'failed'

  return (
    <div style={{ width: '100%', maxWidth: COLUMN_WIDTH, margin: '0 auto', padding: '24px 16px' }}>
      <VStack gap={5}>
        <Link href="/sandboxes">Sandboxes</Link>
        <HStack gap={3} vAlign="start" wrap="wrap">
          <StackItem size="fill">
            <VStack gap={1}>
              {env ? (
                <HStack gap={1} vAlign="center">
                  <Heading level={1} type="display-2" maxLines={1}>{cardName(env)}</Heading>
                  <IconButton label="Rename" size="sm" variant="ghost" icon={<Icon icon={PencilIcon} />} isDisabled={acting !== null} onClick={() => setRenaming(true)} />
                </HStack>
              ) : <Skeleton width={280} height={36} />}
              {line && (
                <HStack gap={2} vAlign="center">
                  <StatusDot variant={line.variant} label={line.text} />
                  <Text weight="medium" color={line.variant === 'neutral' ? 'secondary' : 'primary'}>{line.text}</Text>
                </HStack>
              )}
            </VStack>
          </StackItem>
          {env && (
            <HStack gap={2} vAlign="center" role="group" aria-label="Environment actions">
              {canChat && <IconButton label="New chat here" tooltip="New chat here" variant="primary" icon={<Icon icon={ChatBubbleLeftEllipsisIcon} />} onClick={startChat} />}
              {state === 'stopped' && <IconButton label="Start" tooltip="Start" variant="ghost" icon={<Icon icon={PlayIcon} />} isLoading={acting === 'start'} isDisabled={acting !== null && acting !== 'start'} onClick={() => void act('start')} />}
              {state === 'running' && <IconButton label="Stop" tooltip="Stop" variant="ghost" icon={<Icon icon={StopIcon} />} isLoading={acting === 'stop'} isDisabled={acting !== null && acting !== 'stop'} onClick={() => void act('stop')} />}
              <MoreMenu label="More actions" alignment="end" isDisabled={acting !== null} items={menu} />
            </HStack>
          )}
        </HStack>
        {env?.error && state !== 'failed' && <Banner status="error" title={env.error} />}
        {state === 'unknown' && <Banner status="warning" title="Agentry Sandbox is not answering, so this environment's state is unknown." />}
        {error !== null && <Banner status="error" title={error} endContent={<Button label="Retry" size="sm" onClick={() => void load()} />} />}

        <div {...stylex.props(layout.columns)}>
          <aside {...stylex.props(layout.about)}>{about}</aside>
          <div {...stylex.props(layout.main)}>
            {state === 'gone' ? (
              <EmptyState
                title="This sandbox is gone"
                description="Its files can't be recovered. Delete this environment, then create a new one from Sandboxes."
                actions={
                  <HStack gap={2}>
                    <Button label="Delete environment" variant="destructive" onClick={() => setConfirmDelete(true)} />
                    <Button label="Back to sandboxes" onClick={() => router.push('/sandboxes')} />
                  </HStack>
                }
              />
            ) : settingUp ? (
              <Banner status="info" title="Setting up this sandbox. Its terminal and files appear when it is ready." description={env?.sandbox?.progress ? setupProgressText(env.sandbox.progress) : undefined} />
            ) : brokenSetup ? null : (
              <VStack gap={3}>
                <TabList value={tab} onChange={(v) => setTab(v as typeof tab)} role="tablist" hasDivider aria-label="Environment">
                  {tabs.map((t) => (
                    <Tab key={t.value} value={t.value} label={t.label} panelId="environment-panel" endContent={t.value === 'chats' && chats.length > 0 ? <Text type="supporting" color="secondary">{chats.length}</Text> : undefined} />
                  ))}
                </TabList>
                <div role="tabpanel" id="environment-panel" aria-label={tabs.find((t) => t.value === tab)?.label}>
                  {tab === 'terminal' && env?.provider === 'sandbox' ? terminalPanel : tab === 'chats' ? chatsPanel : filesPanel}
                </div>
              </VStack>
            )}
          </div>
        </div>
      </VStack>
      <Dialog isOpen={confirmReset} onOpenChange={(open: boolean) => { setConfirmReset(open); if (!open) setKeepWorkspace(true) }} purpose="form" width={440}>
        <DialogHeader title="Reset this environment?" onOpenChange={(open: boolean) => { setConfirmReset(open); if (!open) setKeepWorkspace(true) }} />
        <VStack gap={3} padding={4}>
          <Text>
            {!canKeep
              ? 'Reset deletes all files in this environment.'
              : keepWorkspace
              ? 'The sandbox is rebuilt from its template: installed software and anything outside the workspace are lost. Workspace files are kept.'
              : 'The sandbox is rebuilt from its template and every workspace file is deleted.'}
          </Text>
          {canKeep && <Switch label="Keep workspace files" value={keepWorkspace} onChange={setKeepWorkspace} />}
          <HStack gap={2} hAlign="end">
            <Button label="Cancel" onClick={() => setConfirmReset(false)} />
            <Button label={keeping ? 'Reset, keep files' : 'Reset and delete files'} variant="destructive" isLoading={acting === 'reset'} onClick={() => void act('reset')} />
          </HStack>
        </VStack>
      </Dialog>
      <RenameEnvironmentDialog environment={renaming ? env : null} onClose={() => setRenaming(false)} onRenamed={setEnv} />
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
