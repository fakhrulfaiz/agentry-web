import { describe, expect, it } from 'vitest'
import { closeTab, initialState, openFile, pinTab, setWidth } from '@/preview/store'

describe('preview store', () => {
  it('opens a file, replacing the unpinned tab', () => {
    let s = openFile(initialState(), 'a.md')
    expect(s.open).toBe(true)
    expect(s.tabs).toEqual([{ path: 'a.md', pinned: false }])
    expect(s.active).toBe('a.md')
    s = openFile(s, 'b.py')
    expect(s.tabs).toEqual([{ path: 'b.py', pinned: false }])
  })
  it('appends after a tab is pinned, and closing falls back to Files', () => {
    let s = pinTab(openFile(initialState(), 'a.md'), 'a.md')
    s = openFile(s, 'b.py')
    expect(s.tabs.map((t) => t.path)).toEqual(['a.md', 'b.py'])
    s = closeTab(s, 'b.py')
    expect(s.active).toBe('files')
  })
  it('clamps width', () => {
    expect(setWidth(initialState(), 5000).width).toBe(900)
    expect(setWidth(initialState(), 10).width).toBe(320)
  })
})
