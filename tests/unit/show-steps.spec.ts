// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { readShowSteps, waitingLabel, writeShowSteps } from '@/chat/show-steps'

afterEach(() => localStorage.clear())

describe('show steps preference', () => {
  it('is off by default and remembers the choice', () => {
    expect(readShowSteps()).toBe(false)
    writeShowSteps(true)
    expect(readShowSteps()).toBe(true)
    writeShowSteps(false)
    expect(readShowSteps()).toBe(false)
  })
})

describe('waitingLabel', () => {
  it('says loading while the history arrives, even when some items are there', () => {
    expect(waitingLabel(true, 'in_progress')).toBe('Loading conversation…')
  })
  it('says sending until the turn starts, then thinking', () => {
    expect(waitingLabel(false, 'idle')).toBe('Sending…')
    expect(waitingLabel(false, 'in_progress')).toBe('Agentry is thinking…')
  })
})
