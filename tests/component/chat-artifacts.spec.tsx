// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionArtifactEntry } from '@/api/types'

const apiMock = vi.hoisted(() => ({ listSessionArtifacts: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  api: apiMock,
}))

const { SessionArtifacts } = await import('@/ui/chat/SessionArtifacts')

const entry = (path: string): SessionArtifactEntry => ({ path, size: 7, last_modified: '2026-11-10T09:00:00.000Z' })

beforeEach(() => {
  apiMock.listSessionArtifacts.mockReset()
})
afterEach(cleanup)

describe('SessionArtifacts', () => {
  it("shows the chat's files as cards above the composer and previews them", async () => {
    apiMock.listSessionArtifacts.mockResolvedValue({ object: 'list', data: [entry('artificial-intelligence.docx'), entry('make_docx.py')] })
    const user = userEvent.setup()
    render(<SessionArtifacts sessionId="sesn_1" enabled />)

    const strip = await screen.findByRole('list', { name: 'Files in this chat' })
    await user.click(within(strip).getByRole('button', { name: 'File artificial-intelligence.docx' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('artificial-intelligence.docx')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      '/api/agentry/agents/sessions/sesn_1/artifacts/artificial-intelligence.docx?download=1',
    )
    // The preview asks for the bytes through the BFF.
    expect(within(dialog).getByText(/No preview is available/)).toBeInTheDocument()
  })

  it('re-reads the listing when the chat turns idle, hides itself without files', async () => {
    apiMock.listSessionArtifacts.mockResolvedValue({ object: 'list', data: [] })
    const { rerender } = render(<SessionArtifacts sessionId="sesn_1" enabled={false} />)
    expect(screen.queryByRole('list', { name: 'Files in this chat' })).not.toBeInTheDocument()
    expect(apiMock.listSessionArtifacts).not.toHaveBeenCalled()

    rerender(<SessionArtifacts sessionId="sesn_1" enabled />)
    await waitFor(() => expect(apiMock.listSessionArtifacts).toHaveBeenCalledWith('sesn_1'))
    expect(screen.queryByRole('list', { name: 'Files in this chat' })).not.toBeInTheDocument()
  })

  it('stays quiet when the session has no workspace', async () => {
    apiMock.listSessionArtifacts.mockRejectedValue(new Error('no workspace'))
    render(<SessionArtifacts sessionId="sesn_1" enabled />)
    await waitFor(() => expect(apiMock.listSessionArtifacts).toHaveBeenCalled())
    expect(screen.queryByRole('list', { name: 'Files in this chat' })).not.toBeInTheDocument()
  })
})
