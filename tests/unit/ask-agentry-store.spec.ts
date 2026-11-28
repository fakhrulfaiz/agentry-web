// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

const { askAgentryStore } = await import('@/ui/shell/ask-agentry-store')

describe('askAgentryStore', () => {
  beforeEach(() => {
    localStorage.clear()
    askAgentryStore.reset()
  })

  it('opens and closes without changing the session', () => {
    expect(askAgentryStore.get()).toEqual({ isOpen: false, sessionId: null })
    askAgentryStore.open()
    expect(askAgentryStore.get()).toEqual({ isOpen: true, sessionId: null })
    askAgentryStore.close()
    expect(askAgentryStore.get()).toEqual({ isOpen: false, sessionId: null })
  })

  it('remembers the last session across a reload', () => {
    askAgentryStore.setSession('sess_1')
    askAgentryStore.close()
    expect(localStorage.getItem('agentry_ask_session')).toBe('sess_1')
    // Simulate a reload: drop in-memory state, keep storage.
    askAgentryStore.reset()
    askAgentryStore.open()
    expect(askAgentryStore.get()).toEqual({ isOpen: true, sessionId: 'sess_1' })
  })

  it('forgets the stored session when a new chat starts', () => {
    askAgentryStore.setSession('sess_1')
    askAgentryStore.setSession(null)
    expect(localStorage.getItem('agentry_ask_session')).toBeNull()
    askAgentryStore.reset()
    askAgentryStore.open()
    expect(askAgentryStore.get().sessionId).toBeNull()
  })
})
