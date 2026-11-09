'use client'

/**
 * Conversation sidebar: New chat, title search, the user's sessions (paged
 * newest first, grouped Today / Yesterday / Earlier), rename and delete, then
 * Settings and the user menu. Collapsing is remembered in `localStorage`;
 * below 768px AppShell moves the whole sidebar into a drawer.
 */
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { MoreMenu } from '@astryxdesign/core/MoreMenu'
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { ChatBubbleLeftIcon, Cog6ToothIcon, MagnifyingGlassIcon, PencilSquareIcon } from '@heroicons/react/24/outline'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { OAIAgentSession } from '@/api/types'
import { AgentryMark } from '@/ui/brand/Wordmark'
import { groupSessions, sessionTitle } from './group'
import { UserMenu, type ShellIdentity } from './UserMenu'

export const SIDEBAR_COLLAPSED_KEY = 'agentry.sidebar.collapsed'
export const PAGE_SIZE = 30

/** Event other parts of the app dispatch on `window` when a session was created or renamed. */
export const SESSIONS_CHANGED = 'agentry:sessions-changed'

type Session = Pick<OAIAgentSession, 'id' | 'created_at' | 'metadata'>

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    // Storage unavailable (private mode, blocked): the choice lasts for this page only.
  }
}

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.'
}

function sessionIdFrom(pathname: string | null): string | null {
  const match = /^\/c\/([^/]+)/.exec(pathname ?? '')
  return match ? decodeURIComponent(match[1]) : null
}

export function Sidebar({ identity }: { identity: ShellIdentity }) {
  const pathname = usePathname()
  const router = useRouter()
  const currentId = sessionIdFrom(pathname)

  const [sessions, setSessions] = useState<Session[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [renaming, setRenaming] = useState<Session | null>(null)
  const [deleting, setDeleting] = useState<Session | null>(null)
  const loadingRef = useRef(false)

  const load = useCallback(async (after: string | null) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    try {
      const page = await api.listSessions({ limit: PAGE_SIZE, ...(after ? { after } : {}) })
      setSessions((prev) => {
        const base = after ? prev : []
        const known = new Set(base.map((s) => s.id))
        return [...base, ...page.data.filter((s) => !known.has(s.id))]
      })
      setCursor(page.last_id)
      setHasMore(page.has_more && page.last_id !== null)
      setLoadError(null)
    } catch (error) {
      if (isSignedOut(error)) {
        window.location.assign('/login')
        return
      }
      setLoadError(errorText(error))
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [])

  // First page on mount; again when another part of the app created or renamed a chat.
  useEffect(() => {
    void load(null)
    const reload = () => {
      loadingRef.current = false
      void load(null)
    }
    window.addEventListener(SESSIONS_CHANGED, reload)
    return () => window.removeEventListener(SESSIONS_CHANGED, reload)
  }, [load])

  // Opening a chat the list does not have yet (just created elsewhere): refresh the first page.
  const knownIds = useMemo(() => new Set(sessions.map((s) => s.id)), [sessions])
  useEffect(() => {
    if (currentId && !loading && !knownIds.has(currentId)) void load(null)
    // Only when the route changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId])

  useEffect(() => {
    setCollapsed(readCollapsed())
  }, [])
  const onCollapsedChange = useCallback((next: boolean) => {
    setCollapsed(next)
    writeCollapsed(next)
  }, [])

  // Infinite scroll: load the next page when the end of the list comes into view.
  const sentinel = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const node = sentinel.current
    if (!node || !hasMore || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void load(cursor)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [cursor, hasMore, load])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? sessions.filter((s) => sessionTitle(s).toLowerCase().includes(q)) : sessions
  }, [query, sessions])
  const groups = groupSessions(visible, new Date())

  const renamed = (id: string, title: string) =>
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, metadata: { ...s.metadata, title } } : s)))

  const removed = (id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id))
    if (id === currentId) router.push('/')
  }

  const rows = (list: Session[]) =>
    list.map((s) => (
      <SideNavItem
        key={s.id}
        label={sessionTitle(s)}
        href={`/c/${encodeURIComponent(s.id)}`}
        isSelected={s.id === currentId}
        actions={
          <MoreMenu
            label={`Options for ${sessionTitle(s)}`}
            size="sm"
            items={[
              { label: 'Rename', onClick: () => setRenaming(s) },
              { label: 'Delete', variant: 'destructive', onClick: () => setDeleting(s) },
            ]}
          />
        }
      />
    ))

  return (
    <>
      <SideNav
        collapsible={{ isCollapsed: collapsed, onCollapsedChange, buttonLabel: collapsed ? 'Expand sidebar' : 'Collapse sidebar' }}
        header={<SideNavHeading heading="Agentry" headingHref="/" icon={<Icon icon={AgentryMark} color="accent" />} />}
        topContent={
          <VStack gap={2}>
            <SideNavItem label="New chat" icon={PencilSquareIcon} href="/" isSelected={pathname === '/'} />
            <TextInput
              label="Search chats"
              isLabelHidden
              type="search"
              size="sm"
              placeholder="Search chats"
              startIcon={MagnifyingGlassIcon}
              value={query}
              onChange={setQuery}
              hasClear
            />
          </VStack>
        }
        footer={
          <VStack gap={1}>
            <SideNavItem label="Settings" icon={Cog6ToothIcon} href="/settings" isSelected={pathname === '/settings'} />
            <UserMenu identity={identity} />
          </VStack>
        }
      >
        {groups.today.length > 0 && <SideNavSection title="Today">{rows(groups.today)}</SideNavSection>}
        {groups.yesterday.length > 0 && <SideNavSection title="Yesterday">{rows(groups.yesterday)}</SideNavSection>}
        {groups.earlier.length > 0 && <SideNavSection title="Earlier">{rows(groups.earlier)}</SideNavSection>}
        {!loading && !loadError && visible.length === 0 && (
          <VStack padding={3} gap={1}>
            <Icon icon={ChatBubbleLeftIcon} color="secondary" />
            <Text type="supporting">{query.trim() ? 'No chats match.' : 'No chats yet.'}</Text>
          </VStack>
        )}
        {loadError && (
          <VStack padding={3} gap={2} hAlign="start">
            <Text type="supporting">{loadError}</Text>
            <Button label="Retry" size="sm" onClick={() => void load(null)} />
          </VStack>
        )}
        <VStack ref={sentinel} hAlign="center" padding={hasMore || loading ? 2 : 0} data-testid="sidebar-sentinel">
          {loading && <Spinner size="sm" />}
        </VStack>
      </SideNav>
      <RenameDialog session={renaming} onClose={() => setRenaming(null)} onRenamed={renamed} />
      <DeleteDialog session={deleting} onClose={() => setDeleting(null)} onDeleted={removed} />
    </>
  )
}

function RenameDialog({
  session,
  onClose,
  onRenamed,
}: {
  session: Session | null
  onClose(): void
  onRenamed(id: string, title: string): void
}) {
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
      await api.renameSession(session.id, next)
      onRenamed(session.id, next)
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

function DeleteDialog({
  session,
  onClose,
  onDeleted,
}: {
  session: Session | null
  onClose(): void
  onDeleted(id: string): void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setError(null), [session])

  async function remove() {
    if (!session || busy) return
    setBusy(true)
    try {
      await api.deleteSession(session.id)
      onDeleted(session.id)
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
