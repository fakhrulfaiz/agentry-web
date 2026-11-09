'use client'

/**
 * Conversation sidebar: New chat, title search, the user's sessions (paged
 * newest first: starred chats under Starred, the rest grouped Today /
 * Yesterday / Earlier), star, rename and delete (shared with the chat title
 * menu, see `session-actions`), then Settings and the user menu. Collapsing is remembered in `localStorage`;
 * below 768px AppShell moves the whole sidebar into a drawer.
 */
import { Button } from '@astryxdesign/core/Button'
import { Icon } from '@astryxdesign/core/Icon'
import { MoreMenu } from '@astryxdesign/core/MoreMenu'
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { ChatBubbleLeftIcon, Cog6ToothIcon, MagnifyingGlassIcon, PencilSquareIcon } from '@heroicons/react/24/outline'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { OAIAgentSession } from '@/api/types'
import { AgentryMark } from '@/ui/brand/Wordmark'
import { groupSessions, sessionTitle } from './group'
import { DeleteDialog, isStarred, RenameDialog, SESSIONS_CHANGED, useSessionChanges, useStarToggle } from './session-actions'
import { UserMenu, type ShellIdentity } from './UserMenu'

export const SIDEBAR_COLLAPSED_KEY = 'agentry.sidebar.collapsed'
export const PAGE_SIZE = 30

export { SESSIONS_CHANGED }

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

  // First page on mount.
  useEffect(() => {
    void load(null)
  }, [load])

  // A renamed, starred or deleted chat updates in place; any other change (a new chat) reloads the first page.
  useSessionChanges((change) => {
    if (change === null) {
      loadingRef.current = false
      void load(null)
    } else if ('deleted' in change) {
      setSessions((prev) => prev.filter((s) => s.id !== change.id))
    } else {
      setSessions((prev) => prev.map((s) => (s.id === change.id ? { ...s, metadata: change.metadata } : s)))
    }
  })
  const toggleStar = useStarToggle()

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
  const starred = visible.filter(isStarred)
  const groups = groupSessions(
    visible.filter((s) => !isStarred(s)),
    new Date(),
  )

  const removed = (id: string) => {
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
              { label: isStarred(s) ? 'Unstar' : 'Star', onClick: () => void toggleStar(s) },
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
        {starred.length > 0 && <SideNavSection title="Starred">{rows(starred)}</SideNavSection>}
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
      <RenameDialog session={renaming} onClose={() => setRenaming(null)} />
      <DeleteDialog session={deleting} onClose={() => setDeleting(null)} onDeleted={removed} />
    </>
  )
}
