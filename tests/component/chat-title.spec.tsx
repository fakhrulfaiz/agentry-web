// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/c/s1',
  useRouter: () => ({ push: nav.push, refresh: vi.fn(), replace: vi.fn() }),
}))

const apiMock = vi.hoisted(() => ({
  renameSession: vi.fn(),
  deleteSession: vi.fn(),
  setStarred: vi.fn(),
}))
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  api: apiMock,
}))

const { ChatTitleMenu } = await import('@/ui/shell/ChatTitleMenu')
const { SESSIONS_CHANGED } = await import('@/ui/shell/session-actions')

const title = (name: string) => screen.getByRole('button', { name })
const openMenu = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(title(name))
  return screen.findByRole('menu')
}

beforeEach(() => {
  nav.push.mockReset()
  for (const fn of Object.values(apiMock)) fn.mockReset()
})
afterEach(() => cleanup())

describe('ChatTitleMenu', () => {
  it('shows the title as a menu button, and "New chat" for an untitled chat', () => {
    const { rerender } = render(<ChatTitleMenu sessionId="s1" metadata={{ title: 'Plan the launch' }} />)
    expect(title('Plan the launch')).toHaveAttribute('aria-haspopup')
    rerender(<ChatTitleMenu sessionId="s2" metadata={{}} />)
    expect(title('New chat')).toBeInTheDocument()
  })

  it('offers Star, Rename and Delete; Star stars the chat at once and then offers Unstar', async () => {
    apiMock.setStarred.mockResolvedValue({ title: 'Plan the launch', starred: 'true' })
    const heard: unknown[] = []
    const listen = (e: Event) => heard.push((e as CustomEvent).detail)
    window.addEventListener(SESSIONS_CHANGED, listen)
    const user = userEvent.setup()
    render(<ChatTitleMenu sessionId="s1" metadata={{ title: 'Plan the launch' }} />)

    const menu = await openMenu(user, 'Plan the launch')
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Star', 'Rename', 'Delete'])
    await user.click(within(menu).getByRole('menuitem', { name: 'Star' }))
    expect(apiMock.setStarred).toHaveBeenCalledWith('s1', true)
    expect(heard[0]).toEqual({ id: 's1', metadata: { title: 'Plan the launch', starred: 'true' } })

    const again = await openMenu(user, 'Plan the launch')
    await user.click(within(again).getByRole('menuitem', { name: 'Unstar' }))
    expect(apiMock.setStarred).toHaveBeenLastCalledWith('s1', false)
    window.removeEventListener(SESSIONS_CHANGED, listen)
  })

  it('a failed star rolls back and shows an error toast', async () => {
    apiMock.setStarred.mockRejectedValue(new Error('boom'))
    const user = userEvent.setup()
    render(<ChatTitleMenu sessionId="s1" metadata={{ title: 'Plan the launch', starred: 'true' }} />)
    const menu = await openMenu(user, 'Plan the launch')
    await user.click(within(menu).getByRole('menuitem', { name: 'Unstar' }))
    expect(await screen.findByText('Could not unstar the chat. Try again.')).toBeInTheDocument()
    const again = await openMenu(user, 'Plan the launch')
    expect(within(again).getByRole('menuitem', { name: 'Unstar' })).toBeInTheDocument()
  })

  it('Rename opens the shared dialog and updates the title', async () => {
    apiMock.renameSession.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<ChatTitleMenu sessionId="s1" metadata={{ title: 'Plan the launch' }} />)
    const menu = await openMenu(user, 'Plan the launch')
    await user.click(within(menu).getByRole('menuitem', { name: 'Rename' }))
    const field = await screen.findByRole('textbox', { name: 'Title' })
    await user.clear(field)
    await user.type(field, 'Launch plan v2')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(apiMock.renameSession).toHaveBeenCalledWith('s1', 'Launch plan v2')
    expect(await screen.findByRole('button', { name: 'Launch plan v2' })).toBeInTheDocument()
  })

  it('Delete confirms, deletes and goes home', async () => {
    apiMock.deleteSession.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<ChatTitleMenu sessionId="s1" metadata={{ title: 'Plan the launch' }} />)
    const menu = await openMenu(user, 'Plan the launch')
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(apiMock.deleteSession).not.toHaveBeenCalled()
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/'))
    expect(apiMock.deleteSession).toHaveBeenCalledWith('s1')
  })

  it('follows a rename or star broadcast from elsewhere (the sidebar) for its own chat only', async () => {
    render(<ChatTitleMenu sessionId="s1" metadata={{ title: 'Plan the launch' }} />)
    act(() => {
      window.dispatchEvent(new CustomEvent(SESSIONS_CHANGED, { detail: { id: 's2', metadata: { title: 'Other' } } }))
    })
    expect(title('Plan the launch')).toBeInTheDocument()
    act(() => {
      window.dispatchEvent(new CustomEvent(SESSIONS_CHANGED, { detail: { id: 's1', metadata: { title: 'Renamed' } } }))
    })
    expect(title('Renamed')).toBeInTheDocument()
  })
})
