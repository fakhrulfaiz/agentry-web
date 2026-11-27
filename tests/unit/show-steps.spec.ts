// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type { MessageView } from '@/chat/reducer'
import { hasVisibleOutput, readShowSteps, shouldWaitForOutput, waitingLabel, writeShowSteps } from '@/chat/show-steps'

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
  it('keeps the first-send label until ready, then says thinking', () => {
    const firstSend = { startLabel: 'Starting a sandbox…' }
    expect(waitingLabel(true, 'idle', firstSend, false)).toBe('Starting a sandbox…')
    expect(waitingLabel(true, 'in_progress', firstSend, true)).toBe('Agentry is thinking…')
    expect(waitingLabel(true, 'in_progress', null, false)).toBe('Loading conversation…')
  })
  it('keeps the start label while the new session is idle before its turn', () => {
    expect(waitingLabel(true, 'idle', { startLabel: 'Starting the chat…' }, true)).toBe('Starting the chat…')
  })
})

describe('visible output', () => {
  it('counts only views that actually render as visible output', () => {
    const user: MessageView = { kind: 'user', id: 'u', text: 'hello' }
    const emptyAssistant: MessageView = { kind: 'assistant', id: 'a', text: '', streaming: true }
    const reasoning: MessageView = { kind: 'reasoning', id: 'r', text: '', streaming: true }
    const tool: MessageView = { kind: 'tool', id: 't', callId: 'c', name: 'bash', args: {}, status: 'running' }
    const notice: MessageView = { kind: 'notice', id: 'n', level: 'failed', message: 'oops' }
    expect(hasVisibleOutput([])).toBe(false)
    expect(hasVisibleOutput([user, emptyAssistant])).toBe(false)
    expect(hasVisibleOutput([reasoning])).toBe(true)
    expect(hasVisibleOutput([tool])).toBe(true)
    expect(hasVisibleOutput([notice])).toBe(true)
  })
})

describe('shouldWaitForOutput', () => {
  it('waits for first-send output but stops at output, notice, terminal status, closure or error', () => {
    const base = { loading: false, ready: true, status: 'idle', sent: false, firstSend: false, visibleOutput: false, endedInNotice: false, closedReason: false, unavailable: false }
    expect(shouldWaitForOutput({ ...base, loading: true })).toBe(true)
    expect(shouldWaitForOutput({ ...base, firstSend: true, ready: false })).toBe(true)
    expect(shouldWaitForOutput({ ...base, firstSend: true, status: 'in_progress' })).toBe(true)
    expect(shouldWaitForOutput({ ...base, firstSend: true, status: 'failed' })).toBe(false)
    expect(shouldWaitForOutput({ ...base, firstSend: true, visibleOutput: true })).toBe(false)
    expect(shouldWaitForOutput({ ...base, firstSend: true, endedInNotice: true })).toBe(false)
    expect(shouldWaitForOutput({ ...base, firstSend: true, closedReason: true })).toBe(false)
    expect(shouldWaitForOutput({ ...base, firstSend: true, unavailable: true })).toBe(false)
    expect(shouldWaitForOutput({ ...base, sent: true })).toBe(true)
    expect(shouldWaitForOutput({ ...base, status: 'in_progress' })).toBe(true)
  })

  it('waits for a new send even when the session was created by an earlier first send', () => {
    const base = { loading: false, ready: true, status: 'idle', sent: false, firstSend: false, visibleOutput: false, endedInNotice: false, closedReason: false, unavailable: false }
    expect(shouldWaitForOutput({ ...base, firstSend: true, sent: true })).toBe(true)
    expect(shouldWaitForOutput({ ...base, firstSend: true, sent: true, visibleOutput: true })).toBe(false)
  })

  it('does not treat the new session’s idle snapshot as the end of the first turn', () => {
    const base = { loading: false, ready: true, status: 'idle', sent: false, firstSend: true, visibleOutput: false, endedInNotice: false, closedReason: false, unavailable: false }
    expect(shouldWaitForOutput(base)).toBe(true)
    expect(shouldWaitForOutput({ ...base, turnEnded: true })).toBe(false)
  })
})
