'use client'

/**
 * Conversation sidebar: New chat and the page links, then the Workspace (title search and
 * view options in its header; by default the Projects section, Starred, and the unfiled
 * chats as one Recents list; or chats grouped by environment, or one list), star/rename/
 * delete/move and Project actions, then the user menu. Project session pages load only for expanded sections; the
 * global paged list stays the source for Recent/Unfiled and search. Collapsing
 * is remembered in `localStorage`; below 768px AppShell moves the whole sidebar
 * into a drawer.
 */
import { Button } from '@astryxdesign/core/Button'
import { Divider } from '@astryxdesign/core/Divider'
import { DropdownMenu, DropdownMenuDivider, DropdownMenuGroup, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@astryxdesign/core/DropdownMenu'
import { StackItem } from '@astryxdesign/core/Layout'
import { IconButton } from '@astryxdesign/core/IconButton'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { MoreMenu } from '@astryxdesign/core/MoreMenu'
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { useToast } from '@astryxdesign/core/Toast'
import { VStack } from '@astryxdesign/core/VStack'
import { ChatBubbleLeftIcon, ChevronDownIcon, ChevronRightIcon, AdjustmentsHorizontalIcon, FolderIcon, FolderPlusIcon, PlusIcon, ArchiveBoxIcon, XMarkIcon, ClockIcon, MagnifyingGlassIcon, PencilSquareIcon, QueueListIcon, BarsArrowDownIcon, StarIcon, PuzzlePieceIcon, RectangleStackIcon, ServerStackIcon, SparklesIcon, UserGroupIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { usePathname, useRouter } from 'next/navigation'
import type React from 'react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, isSignedOut, STARRED_KEY } from '@/api/client'
import type { OAIAgentSession, OAIProject } from '@/api/types'
import { AgentryMark } from '@/ui/brand/Wordmark'
import { sessionTitle } from './group'
import { askAgentryStore } from './ask-agentry-store'
import { ArchivedProjectsDialog, DeleteProjectDialog, MoveProjectDialog, ProjectDialog, useSessionMove } from './project-actions'
import { announceProjects, useProjectChanges } from './project-events'
import { groupSessionsForSidebar, type SidebarSection } from './project-groups'
import { DeleteDialog, isStarred, RenameDialog, SESSIONS_CHANGED, useSessionChanges, useStarToggle } from './session-actions'
import { UserMenu, type ShellIdentity } from './UserMenu'
import { SectionHeader } from './SectionHeader'
import { DEFAULT_VIEW, groupByEnvironment, orderProjects, orderSessions, readView, writeView, type GroupBy, type OrderBy, type ShowChats, type SidebarView } from './sidebar-view'

const styles = stylex.create({
  // A row's menu takes no space until the row is under the pointer or focused, so titles use the full width.
  rowActions: { display: 'flex', width: 0, overflow: 'hidden', opacity: 0 },
  rowActionsShown: { width: 'auto', overflow: 'visible', opacity: 1 },
  // A project's caret and folder, side by side in the row's icon slot.
  projectIcon: { display: 'inline-flex', alignItems: 'center', gap: 2 },
  // A project's chats sit under it, indented like a tree.
  projectChats: { paddingInlineStart: 12 },
})

/** How long a row's menu stays after the pointer or focus leaves, so crossing the gap to it does not hide it. */
const ROW_LEAVE_MS = 100

type RowMenuItems = React.ComponentProps<typeof MoreMenu>['items']

/** A sidebar row (a chat or a project) whose actions appear on hover or focus (and while its menu is open). */
function HoverRow({ label, href, onClick, icon, isSelected = false, items, extra }: {
  label: string
  href?: string
  onClick?: () => void
  icon?: React.ReactNode
  isSelected?: boolean
  items: RowMenuItems
  /** Quiet actions before the ⋯ menu, shown with it (e.g. a project's "New chat here"). */
  extra?: React.ReactNode
}) {
  const [hot, setHot] = useState(false)
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const enter = () => {
    clearTimeout(timer.current)
    setHot(true)
  }
  const leave = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setHot(false), ROW_LEAVE_MS)
  }
  const hover = { onMouseEnter: enter, onMouseLeave: leave, onFocus: enter, onBlur: leave }
  return (
    <SideNavItem
      label={label}
      {...(href ? { href } : {})}
      {...(onClick ? { onClick } : {})}
      {...(icon ? { icon } : {})}
      isSelected={isSelected}
      size="sm"
      {...hover}
      actions={
        <span {...hover} {...stylex.props(styles.rowActions, (hot || open) && styles.rowActionsShown)}>
          {extra}
          <MoreMenu label={`Options for ${label}`} size="sm" items={items} onOpenChange={setOpen} />
        </span>
      }
    />
  )
}

export const SIDEBAR_COLLAPSED_KEY = 'agentry.sidebar.collapsed'
export const PAGE_SIZE = 30
const RECENTS_HIDDEN_KEY = 'agentry_recents_hidden'
const PROJECTS_HIDDEN_KEY = 'agentry_projects_hidden'

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
  const [projectLoadErrors, setProjectLoadErrors] = useState<Record<string, string>>({})
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
  const [deletingProject, setDeletingProject] = useState<OAIProject | null>(null)
  const [moving, setMoving] = useState<Session | null>(null)
  const [archivedOpen, setArchivedOpen] = useState(false)
  // Workspace view options (Group by / Order by / Show), remembered per browser.
  const [view, setView] = useState<SidebarView>(DEFAULT_VIEW)
  useEffect(() => setView(readView()), [])
  const changeView = (patch: Partial<SidebarView>) =>
    setView((prev) => {
      const next = { ...prev, ...patch }
      writeView(next)
      return next
    })
  // Search opens from the Workspace header; closing it clears the query.
  const [searching, setSearching] = useState(false)
  const closeSearch = () => {
    setSearching(false)
    setQuery('')
  }
  // Sandbox names for "Group by environment", read only when that view is on.
  const [environmentNames, setEnvironmentNames] = useState<Record<string, string>>({})
  useEffect(() => {
    if (view.group !== 'environment') return
    let alive = true
    api
      .listSandboxEnvironments()
      .then((page) => {
        if (alive) setEnvironmentNames(Object.fromEntries(page.data.map((e) => [e.id, e.name || 'Untitled sandbox'])))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [view.group])
  // Folding Recents away is remembered per browser; storage can be unavailable, so it is best-effort.
  const [recentsHidden, setRecentsHidden] = useState(false)
  const [projectsHidden, setProjectsHidden] = useState(false)
  useEffect(() => {
    try {
      setProjectsHidden(window.localStorage.getItem(PROJECTS_HIDDEN_KEY) === '1')
    } catch {}
  }, [])
  const toggleProjects = () =>
    setProjectsHidden((hidden) => {
      try {
        window.localStorage.setItem(PROJECTS_HIDDEN_KEY, hidden ? '0' : '1')
      } catch {}
      return !hidden
    })
  useEffect(() => {
    try {
      setRecentsHidden(window.localStorage.getItem(RECENTS_HIDDEN_KEY) === '1')
    } catch {}
  }, [])
  const toggleRecents = () =>
    setRecentsHidden((hidden) => {
      try {
        window.localStorage.setItem(RECENTS_HIDDEN_KEY, hidden ? '0' : '1')
      } catch {}
      return !hidden
    })
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
      setProjectLoadErrors((prev) => {
        if (!prev[projectId]) return prev
        const next = { ...prev }
        delete next[projectId]
        return next
      })
    } catch (error) {
      if (isSignedOut(error)) {
        window.location.assign('/login')
        return
      }
      // Keep any rows already loaded, but say why the section is incomplete.
      setProjectLoadErrors((prev) => ({ ...prev, [projectId]: errorText(error) }))
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
    if (!node || !hasMore || recentsHidden || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void load(cursor)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [cursor, hasMore, load, recentsHidden])

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
  // One flat Recents list (newest first, as the date groups were ordered), without the starred chats shown above it.
  const recents = orderSessions(dateSections.flatMap((section) => section.sessions).filter((s) => !isStarred(s) && matches(s)), view.order)
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
      <HoverRow
        key={s.id}
        label={sessionTitle(s)}
        href={`/c/${encodeURIComponent(s.id)}`}
        isSelected={s.id === currentId}
        items={[
          { label: isStarred(s) ? 'Unstar' : 'Star', onClick: () => void toggleStar(s) },
          { label: 'Move to project…', onClick: () => setMoving(s) },
          ...(s.project_id ? [{ label: 'Unfiled', onClick: () => void move(s, null) }] : []),
          { label: 'Rename', onClick: () => setRenaming(s) },
          { label: 'Delete', variant: 'destructive' as const, onClick: () => setDeleting(s) },
        ]}
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

  // One compact row per Project: a folder that expands to its chats; everything else lives in its menu.
  const projectItem = (project: OAIProject) => {
    const isExpanded = expanded.has(project.id)
    const loaded = projectSessions[project.id]
    const chats = (loaded ?? []).filter(matches)
    const error = projectLoadErrors[project.id]
    return (
      <Fragment key={project.id}>
        <HoverRow
          label={project.name}
          onClick={() => toggleProject(project.id)}
          icon={
            <span {...stylex.props(styles.projectIcon)}>
              <Icon icon={isExpanded ? ChevronDownIcon : ChevronRightIcon} size="xsm" color="secondary" />
              <Icon icon={FolderIcon} size="sm" />
            </span>
          }
          extra={<IconButton label={`New chat in ${project.name}`} tooltip="New chat here" size="sm" variant="ghost" icon={<Icon icon={PlusIcon} size="sm" />} onClick={() => router.push(`/?project=${encodeURIComponent(project.id)}`)} />}
          items={[
            { label: 'New chat here', onClick: () => router.push(`/?project=${encodeURIComponent(project.id)}`) },
            { label: 'Rename', onClick: () => setProjectDialog({ isOpen: true, project }) },
            { label: project.pinned ? 'Unpin' : 'Pin', onClick: () => changeProject('pin', () => api.updateProject(project.id, { pinned: !project.pinned })) },
            { label: 'Archive', onClick: () => changeProject('archive', () => api.archiveProject(project.id)) },
            { label: 'Delete', variant: 'destructive', onClick: () => setDeletingProject(project) },
          ]}
        />
        {isExpanded && (
          <VStack role="group" aria-label={project.name} xstyle={styles.projectChats}>
            {rows(chats)}
            {loaded && chats.length === 0 && !error && (
              <VStack paddingInline={2} paddingBlock={1}>
                <Text type="supporting" color="secondary">No chats yet.</Text>
              </VStack>
            )}
            {error && (
              <VStack padding={2} gap={1} hAlign="start">
                <Text type="supporting">{error}</Text>
                <Button label="Retry" size="sm" variant="ghost" onClick={() => void loadProjectSessions(project.id)} />
              </VStack>
            )}
            {projectHasMore[project.id] && (
              <Button label="More" size="sm" variant="ghost" onClick={() => void loadProjectSessions(project.id, projectCursors[project.id] ?? undefined)} />
            )}
          </VStack>
        )}
      </Fragment>
    )
  }

  const projectsSection = (
    <SideNavSection title="Projects" isHeaderHidden>
      <SectionHeader label="Projects" isOpen={!projectsHidden} onToggle={toggleProjects} />
      {!projectsHidden && orderProjects(projectSections.map((section) => section.project), view.order).map(projectItem)}
    </SideNavSection>
  )

  const viewMenu = (
    <DropdownMenu
      renderTrigger={(props) => <IconButton {...props} label="View options" icon={<Icon icon={AdjustmentsHorizontalIcon} size="sm" />} size="sm" variant="ghost" />}
      menuWidth={220}
    >
      <DropdownMenuGroup title="Group by">
        <DropdownMenuRadioGroup label="Group by" value={view.group} onChange={(group) => changeView({ group: group as GroupBy })}>
          <DropdownMenuRadioItem value="project" label="Projects" icon={FolderIcon} />
          <DropdownMenuRadioItem value="environment" label="Environment" icon={ServerStackIcon} />
          <DropdownMenuRadioItem value="list" label="In one list" icon={QueueListIcon} />
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
      <DropdownMenuDivider />
      <DropdownMenuGroup title="Order by">
        <DropdownMenuRadioGroup label="Order by" value={view.order} onChange={(order) => changeView({ order: order as OrderBy })}>
          <DropdownMenuRadioItem value="updated" label="Last updated" icon={ClockIcon} />
          <DropdownMenuRadioItem value="name" label="Name" icon={BarsArrowDownIcon} />
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
      <DropdownMenuDivider />
      <DropdownMenuGroup title="Show">
        <DropdownMenuRadioGroup label="Show" value={view.show} onChange={(show) => changeView({ show: show as ShowChats })}>
          <DropdownMenuRadioItem value="all" label="All chats" icon={ChatBubbleLeftIcon} />
          <DropdownMenuRadioItem value="starred" label="Starred only" icon={StarIcon} />
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
      <DropdownMenuDivider />
      <DropdownMenuItem label="Archived projects…" icon={ArchiveBoxIcon} onClick={() => setArchivedOpen(true)} />
    </DropdownMenu>
  )

  // The Workspace header: parent of Projects and Recents, with search and the view options.
  const workspaceHeader = (
    // Right padding matches the rows' ⋯ menu, so the header icons and the line end where the rows' icons do.
    <VStack gap={2} paddingInlineStart={2} paddingInlineEnd={1} paddingBlockStart={1}>
      <Divider />
      <HStack gap={1} vAlign="center">
        <StackItem size="fill">
          <Text weight="semibold">Workspace</Text>
        </StackItem>
        {/* Ask Agentry: opens the global helper drawer, without leaving this page. */}
        <IconButton label="Ask Agentry" tooltip="Ask Agentry (Ctrl/⌘+Shift+A)" icon={<Icon icon={SparklesIcon} size="sm" />} size="sm" variant="ghost" onClick={() => askAgentryStore.open()} />
        <IconButton
          label={searching ? 'Close search' : 'Search chats'}
          icon={<Icon icon={searching ? XMarkIcon : MagnifyingGlassIcon} size="sm" />}
          size="sm"
          variant="ghost"
          onClick={() => (searching ? closeSearch() : setSearching(true))}
        />
        {viewMenu}
        <IconButton label="New project" icon={<Icon icon={FolderPlusIcon} size="sm" />} size="sm" variant="ghost" onClick={() => setProjectDialog({ isOpen: true, project: null })} />
      </HStack>
      {searching && (
        <TextInput
          label="Search chats"
          isLabelHidden
          type="search"
          size="sm"
          placeholder="Search chats"
          startIcon={MagnifyingGlassIcon}
          value={query}
          onChange={setQuery}
          onKeyDown={(e: React.KeyboardEvent) => e.key === 'Escape' && closeSearch()}
          hasAutoFocus
          hasClear
        />
      )}
    </VStack>
  )

  return (
    <>
      <SideNav
        collapsible={{ isCollapsed: collapsed, onCollapsedChange, buttonLabel: collapsed ? 'Expand sidebar' : 'Collapse sidebar' }}
        header={<SideNavHeading heading="Agentry" headingHref="/" icon={<Icon icon={AgentryMark} color="accent" />} />}
        topContent={
          <VStack gap={2}>
            <SideNavItem label="New chat" icon={PencilSquareIcon} href="/" isSelected={pathname === '/'} size="sm" onClick={(e) => { e.preventDefault(); router.push('/?fresh=1') }} />
            <SideNavItem
              label="Scheduled"
              size="sm"
              icon={ClockIcon}
              href="/scheduled"
              isSelected={pathname.startsWith('/scheduled')}
            />
            <SideNavItem
              label="Agents"
              size="sm"
              icon={UserGroupIcon}
              href="/agents"
              isSelected={pathname.startsWith('/agents')}
            />
            <SideNavItem
              label="Artifacts"
              size="sm"
              icon={RectangleStackIcon}
              href="/artifacts"
              isSelected={pathname.startsWith('/artifacts')}
            />
            <SideNavItem
              label="Plugins"
              size="sm"
              icon={PuzzlePieceIcon}
              href="/plugins"
              isSelected={pathname.startsWith('/plugins')}
            />
            <SideNavItem
              label="Sandboxes"
              size="sm"
              icon={ServerStackIcon}
              href="/sandboxes"
              isSelected={pathname.startsWith('/sandboxes')}
            />
          </VStack>
        }
        footer={
          <UserMenu identity={identity} />
        }
      >
        {workspaceHeader}
        {query.trim() ? (
          <SideNavSection title="Search results">{rows(orderSessions(searchRows, view.order))}</SideNavSection>
        ) : view.show === 'starred' ? (
          <SideNavSection title="Starred">{rows(orderSessions(starred, view.order))}</SideNavSection>
        ) : view.group === 'list' ? (
          <SideNavSection title="All chats" isHeaderHidden>{rows(orderSessions(visible, view.order))}</SideNavSection>
        ) : view.group === 'environment' ? (
          groupByEnvironment(visible, environmentNames, view.order).map((group) => (
            <SideNavSection key={group.key} title={group.title}>{rows(group.sessions)}</SideNavSection>
          ))
        ) : (
          <>
            {projectSections.length > 0 && projectsSection}
            {starred.length > 0 && <SideNavSection title="Starred">{rows(orderSessions(starred, view.order))}</SideNavSection>}
            {recents.length > 0 && (
              <SideNavSection title="Recents" isHeaderHidden>
                <SectionHeader label="Recents" isOpen={!recentsHidden} onToggle={toggleRecents} />
                {!recentsHidden && rows(recents)}
              </SideNavSection>
            )}
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
      <DeleteProjectDialog project={deletingProject} onClose={() => setDeletingProject(null)} />
      <MoveProjectDialog session={moving} projects={projects} onClose={() => setMoving(null)} />
      <ArchivedProjectsDialog isOpen={archivedOpen} onClose={() => setArchivedOpen(false)} />
    </>
  )
}
