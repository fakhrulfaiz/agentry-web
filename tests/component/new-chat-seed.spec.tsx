// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), query: '' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.query),
  usePathname: () => '/',
}))

const apiMock = vi.hoisted(() => ({ models: vi.fn(), createSession: vi.fn(), listSkills: vi.fn(), listCommands: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), api: apiMock }))
vi.mock('@/chat/use-conversation', () => ({ goToLogin: vi.fn() }))
vi.mock('@/ui/shell/TopBar', () => ({ TopBar: () => null }))

const { NewChat } = await import('@/ui/chat/NewChat')
const { scheduleSeedText } = await import('@/schedule/seed')

const input = () => screen.queryByRole('combobox', { name: 'Message input' }) ?? screen.getByRole('textbox', { name: 'Message input' })

beforeEach(() => {
  nav.push.mockReset()
  nav.replace.mockReset()
  apiMock.models.mockResolvedValue(['m1'])
})
afterEach(() => cleanup())

describe('New chat prefill from the URL', () => {
  it.each([
    ['docs', '/office-docx'],
    ['slides', '/office-pptx'],
    ['data', '/office-xlsx'],
  ])('?seed=%s starts the composer with %s and clears the query', async (seed, text) => {
    nav.query = `seed=${seed}`
    render(<NewChat />)
    await waitFor(() => expect(input()).toHaveTextContent(text))
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/'))
  })

  it('?schedule=1 starts the composer with the schedule request and the browser time zone, then clears the query', async () => {
    nav.query = 'schedule=1'
    render(<NewChat />)
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    await waitFor(() => expect(input()).toHaveTextContent(`Set up a scheduled task:`))
    expect(input()).toHaveTextContent(`My time zone is ${zone}.`)
    expect(scheduleSeedText(zone)).toContain(zone)
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/'))
  })

  it('?prompt= prefills sanitized, length-limited text without sending, then clears the query', async () => {
    nav.query = `prompt=${encodeURIComponent(`Connect my Gmail account\n\u0007${'x'.repeat(500)}`)}`
    render(<NewChat />)
    await waitFor(() => expect(input()).toHaveTextContent('Connect my Gmail account x'))
    expect(input().textContent?.length).toBeLessThanOrEqual(200)
    expect(apiMock.createSession).not.toHaveBeenCalled()
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/'))
  })

  it('an unknown seed or no query leaves the composer empty and does not rewrite the URL', async () => {
    nav.query = ''
    render(<NewChat />)
    await waitFor(() => expect(input()).toBeInTheDocument())
    expect(input()).toHaveTextContent('')
    expect(nav.replace).not.toHaveBeenCalled()
    cleanup()
    nav.query = 'seed=nope'
    render(<NewChat />)
    await waitFor(() => expect(input()).toBeInTheDocument())
    expect(input()).toHaveTextContent('')
  })
})

describe('New chat send', () => {
  it('shows the message and thinking state before the session exists, and restores the composer on failure', async () => {
    nav.query = ''
    let fail!: (e: Error) => void
    apiMock.createSession.mockReturnValue(new Promise((_, reject) => { fail = reject }))
    render(<NewChat />)
    await waitFor(() => expect(input()).toBeInTheDocument())
    await userEvent.type(input(), 'hello world{Enter}')
    await waitFor(() => expect(screen.getByText('Agentry is thinking…')).toBeInTheDocument(), { timeout: 5000 })
    expect(screen.getAllByText('hello world').length).toBeGreaterThan(0)
    fail(new Error('boom'))
    await waitFor(() => expect(screen.queryByText('Agentry is thinking…')).not.toBeInTheDocument(), { timeout: 5000 })
    await waitFor(() => expect(input()).toHaveTextContent('hello world'), { timeout: 5000 })
  })
}, 15_000)
