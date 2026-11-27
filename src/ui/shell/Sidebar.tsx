'use client'

/**
 * Conversation sidebar: New chat, title search, Project sections (pinned first,
 * then active), the Starred smart view, the user's unfiled sessions grouped by
 * local date, star/rename/delete/move and Project actions, then Settings and
 * the user menu. Project session pages load only for expanded sections; the
 * global paged list stays the source for Recent/Unfiled and search. Collapsing
 * is remembered in `localStorage`; below 768px AppShell moves the whole sidebar
 * into a drawer.
 */
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { MoreMenu } from '@astryxdesign/core/MoreMenu'
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { useToast } from '@astryxdesign/core/Toast'
import { VStack } from '@astryxdesign/core/VStack'
import { ChatBubbleLeftIcon, ClockIcon, MagnifyingGlassIcon, PencilSquareIcon, PuzzlePieceIcon, RectangleStackIcon, ServerStackIcon, UserGroupIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, isSignedOut, STARRED_KEY } from '@/api/client'
import type { OAIAgentSession, OAIProject } from '@/api/types'
import { AgentryMark } from '@/ui/brand/Wordmark'
import { sessionTitle } from './group'
import { ArchivedProjectsDialog, MoveProjectDialog, ProjectDialog, useSessionMove } from './project-actions'
import { announceProjects, useProjectChanges } from './project-events'
import { groupSessionsForSidebar, type SidebarSection } from './project-groups'
import { DeleteDialog, isStarred, RenameDialog, SESSIONS_CHANGED, useSessionChanges, useStarToggle } from './session-actions'
import { UserMenu, type ShellIdentity } from './UserMenu'

const styles = stylex.create({
  // Row menus fade in under the pointer or keyboard focus (and stay on the open chat).
  rowActions: { display: 'flex', opacity: { default: 0, ':hover': 1, ':focus-within': 1 }, transitionProperty: 'opacity', transitionDuration: '120ms' },
  rowActionsShown: { opacity: 1 },
})

export const SIDEBAR_COLLAPSED_KEY = 'agentry.sidebar.collapsed'
export const PAGE_SIZE = 30
/** Most starred chats the Starred section loads. */
const STARRED_LIMIT = 100

export { SESSIONS_CHANGED }

type Session = OAIAgentSession
type ProjectSection = Extract<SidebarSection, { type: 'project' }>
type DateSection = Extract<SidebarSection, { type: 'date' }>

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
  // Starred chats come from their own filtered query, so ones beyond the loaded pages still show.
  const [starredSessions, setStarredSessions] = useState<Session[]>([])
  const [projects, setProjects] = useState<OAIProject[]>([])
  // A Project's chats are loaded on expansion, with their own cursor for "More".
  const [projectSessions, setProjectSessions] = useState<Record<string, Session[]>>({})
  const [projectCursors, setProjectCursors] = useState<Record<string, string | null>>({})
  const [projectHasMore, setProjectHasMore] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [renaming, setRenaming] = useState<Session | null>(null)
  const [deleting, setDeleting] = useState<Session | null>(null)
  const [projectDialog, setProjectDialog] = useState<{ isOpen: boolean; project: OAIProject | null }>({ isOpen: false, project: null })
  const [moving, setMoving] = useState<Session | null>(null)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const loadingRef = useRef(false)
  const sessionsRef = useRef<Session[]>([])
  sessionsRef.current = sessions
  const toggleStar = useStarToggle()
  const move = useSessionMove()
  const toast = useToast()

  // Project menu actions reload every view on success; failures keep the current list and explain why.
  const changeProject = (label: string, action: () => Promise<unknown>) => {
    void action()
      .then(announceProjects)
      .catch((error: unknown) => {
        if (isSignedOut(error)) window.location.assign('/login')
        else toast({ type: 'error', body: error instanceof ApiError ? error.message : `Could not ${label} the project.`, uniqueID: `project-${label}` })
      })
  }

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

  const loadStarred = useCallback(async () => {
    try {
      const page = await api.listSessions({ limit: STARRED_LIMIT, metadata: { [STARRED_KEY]: 'true' } })
      setStarredSessions(page.data.filter(isStarred))
    } catch (error) {
      if (isSignedOut(error)) window.location.assign('/login')
      // Otherwise the Starred section shows what the loaded pages hold.
    }
  }, [])

  // Follow the cursor: a filed chat must never disappear because its Project was on a later page.
  const loadProjects = useCallback(async () => {
    try {
      const all: OAIProject[] = []
      let after: string | undefined
      for (;;) {
        const page = await api.listProjects({ status: 'active', ...(after ? { after } : {}) })
        all.push(...page.data)
        if (!page.has_more || !page.last_id || page.last_id === after) break
        after = page.last_id
      }
      setProjects(all)
    } catch (error) {
      if (isSignedOut(error)) window.location.assign('/login')
      // A failed reload leaves the last known sections in place.
    }
  }, [])

  const loadProjectSessions = useCallback(async (projectId: string, after?: string) => {
    try {
      const page = await api.listSessions({ projectId, ...(after ? { after } : {}) })
      setProjectSessions((prev) => ({ ...prev, [projectId]: after ? [...(prev[projectId] ?? []), ...page.data] : page.data }))
      setProjectCursors((prev) => ({ ...prev, [projectId]: page.last_id }))
      setProjectHasMore((prev) => ({ ...prev, [projectId]: page.has_more && page.last_id !== null }))
    } catch (error) {
      if (isSignedOut(error)) window.location.assign('/login')
    }
  }, [])

  // First page on mount.
  useEffect(() => {
    void load(null)
    void loadStarred()
    void loadProjects()
  }, [load, loadStarred, loadProjects])

  useProjectChanges(() => void loadProjects())

  // A renamed, starred or deleted chat updates in place; any other change (a new
  // chat, or a move between Projects) reloads the Recent and expanded Project pages.
  useSessionChanges((change) => {
    if (change === null) {
      loadingRef.current = false
      void load(null)
      void loadStarred()
      for (const id of expanded) void loadProjectSessions(id)
    } else if ('deleted' in change) {
      setSessions((prev) => prev.filter((s) => s.id !== change.id))
      setStarredSessions((prev) => prev.filter((s) => s.id !== change.id))
      setProjectSessions((prev) => Object.fromEntries(Object.entries(prev).map(([id, list]) => [id, list.filter((s) => s.id !== change.id)])))
    } else {
      const updated = (s: Session): Session => ({ ...s, metadata: change.metadata })
      setSessions((prev) => prev.map((s) => (s.id === change.id ? updated(s) : s)))
      setStarredSessions((prev) => {
        const known = prev.find((s) => s.id === change.id)
        if (!isStarred(change)) return prev.filter((s) => s.id !== change.id)
        if (known) return prev.map((s) => (s.id === change.id ? updated(s) : s))
        const from = sessionsRef.current.find((s) => s.id === change.id)
        return from ? [updated(from), ...prev] : prev
      })
      setProjectSessions((prev) =>
        Object.fromEntries(Object.entries(prev).map(([id, list]) => [id, list.map((s) => (s.id === change.id ? updated(s) : s))])),
      )
    }
  })

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
  const matches = (s: Session) => !query.trim() || sessionTitle(s).toLowerCase().includes(query.trim().toLowerCase())
  // The filtered list first, plus any starred row the loaded pages have that it does not (a star made a moment ago).
  const starred = [...starredSessions, ...sessions.filter((s) => isStarred(s) && !starredSessions.some((x) => x.id === s.id))].filter(
    (s) => isStarred(s) && matches(s),
  )
  const grouped = groupSessionsForSidebar(projects, visible, new Date())
  const projectSections = grouped.filter((section): section is ProjectSection => section.type === 'project')
  const dateSections = grouped.filter((section): section is DateSection => section.type === 'date')
  const loadedProjectRows = Object.values(projectSessions).flat()

  // Search is a flat list: partial Project sections would be confusing while filtering.
  const searchRows = [...visible, ...starred, ...loadedProjectRows]
    .filter(matches)
    .filter((s, i, all) => all.findIndex((other) => other.id === s.id) === i)

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
          // Shown on the open chat; on the others it appears under the pointer or keyboard focus, so the list stays calm.
          <span {...stylex.props(styles.rowActions, s.id === currentId && styles.rowActionsShown)}>
          <MoreMenu
            label={`Options for ${sessionTitle(s)}`}
            size="sm"
            items={[
              { label: isStarred(s) ? 'Unstar' : 'Star', onClick: () => void toggleStar(s) },
              { label: 'Move to project…', onClick: () => setMoving(s) },
              ...(s.project_id ? [{ label: 'Unfiled', onClick: () => void move(s, null) }] : []),
              { label: 'Rename', onClick: () => setRenaming(s) },
              { label: 'Delete', variant: 'destructive', onClick: () => setDeleting(s) },
            ]}
          />
          </span>
        }
      />
    ))

  const toggleProject = (projectId: string) => {
    const expanding = !expanded.has(projectId)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (expanding) next.add(projectId)
      else next.delete(projectId)
      return next
    })
    // Refresh on every expansion: a move made while collapsed must not show a stale page.
    if (expanding) void loadProjectSessions(projectId)
  }

  const projectSection = (project: OAIProject) => {
    const isExpanded = expanded.has(project.id)
    const chats = (projectSessions[project.id] ?? []).filter(matches)
    return (
      <SideNavSection
        key={project.id}
        title={project.name}
        endContent={
          <HStack gap={1}>
            <Button
              label={`${isExpanded ? 'Hide' : 'Show'} chats in ${project.name}`}
              size="sm"
              variant="ghost"
              onClick={() => toggleProject(project.id)}
            />
            <MoreMenu
              label={`Options for ${project.name}`}
              size="sm"
              items={[
                { label: 'New chat here', onClick: () => router.push(`/?project=${encodeURIComponent(project.id)}`) },
                { label: 'Rename', onClick: () => setProjectDialog({ isOpen: true, project }) },
                { label: project.pinned ? 'Unpin' : 'Pin', onClick: () => changeProject('pin', () => api.updateProject(project.id, { pinned: !project.pinned })) },
                { label: 'Archive', onClick: () => changeProject('archive', () => api.archiveProject(project.id)) },
                { label: 'Delete', variant: 'destructive', onClick: () => changeProject('delete', () => api.deleteProject(project.id)) },
              ]}
            />
          </HStack>
        }
      >
        <SideNavItem label="New chat here" href={`/?project=${encodeURIComponent(project.id)}`} icon={PencilSquareIcon} size="sm" />
        {isExpanded && (
          <>
            {rows(chats)}
            {chats.length === 0 && <Text type="supporting">No chats yet.</Text>}
            {projectHasMore[project.id] && (
              <Button label="More" size="sm" variant="ghost" onClick={() => void loadProjectSessions(project.id, projectCursors[project.id] ?? undefined)} />
            )}
          </>
        )}
      </SideNavSection>
    )
  }

  return (
    <>
      <SideNav
        collapsible={{ isCollapsed: collapsed, onCollapsedChange, buttonLabel: collapsed ? 'Expand sidebar' : 'Collapse sidebar' }}
        header={<SideNavHeading heading="Agentry" headingHref="/" icon={<Icon icon={AgentryMark} color="accent" />} />}
        topContent={
          <VStack gap={2}>
            <SideNavItem label="New chat" icon={PencilSquareIcon} href="/" isSelected={pathname === '/'} />
            <Button label="New project" size="sm" variant="ghost" onClick={() => setProjectDialog({ isOpen: true, project: null })} />
            <Button label="Archived" size="sm" variant="ghost" onClick={() => setArchivedOpen(true)} />
            <SideNavItem
              label="Scheduled"
              icon={ClockIcon}
              href="/scheduled"
              isSelected={pathname.startsWith('/scheduled')}
            />
            <SideNavItem
              label="Agents"
              icon={UserGroupIcon}
              href="/agents"
              isSelected={pathname.startsWith('/agents')}
            />
            <SideNavItem
              label="Artifacts"
              icon={RectangleStackIcon}
              href="/artifacts"
              isSelected={pathname.startsWith('/artifacts')}
            />
            <SideNavItem
              label="Plugins"
              icon={PuzzlePieceIcon}
              href="/plugins"
              isSelected={pathname.startsWith('/plugins')}
            />
            <SideNavItem
              label="Sandboxes"
              icon={ServerStackIcon}
              href="/sandboxes"
              isSelected={pathname.startsWith('/sandboxes')}
            />
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
          <UserMenu identity={identity} />
        }
      >
        {query.trim() ? (
          <SideNavSection title="Search results">{rows(searchRows)}</SideNavSection>
        ) : (
          <>
            {projectSections.map((section) => projectSection(section.project))}
            {starred.length > 0 && <SideNavSection title="Starred">{rows(starred)}</SideNavSection>}
            {dateSections.map((section) => {
              const chats = section.sessions.filter((s) => !isStarred(s) && matches(s))
              return chats.length > 0 ? (
                <SideNavSection key={section.title} title={section.title}>
                  {rows(chats)}
                </SideNavSection>
              ) : null
            })}
          </>
        )}
        {!loading &&
          !loadError &&
          (query.trim()
            ? searchRows.length === 0
            : visible.length === 0 && starred.length === 0 && projects.length === 0 && loadedProjectRows.length === 0) && (
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
      <ProjectDialog project={projectDialog.project} isOpen={projectDialog.isOpen} onClose={() => setProjectDialog({ isOpen: false, project: null })} />
      <MoveProjectDialog session={moving} projects={projects} onClose={() => setMoving(null)} />
      <ArchivedProjectsDialog isOpen={archivedOpen} onClose={() => setArchivedOpen(false)} />
    </>
  )
}
