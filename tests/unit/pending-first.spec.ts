import { afterEach, describe, expect, it } from 'vitest'
import { clearPendingFirst, peekPendingFirst, setPendingFirst, type FirstSend, type PendingFirst } from '@/chat/pending-first'

afterEach(() => clearPendingFirst('sess_label'))

describe('pending first message', () => {
  it('carries the new-chat start label', () => {
    const message: PendingFirst = { text: 'hi', startLabel: 'Starting a sandbox…' }
    const firstSend: FirstSend = { startLabel: 'Starting a sandbox…' }
    setPendingFirst('sess_label', message)
    expect(firstSend.startLabel).toBe('Starting a sandbox…')
    expect(peekPendingFirst('sess_label')).toEqual(message)
  })
})
