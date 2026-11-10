// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { REFRESH_MS, refreshSkills, resetSkills, setSkills, useSkillCommands } from '@/skills/skills-store'
import { Composer } from '@/ui/chat/Composer'

function Harness() {
  return <Composer onSend={vi.fn(async () => {})} commands={useSkillCommands()} />
}

beforeEach(() => resetSkills())
afterEach(() => {
  cleanup()
  setSkills([])
  vi.restoreAllMocks()
})

describe('skills in the / menu', () => {
  const input = () => screen.queryByRole('combobox', { name: 'Message input' }) ?? screen.getByRole('textbox', { name: 'Message input' })

  it('lists the skills from the store', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'listSkills').mockResolvedValue({
      object: 'list',
      data: [{ name: 'review', description: 'Review the open diff' }, { name: 'plan' }],
    })
    render(<Harness />)
    await act(async () => refreshSkills())
    await user.click(input())
    await user.keyboard('/')
    const list = await screen.findByRole('listbox', { name: 'Commands' })
    expect(within(list).getAllByRole('option').map((o) => o.textContent)).toEqual(['/reviewReview the open diff', '/plan'])
  })

  it.each([
    ['an empty list', () => vi.spyOn(api, 'listSkills').mockResolvedValue({ object: 'list', data: [] })],
    ['a failed fetch', () => vi.spyOn(api, 'listSkills').mockRejectedValue(new Error('boom'))],
  ])('keeps the menu off for %s', async (_name, arrange) => {
    const user = userEvent.setup()
    arrange()
    render(<Harness />)
    await act(async () => refreshSkills())
    await user.click(input())
    await user.keyboard('/')
    await act(async () => {})
    expect(screen.queryByRole('listbox', { name: 'Commands' })).not.toBeInTheDocument()
  })

  it('refreshes at most once per minute and keeps the list after a failure', async () => {
    const spy = vi.spyOn(api, 'listSkills').mockResolvedValue({ object: 'list', data: [{ name: 'plan' }] })
    await refreshSkills(undefined, 1_000)
    await refreshSkills(undefined, 1_000 + REFRESH_MS - 1)
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRejectedValue(new Error('down'))
    await refreshSkills(undefined, 1_000 + REFRESH_MS)
    expect(spy).toHaveBeenCalledTimes(2)
    render(<Harness />)
    await waitFor(() => expect(input()).toBeInTheDocument())
    expect(input().getAttribute('role')).toBe('combobox')
  })
})
