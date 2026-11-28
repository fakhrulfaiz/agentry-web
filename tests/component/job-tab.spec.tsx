// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OAIJob } from '@/api/types'
import { EMPTY_BROWSER } from '@/chat/browser-tools'
import { JOB_POLL_MS } from '@/chat/jobs'
import { PanelConversationContext, type PanelConversation } from '@/chat/panel-data'
import { PreviewPanelProvider, usePreviewPanel } from '@/preview/store'
import { PreviewPanel } from '@/ui/preview/PreviewPanel'

const api = vi.hoisted(() => ({
  listSessionArtifacts: vi.fn(async () => ({ object: 'list', data: [] })),
  job: vi.fn(),
  killJob: vi.fn(),
}))
vi.mock('@/api/client', () => ({ api, ApiError: class ApiError extends Error { status = 0 } }))

const NOW = 1_764_230_100
const job = (over: Partial<OAIJob> = {}): OAIJob => ({
  id: 'bash-1', object: 'agent.session.job', session_id: 's1', kind: 'bash', command: 'npm run build\n--verbose', status: 'running',
  detail: null, exit_code: null, started_at: NOW - 65, finished_at: null, ...over,
})

function data(jobs: OAIJob[]): PanelConversation {
  return { tasks: [], jobs, subagentViews: [], todos: [], browser: EMPTY_BROWSER, items: new Map(), actions: new Map(), answer: async () => {} }
}

let controls: ReturnType<typeof usePreviewPanel>['actions'] | null = null
function Controls() {
  controls = usePreviewPanel().actions
  return null
}
const mount = (value: PanelConversation) =>
  render(
    <PreviewPanelProvider sessionId="s1">
      <PanelConversationContext.Provider value={value}>
        <Controls />
        <PreviewPanel sessionId="s1" idle />
      </PanelConversationContext.Provider>
    </PreviewPanelProvider>,
  )

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(NOW * 1000)
  api.job.mockReset()
  api.killJob.mockReset()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('background jobs in the Tasks tab', () => {
  it('lists jobs past the grace period with status and elapsed time, and counts them on Start', async () => {
    mount(data([job(), job({ id: 'bash-2', command: 'ls', started_at: NOW - 1 }), job({ id: 'bash-3', command: 'make', status: 'completed', exit_code: 2, finished_at: NOW - 60 })]))
    act(() => controls!.showStart())
    expect(await screen.findByRole('button', { name: /^Tasks/ })).toHaveTextContent('2 running')
    act(() => controls!.openView('tasks', 'Tasks'))
    const list = await screen.findByTestId('tasks-list')
    const row = within(list).getByRole('button', { name: 'Open npm run build' })
    expect(row).toHaveTextContent('Running')
    expect(row).toHaveTextContent('1m 5s')
    expect(within(list).getByRole('button', { name: 'Open make' })).toHaveTextContent('Exit 2')
    // Too young: a quick foreground command is not listed yet.
    expect(within(list).queryByRole('button', { name: 'Open ls' })).not.toBeInTheDocument()
  })

  it('opens a job tab with its output, re-reads it while running, and stops it after confirming', async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })
    api.job.mockResolvedValueOnce(job({ output: { text: 'step 1\n', total_bytes: 7, truncated: false } }))
    api.job.mockResolvedValue(job({ output: { text: 'step 1\nstep 2\n', total_bytes: 14, truncated: true } }))
    api.killJob.mockResolvedValue({ outcome: 'cancellation_requested', job: job({ status: 'stopping' }) })
    mount(data([job()]))
    act(() => controls!.openView('tasks', 'Tasks'))
    await user.click(await screen.findByRole('button', { name: 'Open npm run build' }))
    const tab = await screen.findByTestId('job-tab')
    expect(await within(tab).findByLabelText('Output')).toHaveTextContent('step 1')
    expect(api.job).toHaveBeenCalledWith('s1', 'bash-1', expect.any(AbortSignal))
    await act(async () => { await vi.advanceTimersByTimeAsync(JOB_POLL_MS) })
    await waitFor(() => expect(within(tab).getByLabelText('Output')).toHaveTextContent('step 2'))
    expect(within(tab).getByText('Showing the newest output only.')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'npm run build' })).toHaveAttribute('aria-selected', 'true')

    await user.click(within(tab).getByRole('button', { name: 'Stop' }))
    expect(api.killJob).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(api.killJob).toHaveBeenCalledWith('s1', 'bash-1'))
    expect(await within(tab).findByText('Stopping')).toBeInTheDocument()
  })

  it('stops re-reading once the job settles', async () => {
    api.job.mockResolvedValue(job({ status: 'completed', exit_code: 0, finished_at: NOW, output: { text: 'ok\n', total_bytes: 3, truncated: false } }))
    mount(data([job({ status: 'completed', exit_code: 0, finished_at: NOW })]))
    act(() => controls!.openView('job:bash-1', 'npm run build'))
    expect(await screen.findByLabelText('Output')).toHaveTextContent('ok')
    await act(async () => { await vi.advanceTimersByTimeAsync(JOB_POLL_MS * 3) })
    expect(api.job).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
  })
})
