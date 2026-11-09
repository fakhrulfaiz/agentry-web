// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OAIAgentSession, OAIListResponse } from '@/api/types'
import { groupSessions } from '@/ui/shell/group'

const nav = vi.hoisted(() => ({ pathname: '/', push: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, refresh: vi.fn(), replace: vi.fn() }),
}))

const apiMock = vi.hoisted(() => ({
  listSessions: vi.fn(),
  renameSession: vi.fn(),
  deleteSession: vi.fn(),
  setStarred: vi.fn(),
  logout: vi.fn(),
}))
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  api: apiMock,
}))

const { Sidebar, SIDEBAR_COLLAPSED_KEY } = await import('@/ui/shell/Sidebar')
const { Shell } = await import('@/ui/shell/Shell')

const IDENTITY = { owner: 'u-1', roles: ['user'], displayName: 'Ada Lovelace' }
const NOW_S = Math.floor(Date.now() / 1000)
const DAY_S = 86_400

function session(id: string, title: string, createdAt = NOW_S, extra: Record<string, string> = {}): OAIAgentSession {
  return { id, created_at: createdAt, metadata: { title, ...extra } } as unknown as OAIAgentSession
}
const starred = (id: string, title: string, createdAt = NOW_S) => session(id, title, createdAt, { starred: 'true' })
const group = (name: string) => screen.getByRole('group', { name })

function page(data: OAIAgentSession[], hasMore = false): OAIListResponse<OAIAgentSession> {
  return { object: 'list', data, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null, has_more: hasMore }
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
  // @ts-expect-error jsdom has no matchMedia by default; astryx then assumes desktop.
  delete window.matchMedia
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('groupSessions', () => {
  it('groups by local calendar date', () => {
    const now = new Date(2026, 10, 9, 0, 30) // 00:30 local, Nov 9
    const at = (d: Date) => Math.floor(d.getTime() / 1000)
    const s = [
      { id: 'a', created_at: at(new Date(2026, 10, 9, 0, 0)) }, // midnight today
      { id: 'b', created_at: at(new Date(2026, 10, 8, 23, 59)) }, // one minute before midnight
      { id: 'c', created_at: at(new Date(2026, 10, 8, 0, 0)) }, // start of yesterday
      { id: 'd', created_at: at(new Date(2026, 10, 7, 23, 59)) }, // the day before
      { id: 'e', created_at: at(new Date(2025, 0, 1)) },
    ]
    const g = groupSessions(s, now)
    expect(g.today.map((x) => x.id)).toEqual(['a'])
    expect(g.yesterday.map((x) => x.id)).toEqual(['b', 'c'])
    expect(g.earlier.map((x) => x.id)).toEqual(['d', 'e'])
  })
})

describe('Sidebar', () => {
  it('shows sessions under Today / Yesterday / Earlier with links to each chat', async () => {
    apiMock.listSessions.mockResolvedValue(
      page([session('s1', 'Plan the launch'), session('s2', 'Old notes', NOW_S - 400 * DAY_S)]),
    )
    render(<Sidebar identity={IDENTITY} />)
    const link = await screen.findByRole('link', { name: 'Plan the launch' })
    expect(link).toHaveAttribute('href', '/c/s1')
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Earlier')).toBeInTheDocument()
    expect(screen.queryByText('Yesterday')).not.toBeInTheDocument()
    expect(apiMock.listSessions).toHaveBeenCalledWith({ limit: 30 })
  })

  it('title search filters the loaded rows, and scrolling to the end loads the next page', async () => {
    apiMock.listSessions
      .mockResolvedValueOnce(page([session('s1', 'Plan the launch'), session('s2', 'Fix the build')], true))
      .mockResolvedValueOnce(page([session('s3', 'Launch retro')]))
    const user = userEvent.setup()
    render(<Sidebar identity={IDENTITY} />)
    await screen.findByRole('link', { name: 'Plan the launch' })

    await user.type(screen.getByRole('searchbox', { name: 'Search chats' }), 'launch')
    expect(screen.getByRole('link', { name: 'Plan the launch' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Fix the build' })).not.toBeInTheDocument()

    act(() => intersect())
    expect(await screen.findByRole('link', { name: 'Launch retro' })).toBeInTheDocument()
    expect(apiMock.listSessions).toHaveBeenLastCalledWith({ limit: 30, after: 's2' })
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
    expect(screen.queryByRole('group', { name: 'Earlier' })).not.toBeInTheDocument()
    // Starred comes first.
    expect(star.compareDocumentPosition(group('Today')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
