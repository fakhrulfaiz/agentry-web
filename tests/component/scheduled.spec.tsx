// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSchedule } from '@/api/types'

const nav = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/scheduled',
  useRouter: () => ({ push: nav.push, refresh: vi.fn(), replace: vi.fn() }),
}))

const apiMock = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  pauseSchedule: vi.fn(),
  resumeSchedule: vi.fn(),
  runSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
}))
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
  for (const fn of Object.values(apiMock)) fn.mockReset()
  auth.goToLogin.mockReset()
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

  it('switches between Yours and Templates with pressed-state chips', async () => {
    apiMock.listSchedules.mockResolvedValue(page([task()]))
    const user = userEvent.setup()
    render(<ScheduledPage />)

    await screen.findByText('Standup')
    expect(screen.getByRole('button', { name: 'Yours' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Templates' })).toHaveAttribute('aria-pressed', 'false')

    await user.click(screen.getByRole('button', { name: 'Templates' }))
    expect(screen.getByRole('button', { name: 'Templates' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Standup')).not.toBeInTheDocument()
    expect(screen.getByText('Daily briefing')).toBeInTheDocument()
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

  it('pauses and resumes a task from its row switch', async () => {
    apiMock.listSchedules.mockResolvedValue(page([task()]))
    apiMock.pauseSchedule.mockResolvedValue(task({ status: 'paused' }))
    apiMock.resumeSchedule.mockResolvedValue(task())
    const user = userEvent.setup()
    render(<ScheduledPage />)

    await user.click(await screen.findByRole('switch', { name: 'Pause Standup' }))
    expect(apiMock.pauseSchedule).toHaveBeenCalledWith('t1')
    const resume = await screen.findByRole('switch', { name: 'Resume Standup' })
    expect(resume).not.toBeChecked()

    await user.click(resume)
    expect(apiMock.resumeSchedule).toHaveBeenCalledWith('t1')
    expect(await screen.findByRole('switch', { name: 'Pause Standup' })).toBeChecked()
  })

  it('reverts the switch and explains a failed pause', async () => {
    apiMock.listSchedules.mockResolvedValue(page([task()]))
    apiMock.pauseSchedule.mockRejectedValue(new ApiError(500, 'http_500', 'Pause failed.'))
    const user = userEvent.setup()
    render(<ScheduledPage />)

    await user.click(await screen.findByRole('switch', { name: 'Pause Standup' }))
    expect(await screen.findByText('Pause failed.')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Pause Standup' })).toBeChecked()
  })

  it('runs a task now and shows why it could not start', async () => {
    apiMock.listSchedules.mockResolvedValue(page([task()]))
    apiMock.runSchedule.mockRejectedValue(new ApiError(409, 'schedule_execution_pending', 'This task is already running.'))
    const user = userEvent.setup()
    render(<ScheduledPage />)

    await user.click(await screen.findByRole('button', { name: 'More options for Standup' }))
    const menu = await screen.findByRole('menu')
    await user.click(within(menu).getByRole('menuitem', { name: 'Run now' }))

    expect(apiMock.runSchedule).toHaveBeenCalledWith('t1')
    expect(await screen.findByText('This task is already running.')).toBeInTheDocument()
  })

  it('deletes a task after confirmation', async () => {
    apiMock.listSchedules.mockResolvedValue(page([task()]))
    apiMock.deleteSchedule.mockResolvedValue({ id: 't1', object: 'agent.schedule.deleted', deleted: true })
    const user = userEvent.setup()
    render(<ScheduledPage />)

    await user.click(await screen.findByRole('button', { name: 'More options for Standup' }))
    const menu = await screen.findByRole('menu')
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(apiMock.deleteSchedule).toHaveBeenCalledWith('t1')
    await waitFor(() => expect(screen.queryByText('Standup')).not.toBeInTheDocument())
    expect(await screen.findByText('No scheduled tasks yet.')).toBeInTheDocument()
  })

  it('keeps the task when the delete is cancelled', async () => {
    apiMock.listSchedules.mockResolvedValue(page([task()]))
    const user = userEvent.setup()
    render(<ScheduledPage />)

    await user.click(await screen.findByRole('button', { name: 'More options for Standup' }))
    const menu = await screen.findByRole('menu')
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(apiMock.deleteSchedule).not.toHaveBeenCalled()
    expect(screen.getByText('Standup')).toBeInTheDocument()
  })

  it('filters the rows by title', async () => {
    apiMock.listSchedules.mockResolvedValue(
      page([task({ id: 't1', title: 'Alpha' }), task({ id: 't2', title: 'Beta', session_id: 'sesn_2', revision: 'r2' })]),
    )
    const user = userEvent.setup()
    render(<ScheduledPage />)

    await screen.findByText('Beta')
    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'Alpha')

    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.queryByText('Beta')).not.toBeInTheDocument()
  })

  it('shows an ended task without a switch', async () => {
    apiMock.listSchedules.mockResolvedValue(page([task({ status: 'ended', next_run_at: null })]))
    render(<ScheduledPage />)

    expect(await screen.findByText('Ended')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })
})
