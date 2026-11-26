// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({ createSandboxTemplate: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), api: apiMock }))
vi.mock('@/chat/use-conversation', () => ({ goToLogin: vi.fn() }))

import type { SandboxProvider } from '@/api/types'
import { BROWSER_SANDBOX_IMAGE } from '@/ui/sandboxes/format'
import { RunsOnPicker } from '@/ui/sandboxes/RunsOnPicker'
import { TemplateEditorDialog } from '@/ui/sandboxes/TemplateEditorDialog'

const fields = ['image', 'packages', 'setup_commands', 'env', 'network', 'files', 'resources', 'gpus']
const sandbox = (over: Partial<SandboxProvider> = {}): SandboxProvider => ({
  object: 'sandbox.provider', name: 'sandbox', default: true, available: true, capabilities: { templateFields: fields, files: true, exec: true },
  places: [
    { id: 'here', name: 'This server', kind: 'docker', default: true, available: true, capabilities: { reset: true, isolated: true, gpu: false } },
    { id: 'gpu-box', name: 'GPU box', kind: 'docker-ssh', default: false, available: true, gpus: { count: 2, models: ['A100', 'A100'] }, capabilities: { reset: false, isolated: true, gpu: true } },
  ],
  ...over,
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RunsOnPicker places', () => {
  it('offers the kinds as cards and the places as a dropdown under the chosen sandbox', async () => {
    const user = userEvent.setup()
    const onPlace = vi.fn()
    render(<RunsOnPicker providers={[sandbox()]} value="sandbox" place="here" onChange={() => {}} onPlaceChange={onPlace} />)
    expect(screen.getByRole('checkbox', { name: /Isolated sandbox/ })).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: /GPU box/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: /Where it runs/ }))
    expect(screen.getByRole('option', { name: /GPU box.*Docker over SSH.*2 GPUs/ })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /GPU box/ }))
    expect(onPlace).toHaveBeenCalledWith('sandbox', 'gpu-box')
  })

  it('disables an unavailable place and says why', async () => {
    const user = userEvent.setup()
    const p = sandbox()
    p.places![1] = { ...p.places![1]!, available: false, reason: 'SSH host unreachable' }
    render(<RunsOnPicker providers={[p]} value="sandbox" place="here" onChange={() => {}} onPlaceChange={() => {}} />)
    await user.click(screen.getByRole('combobox', { name: /Where it runs/ }))
    expect(screen.getByRole('option', { name: /GPU box.*SSH host unreachable/ })).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('template editor', () => {
  const open = () => render(<TemplateEditorDialog isOpen onClose={() => {}} providers={[sandbox()]} onCreated={() => {}} />)

  it('offers the browser image as a preset', async () => {
    const user = userEvent.setup()
    open()
    await user.click(screen.getByRole('combobox', { name: /Image preset/ }))
    await user.click(screen.getByRole('option', { name: /Web browser/ }))
    expect(screen.getByRole('textbox', { name: /^Image/ })).toHaveValue(BROWSER_SANDBOX_IMAGE)
  })

  it('GPU field appears only for a place with GPUs and caps at its count', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('tab', { name: /Internet and limits/ }))
    expect(screen.queryByRole('combobox', { name: /GPUs/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: /Where it runs/ }))
    await user.click(screen.getByRole('option', { name: /GPU box/ }))
    await user.click(await screen.findByRole('tab', { name: /Internet and limits/ }))
    await user.click(screen.getByRole('combobox', { name: /GPUs/ }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['0', '1', '2', 'All'])
  })

  it('template body carries place and gpus', async () => {
    const user = userEvent.setup()
    apiMock.createSandboxTemplate.mockResolvedValue({})
    open()
    await user.type(await screen.findByRole('textbox', { name: /^Name/ }), 'Train')
    await user.click(screen.getByRole('combobox', { name: /Where it runs/ }))
    await user.click(screen.getByRole('option', { name: /GPU box/ }))
    await user.click(await screen.findByRole('tab', { name: /Internet and limits/ }))
    await user.click(screen.getByRole('combobox', { name: /GPUs/ }))
    await user.click(screen.getByRole('option', { name: '2' }))
    await user.click(screen.getByRole('button', { name: 'Save template' }))
    expect(apiMock.createSandboxTemplate).toHaveBeenCalledWith({ name: 'Train', provider: 'sandbox', place: 'gpu-box', gpus: 2 })
  })
})
