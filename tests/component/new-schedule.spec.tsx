// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/scheduled/new',
  useRouter: () => ({ push: nav.push, refresh: vi.fn(), replace: vi.fn() }),
}))
const apiMock = vi.hoisted(() => ({ createSchedule: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  api: apiMock,
}))
const auth = vi.hoisted(() => ({ goToLogin: vi.fn() }))
vi.mock('@/chat/use-conversation', () => auth)

const { NewSchedule } = await import('@/ui/scheduled/NewSchedule')
const { ApiError } = await import('@/api/client')
const { ScheduleFields } = await import('@/ui/scheduled/ScheduleFields')
const { EMPTY_FORM } = await import('@/schedule/form')

beforeEach(() => {
  nav.push.mockReset()
  apiMock.createSchedule.mockReset()
})
afterEach(() => cleanup())

describe('NewSchedule', () => {
  it('prefills from a template', () => {
    render(<NewSchedule templateId="daily-briefing" />)
    expect(screen.getByLabelText('Task name')).toHaveValue('Daily briefing')
    expect(screen.getByLabelText('Task instruction')).toHaveDisplayValue(/short briefing/)
  })

  it('refuses an empty name and instruction', async () => {
    const user = userEvent.setup()
    render(<NewSchedule />)
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Enter a name.')).toBeInTheDocument()
    expect(screen.getByText('Enter an instruction.')).toBeInTheDocument()
    expect(apiMock.createSchedule).not.toHaveBeenCalled()
  })

  it('creates with title, prompt and timing, then opens the task', async () => {
    apiMock.createSchedule.mockResolvedValue({ id: 'sched_9' })
    const user = userEvent.setup()
    render(<NewSchedule templateId="weekly-review" />)
    await user.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/scheduled/sched_9'))
    const body = apiMock.createSchedule.mock.calls[0][0]
    expect(body.title).toBe('Weekly review')
    expect(body.prompt).toContain('Friday')
    expect(body.timing.kind).toBe('weekly')
    expect(body.timing.weekly.weekdays).toEqual([5])
  })

  it('shows an API error inline and stays on the page', async () => {
    apiMock.createSchedule.mockRejectedValue(new ApiError(400, 'invalid_rule', 'Bad rule.'))
    const user = userEvent.setup()
    render(<NewSchedule templateId="daily-briefing" />)
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Bad rule.')).toBeInTheDocument()
    expect(nav.push).not.toHaveBeenCalled()
  })

  it('Cancel returns to the list', async () => {
    const user = userEvent.setup()
    render(<NewSchedule />)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(nav.push).toHaveBeenCalledWith('/scheduled')
  })
})

describe('ScheduleFields', () => {
  it('reports edits as partial values and shows the weekly weekday row', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(<ScheduleFields values={{ ...EMPTY_FORM, timeZone: 'UTC' }} onChange={onChange} />)
    await user.type(screen.getByLabelText('Task name'), 'A')
    expect(onChange).toHaveBeenCalledWith({ title: 'A' })
    expect(screen.queryByText('Weekday')).not.toBeInTheDocument()
    rerender(<ScheduleFields values={{ ...EMPTY_FORM, frequency: 'weekly', timeZone: 'UTC' }} onChange={onChange} />)
    expect(screen.getByText('Weekday')).toBeInTheDocument()
  })
})
