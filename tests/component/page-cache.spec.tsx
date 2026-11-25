// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { cached, useCachedState } from '@/ui/page-cache'

afterEach(cleanup)

describe('useCachedState', () => {
  it('starts empty, then a remount starts from the last value', () => {
    const first = renderHook(() => useCachedState<string[]>('rows'))
    expect(first.result.current[0]).toBeNull()
    act(() => first.result.current[1](['a', 'b']))
    first.unmount()
    expect(cached('rows')).toEqual(['a', 'b'])
    const again = renderHook(() => useCachedState<string[]>('rows'))
    expect(again.result.current[0]).toEqual(['a', 'b'])
  })

  it('keeps keys apart and does not forget a value on null', () => {
    const a = renderHook(() => useCachedState<number>('a'))
    act(() => a.result.current[1](1))
    act(() => a.result.current[1](null))
    expect(cached('a')).toBe(1)
    expect(cached('b')).toBeUndefined()
  })
})
