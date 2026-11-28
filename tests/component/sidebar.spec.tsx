// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import type { OAIAgentSession, OAIListResponse, OAIProject } from '@/api/types'
import { groupSessions } from '@/ui/shell/group'
import { bridgeFetch, startMockApi, type MockApi } from '../helpers/mock-api-flow'

const nav = vi.hoisted(() => ({ pathname: '/', push: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, refresh: vi.fn(), replace: vi.fn() }),
}))

const real = vi.hoisted(() => ({ api: null as typeof import('@/api/client').api | null }))
const apiMock = vi.hoisted(() => ({
  listSessions: vi.fn(),
  listProjects: vi.fn(),
  getProject: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  archiveProject: vi.fn(),
  unarchiveProject: vi.fn(),
  deleteProject: vi.fn(),
  setSessionProject: vi.fn(),
  listAgents: vi.fn(),
  listSandboxEnvironments: vi.fn(),
  renameSession: vi.fn(),
  deleteSession: vi.fn(),
  setStarred: vi.fn(),
  logout: vi.fn(),
}))
vi.mock('@/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/client')>()
  real.api = original.api
  return { ...original, api: apiMock }
})

const { Sidebar, SIDEBAR_COLLAPSED_KEY } = await import('@/ui/shell/Sidebar')
const { MoveProjectDialog } = await import('@/ui/shell/project-actions')
const { Shell } = await import('@/ui/shell/Shell')

const IDENTITY = { owner: 'u-1', roles: ['user'], displayName: 'Ada Lovelace' }
const NOW_S = Math.floor(Date.now() / 1000)
const DAY_S = 86_400

function session(id: string, title: string, createdAt = NOW_S, extra: Record<string, string> = {}): OAIAgentSession {
  return { id, created_at: createdAt, metadata: { title, ...extra } } as unknown as OAIAgentSession
}
const starred = (id: string, title: string, createdAt = NOW_S) => session(id, title, createdAt, { starred: 'true' })
const group = (name: string) => screen.getByRole('group', { name })
/** A Project's folder row in the sidebar; clicking it shows or hides its chats. */
const projectRow = (name: string) => screen.getByRole('button', { name })

function page<T extends { id: string }>(data: T[], hasMore = false): OAIListResponse<T> {
  return { object: 'list', data, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null, has_more: hasMore }
}

function project(id: string, name: string, extra: Partial<OAIProject> = {}): OAIProject {
  return {
    id,
    object: 'project',
    name,
    status: 'active',
    pinned: false,
    agent_id: null,
    environment: null,
    archived_at: null,
    created_at: NOW_S,
    updated_at: NOW_S,
    ...extra,
  }
}

function filed(id: string, title: string, projectId: string | null): OAIAgentSession {
  return { ...session(id, title), project_id: projectId } as OAIAgentSession
}

function before(first: HTMLElement, second: HTMLElement): void {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
}

/** IntersectionObserver stand-in: `intersect()` reports the observed nodes as visible. */
const observers: Array<{ cb: IntersectionObserverCallback; nodes: Element[] }> = []
class FakeObserver {
  private entry: { cb: IntersectionObserverCallback; nodes: Element[] }
  constructor(cb: IntersectionObserverCallback) {
    this.entry = { cb, nodes: [] }
    observers.push(this.entry)
  }
  observe(node: Element) {
    this.entry.nodes.push(node)
  }
  disconnect() {
    this.entry.nodes = []
  }
  unobserve() {}
  takeRecords() {
    return []
  }
}
function intersect() {
  for (const o of observers) {
    if (o.nodes.length) o.cb(o.nodes.map((target) => ({ isIntersecting: true, target }) as IntersectionObserverEntry), {} as IntersectionObserver)
  }
}

function setViewport(mobile: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: mobile && query.includes('768'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  nav.pathname = '/'
  nav.push.mockReset()
  observers.length = 0
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  window.localStorage.clear()
  for (const fn of Object.values(apiMock)) fn.mockReset()
  apiMock.listProjects.mockResolvedValue(page<OAIProject>([]))
  apiMock.listAgents.mockResolvedValue({ object: 'list', data: [], first_id: null, last_id: null, has_more: false })
  apiMock.listSandboxEnvironments.mockResolvedValue({ object: 'list', data: [], has_more: false })
  // @ts-expect-error jsdom has no matchMedia by default; astryx then assumes desktop.
  delete window.matchMedia
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('groupSessions', () => {
  it('groups by local calendar date: Today, Yesterday, Previous 7 days, Previous 30 days, Older', () => {
    const now = new Date(2026, 10, 9, 0, 30) // 00:30 local, Nov 9
    const at = (d: Date) => Math.floor(d.getTime() / 1000)
    const s = [
      { id: 'a', created_at: at(new Date(2026, 10, 9, 0, 0)) }, // midnight today
      { id: 'b', created_at: at(new Date(2026, 10, 8, 23, 59)) }, // one minute before midnight
      { id: 'c', created_at: at(new Date(2026, 10, 8, 0, 0)) }, // start of yesterday
      { id: 'd', created_at: at(new Date(2026, 10, 7, 23, 59)) }, // the day before
      { id: 'e', created_at: at(new Date(2026, 10, 2, 0, 0)) }, // 7 days before today
      { id: 'f', created_at: at(new Date(2026, 10, 1, 23, 0)) }, // 8 days before
      { id: 'g', created_at: at(new Date(2026, 9, 10, 0, 0)) }, // 30 days before
      { id: 'h', created_at: at(new Date(2025, 0, 1)) },
    ]
    const g = groupSessions(s, now)
    expect(g.today.map((x) => x.id)).toEqual(['a'])
    expect(g.yesterday.map((x) => x.id)).toEqual(['b', 'c'])
    expect(g.week.map((x) => x.id)).toEqual(['d', 'e'])
    expect(g.month.map((x) => x.id)).toEqual(['f', 'g'])
    expect(g.older.map((x) => x.id)).toEqual(['h'])
  })
})

describe('Sidebar', () => {
  it('shows sessions under Today / … / Older with links to each chat', async () => {
    apiMock.listSessions.mockResolvedValue(
      page([session('s1', 'Plan the launch'), session('s2', 'Old notes', NOW_S - 400 * DAY_S)]),
    )
    render(<Sidebar identity={IDENTITY} />)
    const link = await screen.findByRole('link', { name: 'Plan the launch' })
    expect(link).toHaveAttribute('href', '/c/s1')
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Older')).toBeInTheDocument()
    expect(screen.queryByText('Yesterday')).not.toBeInTheDocument()
    expect(apiMock.listSessions).toHaveBeenCalledWith({ limit: 30 })
  })

  it('title search filters the loaded rows, and scrolling to the end loads the next page', async () => {
    apiMock.listSessions.mockImplementation(async (q: { after?: string; metadata?: unknown }) =>
      q.metadata ? page([]) : q.after ? page([session('s3', 'Launch retro')]) : page([session('s1', 'Plan the launch'), session('s2', 'Fix the build')], true),
    )
    const user = userEvent.setup()
    render(<Sidebar identity={IDENTITY} />)
    await screen.findByRole('link', { name: 'Plan the launch' })

    await user.type(screen.getByRole('searchbox', { name: 'Search chats' }), 'launch')
    expect(screen.getByRole('link', { name: 'Plan the launch' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Fix the build' })).not.toBeInTheDocument()

    act(() => intersect())
    expect(await screen.findByRole('link', { name: 'Launch retro' })).toBeInTheDocument()
    expect(apiMock.listSessions).toHaveBeenCalledWith({ limit: 30, after: 's2' })
    expect(screen.queryByRole('link', { name: 'Fix the build' })).not.toBeInTheDocument()

    await user.clear(screen.getByRole('searchbox', { name: 'Search chats' }))
    expect(screen.getByRole('link', { name: 'Fix the build' })).toBeInTheDocument()
  })

  it('rename updates the row', async () => {
    apiMock.listSessions.mockResolvedValue(page([session('s1', 'Plan the launch')]))
    apiMock.renameSession.mockResolvedValue({ title: 'Launch plan v2' })
    const user = userEvent.setup()
    render(<Sidebar identity={IDENTITY} />)
    await screen.findByRole('link', { name: 'Plan the launch' })

    await user.click(screen.getByRole('button', { name: 'Options for Plan the launch' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    const field = await screen.findByRole('textbox', { name: 'Title' })
    await user.clear(field)
    await user.type(field, 'Launch plan v2')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('link', { name: 'Launch plan v2' })).toBeInTheDocument()
    expect(apiMock.renameSession).toHaveBeenCalledWith('s1', 'Launch plan v2')
    expect(screen.queryByRole('link', { name: 'Plan the launch' })).not.toBeInTheDocument()
  })

  it('delete asks for confirmation, then removes the row', async () => {
    apiMock.listSessions.mockResolvedValue(page([session('s1', 'Plan the launch'), session('s2', 'Fix the build')]))
    apiMock.deleteSession.mockResolvedValue(undefined)
    nav.pathname = '/c/s1'
    const user = userEvent.setup()
    render(<Sidebar identity={IDENTITY} />)
    await screen.findByRole('link', { name: 'Plan the launch' })

    await user.click(screen.getByRole('button', { name: 'Options for Plan the launch' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText(/Plan the launch/)).toBeInTheDocument()
    expect(apiMock.deleteSession).not.toHaveBeenCalled()

    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Plan the launch' })).not.toBeInTheDocument())
    expect(apiMock.deleteSession).toHaveBeenCalledWith('s1')
    expect(screen.getByRole('link', { name: 'Fix the build' })).toBeInTheDocument()
    // Deleting the open chat leaves it.
    expect(nav.push).toHaveBeenCalledWith('/')
  })

  it('cancelling the confirmation keeps the row', async () => {
    apiMock.listSessions.mockResolvedValue(page([session('s1', 'Plan the launch')]))
    const user = userEvent.setup()
    render(<Sidebar identity={IDENTITY} />)
    await screen.findByRole('link', { name: 'Plan the launch' })
    await user.click(screen.getByRole('button', { name: 'Options for Plan the launch' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(apiMock.deleteSession).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Plan the launch' })).toBeInTheDocument()
  })

  it('lists starred chats in a Starred section above the date groups, and not again under them', async () => {
    apiMock.listSessions.mockResolvedValue(page([session('s1', 'Plan the launch'), starred('s2', 'Fix the build'), starred('s3', 'Old notes', NOW_S - 10 * DAY_S)]))
    render(<Sidebar identity={IDENTITY} />)
    await screen.findByRole('link', { name: 'Plan the launch' })
    const star = group('Starred')
    expect(within(star).getAllByRole('link').map((a) => a.textContent)).toEqual(['Fix the build', 'Old notes'])
    expect(within(group('Today')).getAllByRole('link').map((a) => a.textContent)).toEqual(['Plan the launch'])
    expect(screen.queryByRole('group', { name: 'Previous 30 days' })).not.toBeInTheDocument()
    // Starred comes first.
    expect(star.compareDocumentPosition(group('Today')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('the Starred section comes from the metadata filter, so a starred chat beyond the loaded pages shows', async () => {
    apiMock.listSessions.mockImplementation(async (q: { metadata?: Record<string, string> }) =>
      q.metadata ? page([starred('s9', 'Ancient plan', NOW_S - 400 * DAY_S)]) : page([session('s1', 'Plan the launch')], true),
    )
    render(<Sidebar identity={IDENTITY} />)
    await screen.findByRole('link', { name: 'Plan the launch' })
    expect(await within(await screen.findByRole('group', { name: 'Starred' })).findByRole('link', { name: 'Ancient plan' })).toBeInTheDocument()
    expect(apiMock.listSessions).toHaveBeenCalledWith({ limit: 100, metadata: { starred: 'true' } })
  })

  it('Star moves a chat into Starred at once and broadcasts the change; Unstar moves it back', async () => {
    apiMock.listSessions.mockResolvedValue(page([session('s1', 'Plan the launch')]))
    let resolve!: (m: Record<string, string>) => void
    apiMock.setStarred.mockImplementation(() => new Promise((r) => (resolve = r)))
    const heard: unknown[] = []
    const listen = (e: Event) => heard.push((e as CustomEvent).detail)
    window.addEventListener('agentry:sessions-changed', listen)
    const user = userEvent.setup()
    render(<Sidebar identity={IDENTITY} />)
    await screen.findByRole('link', { name: 'Plan the launch' })
    expect(screen.queryByRole('group', { name: 'Starred' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Options for Plan the launch' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Star' }))
    // Optimistic: before the API answers.
    expect(await within(group('Starred')).findByRole('link', { name: 'Plan the launch' })).toBeInTheDocument()
    expect(apiMock.setStarred).toHaveBeenCalledWith('s1', true)
    expect(heard).toContainEqual({ id: 's1', metadata: { title: 'Plan the launch', starred: 'true' } })
    await act(async () => resolve({ title: 'Plan the launch', starred: 'true' }))

    apiMock.setStarred.mockResolvedValue({ title: 'Plan the launch' })
    await user.click(screen.getByRole('button', { name: 'Options for Plan the launch' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Unstar' }))
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Starred' })).not.toBeInTheDocument())
    expect(within(group('Today')).getByRole('link', { name: 'Plan the launch' })).toBeInTheDocument()
    expect(apiMock.setStarred).toHaveBeenLastCalledWith('s1', false)
    window.removeEventListener('agentry:sessions-changed', listen)
  })

  it('a failed star rolls back and shows an error toast', async () => {
    apiMock.listSessions.mockResolvedValue(page([session('s1', 'Plan the launch')]))
    apiMock.setStarred.mockRejectedValue(new Error('boom'))
    const user = userEvent.setup()
    render(<Sidebar identity={IDENTITY} />)
    await screen.findByRole('link', { name: 'Plan the launch' })
    await user.click(screen.getByRole('button', { name: 'Options for Plan the launch' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Star' }))
    expect(await screen.findByText('Could not star the chat. Try again.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Starred' })).not.toBeInTheDocument())
    expect(within(group('Today')).getByRole('link', { name: 'Plan the launch' })).toBeInTheDocument()
  })

  it('applies a change another part of the app broadcasts, without reloading', async () => {
    apiMock.listSessions.mockResolvedValue(page([session('s1', 'Plan the launch'), session('s2', 'Fix the build')]))
    render(<Sidebar identity={IDENTITY} />)
    await screen.findByRole('link', { name: 'Plan the launch' })
    const calls = apiMock.listSessions.mock.calls.length
    act(() => {
      window.dispatchEvent(new CustomEvent('agentry:sessions-changed', { detail: { id: 's1', metadata: { title: 'Renamed', starred: 'true' } } }))
    })
    expect(within(group('Starred')).getByRole('link', { name: 'Renamed' })).toBeInTheDocument()
    act(() => {
      window.dispatchEvent(new CustomEvent('agentry:sessions-changed', { detail: { id: 's2', deleted: true } }))
    })
    expect(screen.queryByRole('link', { name: 'Fix the build' })).not.toBeInTheDocument()
    expect(apiMock.listSessions.mock.calls.length).toBe(calls)
  })

  it('remembers the collapsed state in localStorage', async () => {
    apiMock.listSessions.mockResolvedValue(page([]))
    const user = userEvent.setup()
    const first = render(<Sidebar identity={IDENTITY} />)
    await user.click(await screen.findByRole('button', { name: 'Collapse sidebar' }))
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('1')
    first.unmount()

    render(<Sidebar identity={IDENTITY} />)
    expect(await screen.findByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
  })

  it('works when localStorage throws', async () => {
    apiMock.listSessions.mockResolvedValue(page([]))
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const user = userEvent.setup()
    render(<Sidebar identity={IDENTITY} />)
    await user.click(await screen.findByRole('button', { name: 'Collapse sidebar' }))
    expect(await screen.findByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
  })

  it('shows the user menu with owner and roles', async () => {
    apiMock.listSessions.mockResolvedValue(page([]))
    const user = userEvent.setup()
    render(<Sidebar identity={IDENTITY} />)
    await user.click(await screen.findByRole('button', { name: /Ada Lovelace/ }))
    expect(await screen.findByRole('menuitem', { name: /u-1/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /user/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('renders pinned and active project sections before starred and recent', async () => {
    apiMock.listProjects.mockResolvedValue(page([project('p_pin', 'Pinned work', { pinned: true }), project('p_active', 'Other work')]))
    apiMock.listSessions.mockImplementation(async (q: { metadata?: unknown; projectId?: string }) =>
      q.metadata || q.projectId ? page([]) : page([session('s1', 'One-off chat'), starred('s2', 'Starred chat')]),
    )
    render(<Sidebar identity={IDENTITY} />)
    await screen.findByRole('link', { name: 'One-off chat' })

    const pinned = projectRow('Pinned work')
    const active = projectRow('Other work')
    const star = group('Starred')
    const today = group('Today')
    before(pinned, active)
    before(active, star)
    before(star, today)
    await userEvent.setup().click(pinned)
    expect(await within(group('Pinned work')).findByRole('link', { name: 'New chat here' })).toHaveAttribute('href', '/?project=p_pin')
    expect(apiMock.listProjects).toHaveBeenCalledWith({ status: 'active' })
  })

  it('loads filtered sessions only when a project section is expanded', async () => {
    apiMock.listProjects.mockResolvedValue(page([project('p1', 'Website work')]))
    apiMock.listSessions.mockImplementation(async (q: { metadata?: unknown; projectId?: string }) =>
      q.metadata ? page([]) : q.projectId ? page([filed('s1', 'Website chat', 'p1')]) : page([session('s2', 'One-off chat')]),
    )
    const user = userEvent.setup()
    render(<Sidebar identity={IDENTITY} />)
    await screen.findByRole('link', { name: 'One-off chat' })
    // The client turns `{ projectId }` into the `project_id` query checked in the API client tests.
    expect(apiMock.listSessions).not.toHaveBeenCalledWith({ projectId: 'p1' })

    await user.click(projectRow('Website work'))
    expect(await screen.findByRole('link', { name: 'Website chat' })).toBeInTheDocument()
    expect(apiMock.listSessions).toHaveBeenCalledWith({ projectId: 'p1' })
    expect(apiMock.listSessions).toHaveBeenCalledTimes(3) // global page, starred page, filtered page
  })

  it('moves a chat to a project and back to unfiled', async () => {
    let attached: string | null = null
    apiMock.listProjects.mockResolvedValue(page([project('p1', 'Website work')]))
    apiMock.listSessions.mockImplementation(async (q: { metadata?: unknown; projectId?: string }) =>
      q.metadata
        ? page([])
        : q.projectId
          ? page(attached === q.projectId ? [filed('s1', 'Launch notes', 'p1')] : [])
          : page(attached ? [] : [session('s1', 'Launch notes')]),
    )
    apiMock.setSessionProject.mockImplementation(async (_id: string, next: string | null) => {
      attached = next
      return filed('s1', 'Launch notes', next)
    })
    const user = userEvent.setup()
    render(<Sidebar identity={IDENTITY} />)
    await screen.findByRole('link', { name: 'Launch notes' })

    await user.click(screen.getByRole('button', { name: 'Options for Launch notes' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Move to project…' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('combobox', { name: 'Project' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('combobox', { name: 'Project' }))
    await user.click(await screen.findByRole('option', { name: 'Website work' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(apiMock.setSessionProject).toHaveBeenCalledWith('s1', 'p1')

    await user.click(projectRow('Website work'))
    expect(await within(group('Website work')).findByRole('link', { name: 'Launch notes' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Options for Launch notes' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Unfiled' }))
    expect(apiMock.setSessionProject).toHaveBeenLastCalledWith('s1', null)
    expect(await within(group('Today')).findByRole('link', { name: 'Launch notes' })).toBeInTheDocument()
    await waitFor(() => expect(within(group('Website work')).queryByRole('link', { name: 'Launch notes' })).not.toBeInTheDocument())
  })

  it('hides an archived project from active sections', async () => {
    let archived = true
    apiMock.listProjects.mockImplementation(async () =>
      page([project('p1', 'Archived work', { status: archived ? 'archived' : 'active' }), project('p2', 'Active work')]),
    )
    apiMock.listSessions.mockResolvedValue(page([]))
    apiMock.unarchiveProject.mockImplementation(async () => {
      archived = false
      return project('p1', 'Archived work', { status: 'active' })
    })
    const user = userEvent.setup()
    render(<Sidebar identity={IDENTITY} />)
    await waitFor(() => expect(projectRow('Active work')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Archived work' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Project options' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Archived projects' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Archived work')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Unarchive' }))
    expect(apiMock.unarchiveProject).toHaveBeenCalledWith('p1')
    await waitFor(() => expect(projectRow('Archived work')).toBeInTheDocument())
  })

  it('asks before deleting a project and keeps it when cancelled or refused with 409', async () => {
    apiMock.listProjects.mockResolvedValue(page([project('p1', 'Website work')]))
    apiMock.listSessions.mockResolvedValue(page([]))
    const user = userEvent.setup()
    render(<Sidebar identity={IDENTITY} />)
    await waitFor(() => expect(projectRow('Website work')).toBeInTheDocument())
    const openDelete = async () => {
      await user.click(screen.getByRole('button', { name: 'Options for Website work' }))
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
      return screen.findByRole('alertdialog')
    }

    const confirm = await openDelete()
    expect(within(confirm).getByText(/Website work/)).toBeInTheDocument()
    expect(apiMock.deleteProject).not.toHaveBeenCalled()
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(apiMock.deleteProject).not.toHaveBeenCalled()
    expect(projectRow('Website work')).toBeInTheDocument()

    apiMock.deleteProject.mockRejectedValueOnce(new ApiError(409, 'project_has_sessions', 'Project has sessions'))
    const refused = await openDelete()
    await user.click(within(refused).getByRole('button', { name: 'Delete' }))
    expect(refused).toHaveTextContent('Project has sessions')
    expect(projectRow('Website work')).toBeInTheDocument()
    await user.click(within(refused).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    apiMock.deleteProject.mockResolvedValueOnce({ id: 'p1', object: 'project.deleted', deleted: true })
    apiMock.listProjects.mockResolvedValue(page([]))
    const accepted = await openDelete()
    await user.click(within(accepted).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(apiMock.deleteProject).toHaveBeenCalledTimes(2))
    expect(apiMock.deleteProject).toHaveBeenNthCalledWith(1, 'p1')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Website work' })).not.toBeInTheDocument())
  })

  it('shows a load error and a retry for a project whose chats fail to load', async () => {
    let fail = true
    apiMock.listProjects.mockResolvedValue(page([project('p1', 'Website work')]))
    apiMock.listSessions.mockImplementation(async (q: { metadata?: unknown; projectId?: string }) => {
      if (q.metadata) return page([])
      if (q.projectId === 'p1') {
        return fail ? Promise.reject(new ApiError(500, 'boom', 'Could not load chats')) : page([filed('s1', 'Website chat', 'p1')])
      }
      return page([])
    })
    const user = userEvent.setup()
    render(<Sidebar identity={IDENTITY} />)
    await waitFor(() => expect(projectRow('Website work')).toBeInTheDocument())
    await user.click(projectRow('Website work'))

    const section = group('Website work')
    expect(await within(section).findByText('Could not load chats')).toBeInTheDocument()
    expect(within(section).queryByText('No chats yet.')).not.toBeInTheDocument()
    fail = false
    await user.click(within(section).getByRole('button', { name: 'Retry' }))
    expect(await within(section).findByRole('link', { name: 'Website chat' })).toBeInTheDocument()
    expect(within(section).queryByText('Could not load chats')).not.toBeInTheDocument()
  })

  it('treats an archived current project as Unfiled in the move dialog', async () => {
    apiMock.setSessionProject.mockResolvedValue(undefined)
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<MoveProjectDialog session={filed('s1', 'Chat in archived work', 'p_archived')} projects={[project('p1', 'Active work')]} onClose={onClose} />)

    const dialog = await screen.findByRole('dialog')
    const selector = within(dialog).getByRole('combobox', { name: 'Project' })
    expect(selector).toHaveTextContent('Unfiled')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(apiMock.setSessionProject).toHaveBeenCalledWith('s1', null)
    expect(onClose).toHaveBeenCalled()
  })

  it('lists every page of archived projects', async () => {
    apiMock.listProjects.mockImplementation(async (q: { status?: string; after?: string }) => {
      if (q.status !== 'archived') return page([])
      const first = page([project('a1', 'Old one', { status: 'archived' }), project('a2', 'Old two', { status: 'archived' })], true)
      return q.after === 'a2' ? page([project('a3', 'Old three', { status: 'archived' })]) : first
    })
    apiMock.listSessions.mockResolvedValue(page([]))
    const user = userEvent.setup()
    render(<Sidebar identity={IDENTITY} />)
    await user.click(await screen.findByRole('button', { name: 'Project options' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Archived projects' }))

    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Old three')).toBeInTheDocument()
    expect(apiMock.listProjects).toHaveBeenCalledWith({ status: 'archived', after: 'a2' })
  })

  it('links new chat here to /?project=<id>', async () => {
    apiMock.listProjects.mockResolvedValue(page([project('p1', 'Website work')]))
    apiMock.listSessions.mockResolvedValue(page([]))
    const user = userEvent.setup()
    render(<Sidebar identity={IDENTITY} />)
    await waitFor(() => expect(projectRow('Website work')).toBeInTheDocument())
    await user.click(projectRow('Website work'))
    expect(within(group('Website work')).getByRole('link', { name: 'New chat here' })).toHaveAttribute('href', '/?project=p1')

    await user.click(screen.getByRole('button', { name: 'Options for Website work' }))
    expect(await screen.findByRole('menuitem', { name: 'New chat here' })).toBeInTheDocument()
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Pin' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  })

  it('shows one-off chats under recent date groups', async () => {
    apiMock.listProjects.mockResolvedValue(page([project('p1', 'Website work')]))
    apiMock.listSessions.mockImplementation(async (q: { metadata?: unknown; projectId?: string }) =>
      q.metadata || q.projectId ? page([]) : page([session('s1', 'One-off chat'), filed('s2', 'Filed chat', 'p1')]),
    )
    render(<Sidebar identity={IDENTITY} />)
    await screen.findByRole('link', { name: 'One-off chat' })
    expect(within(group('Today')).getByRole('link', { name: 'One-off chat' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Filed chat' })).not.toBeInTheDocument()
  })

  it('creates a project with its name, agent, environment and pinned flag', async () => {
    apiMock.listSessions.mockResolvedValue(page([]))
    apiMock.listAgents.mockResolvedValue({ object: 'list', data: [{ id: 'a1', name: 'Research' }], first_id: null, last_id: null, has_more: false })
    apiMock.listSandboxEnvironments.mockResolvedValue({ object: 'list', data: [{ id: 'e1', name: 'Python data' }], has_more: false })
    apiMock.createProject.mockResolvedValue(project('p2', 'Launch project'))
    const heard: string[] = []
    const listen = () => heard.push('changed')
    window.addEventListener('agentry:projects-changed', listen)
    const user = userEvent.setup()
    render(<Sidebar identity={IDENTITY} />)
    await user.click(await screen.findByRole('button', { name: 'New project' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Launch project')
    await user.click(within(dialog).getByRole('combobox', { name: 'Default agent' }))
    await user.click(await screen.findByRole('option', { name: 'Research' }))
    await user.click(within(dialog).getByRole('combobox', { name: 'Environment' }))
    await user.click(await screen.findByRole('option', { name: 'Python data' }))
    await user.click(within(dialog).getByRole('switch', { name: 'Pinned' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(apiMock.createProject).toHaveBeenCalledWith({
      name: 'Launch project',
      agent_id: 'a1',
      environment: { type: 'sandbox', environment_id: 'e1' },
      pinned: true,
    })
    expect(heard).toContain('changed')
    window.removeEventListener('agentry:projects-changed', listen)
  })

  it('search filters chats loaded into expanded project sections', async () => {
    apiMock.listProjects.mockResolvedValue(page([project('p1', 'Website work')]))
    apiMock.listSessions.mockImplementation(async (q: { metadata?: unknown; projectId?: string }) =>
      q.metadata ? page([]) : q.projectId ? page([filed('s1', 'Website chat', 'p1')]) : page([]),
    )
    const user = userEvent.setup()
    render(<Sidebar identity={IDENTITY} />)
    await waitFor(() => expect(projectRow('Website work')).toBeInTheDocument())
    await user.click(projectRow('Website work'))
    expect(await screen.findByRole('link', { name: 'Website chat' })).toBeInTheDocument()

    const search = screen.getByRole('searchbox', { name: 'Search chats' })
    await user.type(search, 'no such chat')
    expect(group('Search results')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Website chat' })).not.toBeInTheDocument()
    expect(screen.getByText('No chats match.')).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'Website chat')
    expect(await screen.findByRole('link', { name: 'Website chat' })).toBeInTheDocument()
    expect(screen.queryByText('No chats match.')).not.toBeInTheDocument()
  })
})

describe('Sidebar with the mock API', () => {
  let mock: MockApi

  beforeEach(async () => {
    mock = await startMockApi()
    await mock.reset()
    vi.stubGlobal('fetch', bridgeFetch(mock.base))
    apiMock.listProjects.mockImplementation((q: Parameters<NonNullable<typeof real.api>['listProjects']>[0]) => real.api!.listProjects(q))
    apiMock.listSessions.mockImplementation((q: Parameters<NonNullable<typeof real.api>['listSessions']>[0]) => real.api!.listSessions(q))
  }, 20_000)

  afterEach(async () => {
    vi.unstubAllGlobals()
    if (mock) await mock.stop()
  })

  it('shows a one-off chat under recent but not in the Project-filtered list', async () => {
    const project = await real.api!.createProject({ name: 'Website work' })
    const filed = await real.api!.createSession({ text: 'Website chat', model: 'mock-model', projectId: project.id })
    const oneOff = await real.api!.createSession({ text: 'One-off chat', model: 'mock-model' })
    const user = userEvent.setup()
    render(<Sidebar identity={IDENTITY} />)
    await screen.findByRole('link', { name: 'One-off chat' })
    expect(within(group('Today')).getByRole('link', { name: 'One-off chat' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Website chat' })).not.toBeInTheDocument()

    await user.click(projectRow('Website work'))
    expect(await within(group('Website work')).findByRole('link', { name: 'Website chat' })).toBeInTheDocument()
    expect(within(group('Website work')).queryByRole('link', { name: 'One-off chat' })).not.toBeInTheDocument()

    const filtered = await real.api!.listSessions({ projectId: project.id })
    expect(filtered.data.map((s) => s.id)).toEqual([filed.id])
    expect(filtered.data.map((s) => s.id)).not.toContain(oneOff.id)
  }, 20_000)

  it('creates, edits, archives and deletes Projects, and moves chats in and out', async () => {
    const created = await real.api!.createProject({
      name: 'Website work',
      pinned: true,
      agent_id: 'agent_writer',
      environment: { type: 'sandbox', environment_id: 'env_1' },
    })
    expect(await real.api!.getProject(created.id)).toEqual(created)
    const renamed = await real.api!.updateProject(created.id, { name: 'Launch work', pinned: false })
    expect(renamed).toMatchObject({ name: 'Launch work', pinned: false })
    expect((await real.api!.listProjects({ status: 'active' })).data.map((p) => p.name)).toEqual(['Launch work'])

    const filed = await real.api!.createSession({ text: 'Filed chat', model: 'mock-model', projectId: created.id })
    expect(filed).toMatchObject({ project_id: created.id, agent: { id: 'agent_writer' }, environment: { type: 'sandbox', environment_id: 'env_1' } })
    expect((await real.api!.listSessions({ projectId: created.id })).data.map((s) => s.id)).toEqual([filed.id])
    await real.api!.setSessionProject(filed.id, null)
    expect((await real.api!.getSession(filed.id)).project_id).toBeNull()
    await real.api!.setSessionProject(filed.id, created.id)

    expect((await real.api!.archiveProject(created.id)).status).toBe('archived')
    expect((await real.api!.listProjects({ status: 'active' })).data).toEqual([])
    expect((await real.api!.listProjects({ status: 'archived' })).data.map((p) => p.id)).toEqual([created.id])
    expect((await real.api!.unarchiveProject(created.id)).status).toBe('active')
    await expect(real.api!.deleteProject(created.id)).rejects.toMatchObject({ status: 409, code: 'project_has_sessions' })
    await real.api!.setSessionProject(filed.id, null)
    expect(await real.api!.deleteProject(created.id)).toEqual({ id: created.id, object: 'project.deleted', deleted: true })
    await expect(real.api!.getProject(created.id)).rejects.toMatchObject({ status: 404 })
  }, 20_000)
})

describe('Shell', () => {
  it('renders the sidebar inline at desktop width', async () => {
    setViewport(false)
    apiMock.listSessions.mockResolvedValue(page([session('s1', 'Plan the launch')]))
    render(<Shell identity={IDENTITY}>content</Shell>)
    expect(await screen.findByRole('link', { name: 'Plan the launch' })).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the sidebar as a drawer below 768px', async () => {
    setViewport(true)
    apiMock.listSessions.mockResolvedValue(page([session('s1', 'Plan the launch')]))
    const user = userEvent.setup()
    render(<Shell identity={IDENTITY}>content</Shell>)
    await waitFor(() => expect(apiMock.listSessions).toHaveBeenCalled())
    expect(screen.queryByRole('link', { name: 'Plan the launch' })).not.toBeInTheDocument()

    const toggle = screen.getAllByRole('button').find((b) => /navigation|menu/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))
    expect(toggle).toBeDefined()
    await user.click(toggle!)
    const drawer = await screen.findByRole('dialog')
    expect(await within(drawer).findByRole('link', { name: 'Plan the launch' })).toBeInTheDocument()
  })
})
