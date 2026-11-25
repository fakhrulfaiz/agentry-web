// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { readOpenFolds, writeOpenFolds } from '@/chat/open-folds'

afterEach(() => sessionStorage.clear())

describe('open folds', () => {
  it('remembers the opened folds of each chat for the browser session', () => {
    writeOpenFolds('sess_a', new Set(['turn_1', 'turn_2']))
    expect([...readOpenFolds('sess_a')]).toEqual(['turn_1', 'turn_2'])
    expect(readOpenFolds('sess_b').size).toBe(0)
  })

  it('treats bad or missing storage as nothing open', () => {
    sessionStorage.setItem('agentry:open-folds:sess_a', '{not json')
    expect(readOpenFolds('sess_a').size).toBe(0)
    sessionStorage.setItem('agentry:open-folds:sess_a', JSON.stringify([1, 'turn_3']))
    expect([...readOpenFolds('sess_a')]).toEqual(['turn_3'])
  })
})
