// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentForm } from '@/ui/agents/AgentForm'

const { apiMock, nav } = vi.hoisted(() => ({
  apiMock: {
    models: vi.fn(async () => ['m1', 'm2']),
    listHostTools: vi.fn(async () => [{ name: 'read_file' }, { name: 'grep' }, { name: 'shell' }]),
    createAgent: vi.fn(async () => ({ id: 'agent_9' })),
    updateAgent: vi.fn(),
    getAgent: vi.fn(),
    deleteAgent: vi.fn(),
  },
  nav: { push: vi.fn(), params: new URLSearchParams() },
}))
vi.mock('@/api/client', async (orig) => ({ ...(await orig<object>()), api: apiMock }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push }), useSearchParams: () => nav.params }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  nav.params = new URLSearchParams()
  vi.unstubAllGlobals()
})

describe('AgentForm', () => {
  it('creates an agent from the form', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: ['gmail'] })))
    render(<AgentForm />)
    const name = await screen.findByRole('textbox', { name: /Name/ })
    await userEvent.type(name, ' Reviewer ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(apiMock.createAgent).toHaveBeenCalled())
    expect(apiMock.createAgent).toHaveBeenCalledWith({
      model: 'm1', name: 'Reviewer', instructions: '', metadata: {}, host_tools: null, multi_agent: { enabled: false }, reasoning: null,
    })
    expect(nav.push).toHaveBeenCalledWith('/agents')
  })
  it('opens a starter prefilled and refuses to save without a name', async () => {
    nav.params = new URLSearchParams('starter=planner')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ connected: null })))
    render(<AgentForm />)
    await waitFor(() => expect(screen.getByRole('textbox', { name: /Name/ })).toHaveValue('Planner'))
    await userEvent.clear(screen.getByRole('textbox', { name: /Name/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Give the agent a name.')).toBeInTheDocument()
    expect(apiMock.createAgent).not.toHaveBeenCalled()
  })
})
