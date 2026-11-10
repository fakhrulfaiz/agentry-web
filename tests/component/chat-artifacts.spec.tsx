// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionDeliverableEntry } from '@/api/types'

const apiMock = vi.hoisted(() => ({ listSessionDeliverables: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  api: apiMock,
}))

const { SessionArtifacts } = await import('@/ui/chat/SessionArtifacts')

const entry = (path: string): SessionDeliverableEntry => ({ path, turn_id: 'turn_1', created_at: 1_762_765_200 })

beforeEach(() => {
  apiMock.listSessionDeliverables.mockReset()
})
afterEach(cleanup)

describe('SessionArtifacts', () => {
  it("shows the chat's files as cards with kind subtitle and download and previews them", async () => {
    apiMock.listSessionDeliverables.mockResolvedValue({ object: 'list', data: [entry('artificial-intelligence.docx'), entry('make_docx.py')] })
    const user = userEvent.setup()
    render(<SessionArtifacts sessionId="sesn_1" enabled />)

    const strip = await screen.findByRole('list', { name: 'Files in this chat' })
    expect(within(strip).getByText('Document · DOCX')).toBeInTheDocument()
    expect(within(strip).getByText('Code · PY')).toBeInTheDocument()
    expect(within(strip).getByRole('link', { name: 'Download artificial-intelligence.docx' })).toHaveAttribute(
      'href',
      '/api/agentry/agents/sessions/sesn_1/artifacts/artificial-intelligence.docx?download=1',
    )
    await user.click(within(strip).getByRole('button', { name: 'File artificial-intelligence.docx' }))

    // Clicking a card opens the chat's preview panel (a no-op without a provider), not a dialog.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('uses the delivery description as the card subtitle and drops files outside the workspace', async () => {
    apiMock.listSessionDeliverables.mockResolvedValue({
      object: 'list',
      data: [{ ...entry('report.docx'), description: 'Final report' }, entry('/tmp/elsewhere.png')],
    })
    render(<SessionArtifacts sessionId="sesn_1" enabled />)
    const strip = await screen.findByRole('list', { name: 'Files in this chat' })
    expect(within(strip).getByText('Final report')).toBeInTheDocument()
    expect(within(strip).queryByText('elsewhere.png')).not.toBeInTheDocument()
  })

  it('re-reads the listing when the chat turns idle, hides itself without files', async () => {
    apiMock.listSessionDeliverables.mockResolvedValue({ object: 'list', data: [] })
    const { rerender } = render(<SessionArtifacts sessionId="sesn_1" enabled={false} />)
    expect(screen.queryByRole('list', { name: 'Files in this chat' })).not.toBeInTheDocument()
    expect(apiMock.listSessionDeliverables).not.toHaveBeenCalled()

    rerender(<SessionArtifacts sessionId="sesn_1" enabled />)
    await waitFor(() => expect(apiMock.listSessionDeliverables).toHaveBeenCalledWith('sesn_1'))
    expect(screen.queryByRole('list', { name: 'Files in this chat' })).not.toBeInTheDocument()
  })

  it('stays quiet when the session has no workspace', async () => {
    apiMock.listSessionDeliverables.mockRejectedValue(new Error('no workspace'))
    render(<SessionArtifacts sessionId="sesn_1" enabled />)
    await waitFor(() => expect(apiMock.listSessionDeliverables).toHaveBeenCalled())
    expect(screen.queryByRole('list', { name: 'Files in this chat' })).not.toBeInTheDocument()
  })
})
