// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstalledSkill } from '@/api/types'

const apiMock = vi.hoisted(() => ({
  listSkills: vi.fn(),
  listInstalledSkills: vi.fn(),
  listAgents: vi.fn(),
  getSkill: vi.fn(),
  uploadSkill: vi.fn(),
  importSkill: vi.fn(),
  createSkill: vi.fn(),
  activateSkill: vi.fn(),
  deleteSkill: vi.fn(),
  updateSkill: vi.fn(),
  editSkill: vi.fn(),
}))
vi.mock('@/api/client', async (orig) => ({ ...(await orig<object>()), api: apiMock }))

const { SkillsTab } = await import('@/ui/plugins/SkillsTab')

const row = (extra: Partial<InstalledSkill> = {}): InstalledSkill => ({
  id: `skill_${'a'.repeat(32)}`, object: 'agent.skill', scope: 'library', agent_id: null, name: 'haiku', description: 'Writes haiku', source: 'upload',
  origin: null, content_hash: 'h', has_scripts: true, status: 'active', created_at: 1, updated_at: 1, used_by: ['agent_1'], ...extra,
})

beforeEach(() => {
  for (const fn of Object.values(apiMock)) fn.mockReset()
  apiMock.listSkills.mockResolvedValue({ object: 'list', data: [
    { name: 'create-agent', description: 'Agents', kind: 'builtin', enabled: true },
    { name: 'office-docx', description: 'Word', kind: 'bundled', enabled: true },
  ] })
  apiMock.listInstalledSkills.mockResolvedValue([row()])
  apiMock.listAgents.mockResolvedValue({ data: [{ id: 'agent_1', name: 'Writer' }], has_more: false })
})
afterEach(cleanup)

describe('SkillsTab', () => {
  it('lists built-in skills, marking bundled ones always on', async () => {
    render(<SkillsTab />)
    expect(await screen.findByText('create-agent')).toBeInTheDocument()
    expect(screen.getByText('Always on')).toBeInTheDocument()
  })

  it('library rows show scripts and usage', async () => {
    const user = userEvent.setup()
    render(<SkillsTab />)
    await user.click(await screen.findByRole('button', { name: 'Library' }))
    expect(await screen.findByText('haiku')).toBeInTheDocument()
    expect(screen.getByText('Has scripts')).toBeInTheDocument()
    expect(screen.getByText('Used by 1 agent')).toBeInTheDocument()
  })

  it('upload opens review with the scripts warning; Install activates, Discard deletes', async () => {
    const user = userEvent.setup()
    const staged = row({ status: 'pending_review', used_by: [] })
    apiMock.uploadSkill.mockResolvedValue(staged)
    apiMock.getSkill.mockResolvedValue({ skill: staged, files: [{ path: 'SKILL.md', bytes: 40 }, { path: 'scripts/run.sh', bytes: 9 }], skill_md: '---\nname: haiku\n---\nDo haiku.' })
    apiMock.activateSkill.mockResolvedValue({ ...staged, status: 'active' })
    render(<SkillsTab />)
    await user.click(await screen.findByRole('button', { name: 'Library' }))
    const fileInput = async () => { await screen.findAllByText('Skill .zip'); return document.querySelector<HTMLInputElement>('input[type="file"]')! }
    await user.upload(await fileInput(), new File(['zip'], 'haiku.zip', { type: 'application/zip' }))
    const dialog = await screen.findByRole('dialog', { name: 'Review haiku' })
    expect(within(dialog).getByText(/includes scripts that run in your agent's sandbox/u)).toBeInTheDocument()
    expect(within(dialog).getByText('scripts/run.sh')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Install' }))
    expect(apiMock.activateSkill).toHaveBeenCalledWith(staged.id)

    apiMock.uploadSkill.mockResolvedValue(staged)
    await user.upload(await fileInput(), new File(['zip'], 'haiku.zip', { type: 'application/zip' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Review haiku' })).getByRole('button', { name: 'Discard' }))
    expect(apiMock.deleteSkill).toHaveBeenCalledWith(staged.id)
  })

  it('delete confirmation names the agents using the skill', async () => {
    const user = userEvent.setup()
    render(<SkillsTab />)
    await user.click(await screen.findByRole('button', { name: 'Library' }))
    await user.click(await screen.findByRole('button', { name: 'Delete haiku' }))
    expect(await screen.findByText(/Writer/u)).toBeInTheDocument()
  })

  it('the editor creates a skill with the entered fields', async () => {
    const user = userEvent.setup()
    apiMock.createSkill.mockResolvedValue(row({ name: 'notes', source: 'editor' }))
    render(<SkillsTab />)
    await user.click(await screen.findByRole('button', { name: 'Library' }))
    await user.click(await screen.findByRole('button', { name: 'Write a skill' }))
    const dialog = await screen.findByRole('dialog', { name: 'Write a skill' })
    await user.type(within(dialog).getByLabelText(/^Name/u), 'notes')
    await user.type(within(dialog).getByLabelText(/^Description/u), 'Takes notes')
    await user.type(within(dialog).getByLabelText(/^Instructions/u), 'Write notes.')
    await user.click(within(dialog).getByRole('button', { name: 'Save skill' }))
    await waitFor(() => expect(apiMock.createSkill).toHaveBeenCalledWith({ name: 'notes', description: 'Takes notes', body: 'Write notes.', scope: 'library' }))
  })
})
