// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSchedule } from '@/api/types'

const nav = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/scheduled',
  useRouter: () => ({ push: nav.push, refresh: vi.fn(), replace: vi.fn() }),
}))

const apiMock = vi.hoisted(() => ({ listSchedules: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  api: apiMock,
}))

const auth = vi.hoisted(() => ({ goToLogin: vi.fn() }))
vi.mock('@/chat/use-conversation', () => auth)

const { ScheduledPage } = await import('@/ui/scheduled/ScheduledPage')
const { ApiError } = await import('@/api/client')
const { SESSIONS_CHANGED } = await import('@/ui/shell/session-actions')

const task = (patch: Partial<AgentSchedule> = {}): AgentSchedule => ({
  id: 't1',
  object: 'agent.schedule',
  title: 'Standup',
  prompt: 'Summarise the standup.',
  timing: { kind: 'weekly', weekly: { time: '08:00:00.000', time_zone: 'UTC', weekdays: [1, 2, 3, 4, 5] } },
  status: 'active',
  next_run_at: '2026-11-10T08:00:00.000Z',
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
  revision: 'r1',
  session_id: 'sesn_1',
  running: false,
  last_run: null,
  ...patch,
})

const page = (data: AgentSchedule[]) => ({
  object: 'list' as const,
  data,
  first_id: data[0]?.id ?? null,
  last_id: data.at(-1)?.id ?? null,
  has_more: false,
})

beforeEach(() => {
  nav.push.mockReset()
  apiMock.listSchedules.mockReset()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ScheduledPage', () => {
  it('shows the empty state with the setup button and the four templates', async () => {
    apiMock.listSchedules.mockResolvedValue(page([]))
    render(<ScheduledPage />)

    expect(await screen.findByText('No scheduled tasks yet.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Scheduled tasks' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set up manually' })).toBeInTheDocument()
    for (const title of ['Daily briefing', 'Weekly review', 'Monitor a topic', 'Content ideas']) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0)
    }
  })

  it('lists the tasks with their schedule copy and a link to the detail page', async () => {
    apiMock.listSchedules.mockResolvedValue(page([task()]))
    render(<ScheduledPage />)

    expect(await screen.findByText('Standup')).toBeInTheDocument()
    expect(screen.getByText('Weekdays at 8:00 AM')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Standup/ })).toHaveAttribute('href', '/scheduled/t1')
  })

  it('opens the create form from the empty state', async () => {
    apiMock.listSchedules.mockResolvedValue(page([]))
    const user = userEvent.setup()
    render(<ScheduledPage />)

    await user.click(await screen.findByRole('button', { name: 'Set up manually' }))
    expect(nav.push).toHaveBeenCalledWith('/scheduled/new')
  })

  it('shows the backend message and a Retry action when schedules are unavailable', async () => {
    apiMock.listSchedules
      .mockRejectedValueOnce(new ApiError(501, 'schedules_unavailable', 'Scheduled tasks are not available yet.'))
      .mockResolvedValueOnce(page([]))
    const user = userEvent.setup()
    render(<ScheduledPage />)

    expect(await screen.findByText('Scheduled tasks are not available yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(apiMock.listSchedules).toHaveBeenCalledTimes(2))
  })

  it('sends a signed-out user to the login page', async () => {
    auth.goToLogin.mockReset()
    apiMock.listSchedules.mockRejectedValue(new ApiError(401, 'signed_out', 'Sign in again.'))
    render(<ScheduledPage />)

    await waitFor(() => expect(auth.goToLogin).toHaveBeenCalled())
  })

  it('reloads when a chat creates a task', async () => {
    apiMock.listSchedules.mockResolvedValue(page([]))
    render(<ScheduledPage />)
    await screen.findByText('No scheduled tasks yet.')

    apiMock.listSchedules.mockResolvedValue(page([task()]))
    window.dispatchEvent(new CustomEvent(SESSIONS_CHANGED))
    expect(await screen.findByText('Standup')).toBeInTheDocument()
  })
})
