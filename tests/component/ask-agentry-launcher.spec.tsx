// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), pathname: '/' }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/ui/chat/AskAgentryPanel', () => ({
  AskAgentryPanel: () => <div>AskAgentryPanel stub</div>,
}))

const apiMock = vi.hoisted(() => ({ listSessions: vi.fn(), listProjects: vi.fn(), listSkills: vi.fn(), listCommands: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/client')>()
  return {
    ...original,
    api: {
      ...original.api,
      listSessions: apiMock.listSessions,
      listProjects: apiMock.listProjects,
      listSkills: apiMock.listSkills,
      listCommands: apiMock.listCommands,
    },
  }
})

const { askAgentryStore } = await import('@/ui/shell/ask-agentry-store')
const { AskAgentryLauncher } = await import('@/ui/shell/AskAgentryLauncher')
const { Shell } = await import('@/ui/shell/Shell')

beforeEach(() => {
  nav.push.mockReset()
  nav.replace.mockReset()
  nav.pathname = '/'
  localStorage.clear()
  askAgentryStore.reset()
  apiMock.listSessions.mockResolvedValue({ object: 'list', data: [], has_more: false })
  apiMock.listProjects.mockResolvedValue({ object: 'list', data: [], has_more: false })
  apiMock.listSkills.mockResolvedValue({ object: 'list', data: [] })
  apiMock.listCommands.mockResolvedValue({ object: 'list', data: [] })
})
afterEach(() => {
  askAgentryStore.close()
  cleanup()
})

describe('global Ask Agentry launcher', () => {
  it('does not mount the chat on pages where the drawer is never opened', () => {
    render(<AskAgentryLauncher />)
    expect(screen.queryByText('AskAgentryPanel stub')).not.toBeInTheDocument()
  })

  it('opens the drawer in place from the floating button', async () => {
    render(<AskAgentryLauncher />)
    await userEvent.click(screen.getByRole('button', { name: 'Ask Agentry' }))
    expect(screen.getByText('AskAgentryPanel stub')).toBeInTheDocument()
    expect(nav.push).not.toHaveBeenCalled()
  })

  it('closes the drawer when opening the helper chat full-size', async () => {
    askAgentryStore.setSession('sess_1')
    askAgentryStore.open()
    render(<AskAgentryLauncher />)
    await userEvent.click(screen.getByRole('link', { name: 'Open full chat' }))
    expect(askAgentryStore.get().isOpen).toBe(false)
    expect(screen.getByRole('link', { name: 'Open full chat' })).toHaveAttribute('href', '/c/sess_1')
  })

  it('starts a new helper chat from the drawer header', async () => {
    askAgentryStore.setSession('sess_1')
    askAgentryStore.open()
    render(<AskAgentryLauncher />)
    await userEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(askAgentryStore.get().sessionId).toBeNull()
    expect(askAgentryStore.get().isOpen).toBe(true)
    expect(nav.push).not.toHaveBeenCalled()
  })

  it('opens the same drawer with the keyboard shortcut', async () => {
    render(<AskAgentryLauncher />)
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true, shiftKey: true })
    expect(askAgentryStore.get().isOpen).toBe(true)
    expect(screen.getByText('AskAgentryPanel stub')).toBeInTheDocument()
  })

  it('opens the sidebar entry without navigating away', async () => {
    render(<Shell identity={{ owner: 'tester', roles: [], displayName: 'Tester' }}><div>Page content</div></Shell>)
    // The sidebar icon is the small one; the floating button is the other one.
    const sidebarButton = (await screen.findAllByRole('button', { name: 'Ask Agentry' })).find((button) => button.getAttribute('data-size') === 'sm')
    expect(sidebarButton).toBeDefined()
    await userEvent.click(sidebarButton!)
    expect(screen.getByText('AskAgentryPanel stub')).toBeInTheDocument()
    expect(nav.push).not.toHaveBeenCalled()
  })
})
