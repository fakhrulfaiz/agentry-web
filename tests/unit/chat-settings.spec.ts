// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { OAIAgentSession } from '@/api/types'
import { settingsChange, storedSettings, useChatSettings, withSettings } from '@/ui/chat/chat-settings'

const session = (id: string, model: string, effort?: string): OAIAgentSession =>
  ({ id, agent: { model, ...(effort ? { reasoning: { effort } } : {}) } }) as unknown as OAIAgentSession

describe('chat settings', () => {
  it('starts from the session’s stored model and effort', () => {
    expect(storedSettings(session('s1', 'm1', 'high'))).toEqual({ model: 'm1', effort: 'high' })
    expect(storedSettings(session('s1', 'm1'))).toEqual({ model: 'm1', effort: 'auto' })
    expect(storedSettings(session('s1', 'm1', 'xhigh'))).toEqual({ model: 'm1', effort: 'auto' })
    expect(storedSettings(null)).toEqual({ model: '', effort: 'auto' })
  })

  it('the change holds only the fields that differ, and never Auto', () => {
    const stored = { model: 'm1', effort: 'low' as const }
    expect(settingsChange(stored, stored)).toEqual({})
    expect(settingsChange(stored, { model: 'm1', effort: 'high' })).toEqual({ effort: 'high' })
    expect(settingsChange(stored, { model: 'm2', effort: 'low' })).toEqual({ model: 'm2' })
    expect(settingsChange(stored, { model: 'm2', effort: 'medium' })).toEqual({ model: 'm2', effort: 'medium' })
    expect(settingsChange(stored, { model: 'm1', effort: 'auto' })).toEqual({})
  })

  it('withSettings folds an accepted change into the session', () => {
    const s = session('s1', 'm1', 'low')
    expect(withSettings(s, {})).toBe(s)
    expect(withSettings(s, { effort: 'high' }).agent).toMatchObject({ model: 'm1', reasoning: { effort: 'high' } })
    expect(withSettings(s, { model: 'm2' }).agent).toMatchObject({ model: 'm2', reasoning: { effort: 'low' } })
  })

  it('choices make a change; revert (after a 409) goes back to the stored values', () => {
    const { result } = renderHook(() => useChatSettings(session('s1', 'm1', 'low')))
    expect(result.current).toMatchObject({ model: 'm1', effort: 'low', change: {}, efforts: ['low', 'medium', 'high'] })
    act(() => result.current.setEffort('high'))
    act(() => result.current.setModel('m2'))
    expect(result.current).toMatchObject({ model: 'm2', effort: 'high', change: { model: 'm2', effort: 'high' } })
    act(() => result.current.revert())
    expect(result.current).toMatchObject({ model: 'm1', effort: 'low', change: {} })
  })

  it('offers Auto only while the session has no stored effort, and resets for another session', () => {
    const { result, rerender } = renderHook(({ s }) => useChatSettings(s), { initialProps: { s: session('s1', 'm1') } })
    expect(result.current.efforts).toBeUndefined()
    act(() => result.current.setEffort('medium'))
    expect(result.current.change).toEqual({ effort: 'medium' })
    rerender({ s: session('s2', 'm3', 'high') })
    expect(result.current).toMatchObject({ model: 'm3', effort: 'high', change: {} })
  })
})
