// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OAIAgentSession, SessionArtifactEntry } from '@/api/types'

const nav = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/artifacts',
  useRouter: () => ({ push: nav.push, refresh: vi.fn(), replace: vi.fn() }),
}))

const apiMock = vi.hoisted(() => ({
  listSessions: vi.fn(),
  listSessionArtifacts: vi.fn(),
}))
vi.mock('@/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/client')>()),
  api: apiMock,
}))
vi.mock('@/chat/use-conversation', () => ({ goToLogin: vi.fn() }))

const { ArtifactsPage } = await import('@/ui/artifacts/ArtifactsPage')
const { ApiError } = await import('@/api/client')
const { seedText } = await import('@/artifacts/seed')

const session = (id: string, title: string): OAIAgentSession => ({
  id,
  object: 'agent.session',
  created_at: 1_760_000_000,
  last_active_at: 1_760_000_000,
  status: 'idle',
  error: null,
  metadata: { title },
  vault_ids: [],
  agent: { id: 'agent_main', object: 'agent' } as OAIAgentSession['agent'],
  environment: { type: 'local', id: 'env_1' },
  required_actions: [],
  usage: null,
})

const entry = (path: string, lastModified: string): SessionArtifactEntry => ({
  path,
  size: 10,
  last_modified: lastModified,
})

const sessions = (data: OAIAgentSession[], has_more = false) => ({ object: 'list' as const, data, has_more })
const artifacts = (data: SessionArtifactEntry[]) => ({ object: 'list' as const, data })

beforeEach(() => {
  nav.push.mockReset()
  apiMock.listSessions.mockReset()
  apiMock.listSessionArtifacts.mockReset()
  apiMock.listSessions.mockImplementation(async () => sessions([session('sesn_1', 'Planning')]))
  apiMock.listSessionArtifacts.mockImplementation(async () => artifacts([]))
})
afterEach(cleanup)

describe('ArtifactsPage', () => {
  it('lists the files of the recent sessions in the grid cards', async () => {
    apiMock.listSessionArtifacts.mockImplementation(async () =>
      artifacts([entry('chart.png', '2026-11-10T09:00:00.000Z'), entry('report.docx', '2026-11-10T08:00:00.000Z')]),
    )
    render(<ArtifactsPage />)
    expect(screen.getByRole('heading', { name: 'Artifacts' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
    const grid = await screen.findByTestId('artifacts-grid')
    expect(within(grid).getByText('chart.png')).toBeInTheDocument()
    expect(within(grid).getByText('report.docx')).toBeInTheDocument()
    expect(within(grid).getAllByText(/Planning/)).toHaveLength(2)
    expect(grid.querySelector('img')).toHaveAttribute('src', '/api/agentry/agents/sessions/sesn_1/artifacts/chart.png')
    expect(apiMock.listSessionArtifacts).toHaveBeenCalledWith('sesn_1')
  })

  it('shows the empty state', async () => {
    render(<ArtifactsPage />)
    expect(await screen.findByText('No artifacts yet.')).toBeInTheDocument()
    expect(screen.getByText('Files the agent creates in your chats appear here.')).toBeInTheDocument()
  })

  it('opens a seeded new chat from each tile', async () => {
    render(<ArtifactsPage />)
    const user = userEvent.setup()
    for (const [label, seed] of [['Docs', 'docs'], ['Slides', 'slides'], ['Data', 'data']]) {
      await user.click(screen.getByRole('button', { name: label }))
      expect(nav.push).toHaveBeenLastCalledWith(`/?seed=${seed}`)
    }
    expect([seedText('docs'), seedText('slides'), seedText('data'), seedText('x')]).toEqual([
      '/office-docx ',
      '/office-pptx ',
      '/office-xlsx ',
      null,
    ])
  })

  it('shows an error banner that retries, and appends the next sessions page', async () => {
    apiMock.listSessions.mockRejectedValueOnce(new ApiError(500, 'server_error', 'Boom'))
    render(<ArtifactsPage />)
    expect(await screen.findByText('Boom')).toBeInTheDocument()
    apiMock.listSessions.mockImplementation(async () => sessions([session('sesn_1', 'Planning')], true))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('No artifacts yet.')
    apiMock.listSessions.mockImplementation(async () => sessions([session('sesn_2', 'Research')]))
    apiMock.listSessionArtifacts.mockImplementation(async (id: string) =>
      id === 'sesn_2' ? artifacts([entry('two.md', '2026-11-10T09:30:00.000Z')]) : artifacts([]),
    )
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('two.md')
    expect(apiMock.listSessions).toHaveBeenLastCalledWith({ after: 'sesn_1', limit: 25 })
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('keeps loading when one session answers 404 (it has no workspace)', async () => {
    apiMock.listSessionArtifacts.mockImplementation(async (id: string) => {
      if (id === 'sesn_1') throw new ApiError(404, 'resource_not_found', 'no workspace')
      return artifacts([entry('ok.md', '2026-11-10T09:00:00.000Z')])
    })
    render(<ArtifactsPage />)
    await screen.findByText('No artifacts yet.')
  })

  it('previews a PDF with Open chat and Download', async () => {
    apiMock.listSessionArtifacts.mockImplementation(async () =>
      artifacts([entry('summary.pdf', '2026-11-10T09:00:00.000Z')]),
    )
    render(<ArtifactsPage />)
    const user = userEvent.setup()
    await user.click(await screen.findByText('summary.pdf'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByTitle('summary.pdf')).toHaveAttribute(
      'src',
      '/api/agentry/agents/sessions/sesn_1/artifacts/summary.pdf',
    )
    expect(within(dialog).getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      '/api/agentry/agents/sessions/sesn_1/artifacts/summary.pdf?download=1',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Open chat' }))
    expect(nav.push).toHaveBeenCalledWith('/c/sesn_1')
  })

  it('previews text in a pre and offers download only for other types', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('# Notes'))
    vi.stubGlobal('fetch', fetchMock)
    apiMock.listSessionArtifacts.mockImplementation(async () =>
      artifacts([entry('notes.md', '2026-11-10T09:00:00.000Z'), entry('blob.bin', '2026-11-10T08:00:00.000Z')]),
    )
    render(<ArtifactsPage />)
    const user = userEvent.setup()
    await user.click(await screen.findByText('notes.md'))
    await waitFor(() => expect(screen.getByTestId('artifact-text')).toHaveTextContent('# Notes'))
    await user.keyboard('{Escape}')
    await user.click(await screen.findByText('blob.bin'))
    expect(await screen.findByText(/No preview is available/)).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})
