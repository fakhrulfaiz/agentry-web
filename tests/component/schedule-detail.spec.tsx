// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSchedule, AgentScheduleRun, ScheduleRunList } from '@/api/types'

const nav = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/scheduled/t1',
  useRouter: () => ({ push: nav.push, refresh: vi.fn(), replace: vi.fn() }),
}))

const apiMock = vi.hoisted(() => ({
  getSchedule: vi.fn(),
  listScheduleRuns: vi.fn(),
  pauseSchedule: vi.fn(),
  resumeSchedule: vi.fn(),
  runSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  updateSchedule: vi.fn(),
}))
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  api: apiMock,
}))

const auth = vi.hoisted(() => ({ goToLogin: vi.fn() }))
vi.mock('@/chat/use-conversation', () => auth)

const { ScheduleDetail } = await import('@/ui/scheduled/ScheduleDetail')
const { ApiError } = await import('@/api/client')

const task = (patch: Partial<AgentSchedule> = {}): AgentSchedule => ({
  id: 't1',
  object: 'agent.schedule',
  title: 'Standup',
  prompt: 'Summarise the standup and email it to me.',
  timing: { kind: 'weekly', weekly: { time: '08:00:00.000', time_zone: 'UTC', weekdays: [1, 2, 3, 4, 5] } },
  status: 'active',
  next_run_at: '2027-01-04T08:00:00.000Z',
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
  revision: 'r1',
  session_id: 'sesn_party',
  running: false,
  last_run: null,
  ...patch,
})

const run = (patch: Partial<AgentScheduleRun> = {}): AgentScheduleRun => ({
  scheduled_at: '2026-11-03T08:00:00.000Z',
  delivered_at: '2026-11-03T08:00:04.000Z',
  message_id: 'msg_1',
  session_id: 'sesn_1',
  ...patch,
})

const runsPage = (data: AgentScheduleRun[], patch: Partial<ScheduleRunList> = {}): ScheduleRunList => ({
  object: 'list',
  data,
  has_more: false,
  next_before: null,
  ...patch,
})

const openEditor = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /More options/ }))
  await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
  return await screen.findByRole('dialog', { name: 'Edit rule' })
}

beforeEach(() => {
  nav.push.mockReset()
  for (const fn of Object.values(apiMock)) fn.mockReset()
  auth.goToLogin.mockReset()
  apiMock.getSchedule.mockImplementation(async () => task())
  apiMock.listScheduleRuns.mockImplementation(async () => runsPage([run()]))
  apiMock.pauseSchedule.mockImplementation(async () => task({ status: 'paused' }))
  apiMock.resumeSchedule.mockImplementation(async () => task())
  apiMock.runSchedule.mockImplementation(async () => task())
  apiMock.deleteSchedule.mockImplementation(async () => ({ id: 't1', object: 'agent.schedule.deleted', deleted: true }))
  apiMock.updateSchedule.mockImplementation(async (_id, body) => {
    const patch = body as Partial<AgentSchedule>
    const updated = task({ title: patch.title, prompt: patch.prompt, updated_at: '2026-11-10T09:00:00.000Z', revision: 'r2' })
    apiMock.getSchedule.mockImplementation(async () => updated)
    return updated
  })
})
afterEach(() => {
  cleanup()
})

describe('ScheduleDetail', () => {
  it('the read view shows the summary and the history side by side', async () => {
    render(<ScheduleDetail id="t1" />)

    expect(await screen.findByRole('heading', { name: 'Standup' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Pause Standup' })).toBeChecked()
    expect(screen.getByText('Weekdays at 8:00 AM')).toBeInTheDocument()
    expect(screen.getByText(/Summarise the standup/)).toBeInTheDocument()
    const chatLinks = screen.getAllByRole('link', { name: 'Open chat' })
    // One for the run row, one for the task's linked session.
    expect(chatLinks).toHaveLength(2)
    expect(screen.getByRole('table')).toBeInTheDocument()
    // Nothing overlays the page until editing starts.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('the history rows link to their run’s chat, older pages via Load more', async () => {
    apiMock.listScheduleRuns.mockImplementation(async () =>
      runsPage([run({ message_id: 'msg_1' })], { has_more: true, next_before: 'msg_1' }),
    )
    const user = userEvent.setup()
    render(<ScheduleDetail id="t1" />)

    const list = await screen.findByRole('table')
    expect(within(list).getAllByRole('link').map((l) => l.getAttribute('href'))).toContain('/c/sesn_1')

    apiMock.listScheduleRuns.mockImplementation(async () =>
      runsPage([run({ message_id: 'msg_0', delivered_at: '2026-11-02T08:00:00.000Z' })]),
    )
    await user.click(await screen.findByRole('button', { name: 'Load more' }))
    await waitFor(() => expect(apiMock.listScheduleRuns).toHaveBeenLastCalledWith('t1', { limit: 20, before: 'msg_1' }))
    expect(within(screen.getByRole('table')).getAllByRole('link', { name: 'Open chat' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('an empty history says so instead of a table', async () => {
    apiMock.listScheduleRuns.mockImplementation(async () => runsPage([]))
    render(<ScheduleDetail id="t1" />)

    await screen.findByRole('heading', { name: 'Standup' })

    await screen.findByText('No runs yet')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('a minutes rule opens with an Interval row and saves its translated every rule', async () => {
    apiMock.getSchedule.mockImplementation(async () =>
      task({ timing: { kind: 'every', every_seconds: 900 } }),
    )
    const user = userEvent.setup()
    render(<ScheduleDetail id="t1" />)

    await screen.findByRole('heading', { name: 'Standup' })
    const drawer = await openEditor(user)

    // 900 s → 15 minutes; the Repeat label and decoded interval reflect that.
    expect(within(drawer).getByRole('button', { name: 'Every N minutes' })).toBeInTheDocument()
    expect(within(drawer).getByLabelText('Interval')).toHaveValue('15')
    expect(within(drawer).queryByLabelText('Time')).not.toBeInTheDocument()
    expect(within(drawer).queryByText('Time zone')).not.toBeInTheDocument()

    // Editing the name enables Save; saving re-posts the decoded, translated rule.
    await user.type(within(drawer).getByLabelText('Task name'), ' too')
    await user.click(within(drawer).getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(apiMock.updateSchedule).toHaveBeenCalledWith('t1', {
        title: 'Standup too',
        prompt: 'Summarise the standup and email it to me.',
        timing: { kind: 'every', every_seconds: 900 },
        revision: 'r1',
      }),
    )
  })

  it('Run now calls the run endpoint and reloads the schedule and its newest history page', async () => {
    const user = userEvent.setup()
    render(<ScheduleDetail id="t1" />)

    await screen.findByRole('button', { name: 'Run now' })
    await user.click(screen.getByRole('button', { name: 'Run now' }))

    await waitFor(() => expect(apiMock.runSchedule).toHaveBeenCalledWith('t1'))
    await waitFor(() => expect(apiMock.getSchedule).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(apiMock.listScheduleRuns).toHaveBeenCalledTimes(2))
    expect(nav.push).not.toHaveBeenCalled()
  })

  it('a refused run (409) shows the message; pausing and resuming use their endpoints', async () => {
    apiMock.runSchedule.mockRejectedValue(
      new ApiError(409, 'schedule_execution_pending', 'The task is already running.'),
    )
    const user = userEvent.setup()
    render(<ScheduleDetail id="t1" />)

    await screen.findByRole('button', { name: 'Run now' })
    await user.click(screen.getByRole('button', { name: 'Run now' }))

    await screen.findByText(/already running/i)
    await user.click(screen.getByRole('switch', { name: 'Pause Standup' }))
    await waitFor(() => expect(apiMock.pauseSchedule).toHaveBeenCalledWith('t1'))
    expect(apiMock.resumeSchedule).not.toHaveBeenCalled()
  })

  it('Edit opens the rules drawer pre-filled with the task; Discard closes it', async () => {
    const user = userEvent.setup()
    render(<ScheduleDetail id="t1" />)

    await screen.findByRole('heading', { name: 'Standup' })
    const drawer = await openEditor(user)

    expect(within(drawer).getByLabelText('Task name')).toHaveValue('Standup')
    expect(within(drawer).getByLabelText('Task instruction')).toHaveValue('Summarise the standup and email it to me.')
    expect(within(drawer).getByLabelText('Time')).toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'Save changes' })).toBeDisabled()

    await user.click(within(drawer).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit rule' })).not.toBeInTheDocument())
    // The page underneath still shows the read view.
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('changing the rule enables Save; saving posts title, prompt, timing and revision, then closes', async () => {
    const user = userEvent.setup()
    render(<ScheduleDetail id="t1" />)

    await screen.findByRole('heading', { name: 'Standup' })
    const drawer = await openEditor(user)

    await user.type(within(drawer).getByLabelText('Task name'), ' too')
    await user.click(within(drawer).getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(apiMock.updateSchedule).toHaveBeenCalledWith('t1', {
        title: 'Standup too',
        prompt: 'Summarise the standup and email it to me.',
        timing: {
          kind: 'weekly',
          weekly: { time: '08:00:00.000', time_zone: 'UTC', weekdays: [1, 2, 3, 4, 5] },
        },
        revision: 'r1',
      }),
    )
    await waitFor(() => expect(apiMock.getSchedule).toHaveBeenCalledTimes(2))
    // The header reflects the saved task; the drawer is gone.
    expect(await screen.findByRole('heading', { name: 'Standup too' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit rule' })).not.toBeInTheDocument())
  })

  it('a refused save (409 schedule_conflict) shows the message and keeps the drawer open', async () => {
    apiMock.updateSchedule.mockImplementation(async () => {
      throw new ApiError(409, 'schedule_conflict', 'The task changed elsewhere: reload before saving.')
    })
    const user = userEvent.setup()
    render(<ScheduleDetail id="t1" />)

    await screen.findByRole('heading', { name: 'Standup' })
    const drawer = await openEditor(user)
    await user.type(within(drawer).getByLabelText('Task name'), ' too')
    await user.click(within(drawer).getByRole('button', { name: 'Save changes' }))

    await within(drawer).findByText(/changed elsewhere/i)
    expect(screen.getByRole('dialog', { name: 'Edit rule' })).toBeInTheDocument()
  })

  it('the /edit route opens the drawer right away (pre-edit=1) and Discard closes it', async () => {
    const user = userEvent.setup()
    render(<ScheduleDetail id="t1" initialEdit />)

    const drawer = await screen.findByRole('dialog', { name: 'Edit rule' })
    expect(within(drawer).getByLabelText('Task name')).toHaveValue('Standup')
    await user.type(within(drawer).getByLabelText('Task name'), ' x')
    await user.click(within(drawer).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit rule' })).not.toBeInTheDocument())
  })
  it('Delete confirms, calls the delete endpoint and returns to the list', async () => {
    const user = userEvent.setup()
    render(<ScheduleDetail id="t1" />)

    await screen.findByRole('heading', { name: 'Standup' })
    await user.click(screen.getByRole('button', { name: /More options/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(apiMock.deleteSchedule).toHaveBeenCalledWith('t1'))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/scheduled'))
  })

  it('a missing task (404) renders the not-found notice without fetching runs', async () => {
    apiMock.getSchedule.mockRejectedValue(new ApiError(404, 'resource_not_found', 'No schedule found'))
    render(<ScheduleDetail id="t1" />)

    await screen.findByText(/no such task|not found/i)
    expect(apiMock.listScheduleRuns).not.toHaveBeenCalled()
  })

  it('a signed-out session goes to login', async () => {
    apiMock.getSchedule.mockRejectedValue(new ApiError(401, 'session_expired', 'Sign in again'))
    const { goToLogin } = auth
    render(<ScheduleDetail id="t1" />)

    await waitFor(() => expect(goToLogin).toHaveBeenCalled())
  })

  it('an ended task hides the switch and says so', async () => {
    apiMock.getSchedule.mockImplementation(async () => task({ status: 'ended', next_run_at: null }))
    render(<ScheduleDetail id="t1" />)

    await screen.findByRole('heading', { name: 'Standup' })
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.getByText(/ended/i)).toBeInTheDocument()
  })
})
