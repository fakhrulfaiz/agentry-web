import { describe, expect, it } from 'vitest'
import { coalesce, keyEvent, modifiersOf, mouseEvent, toFramePoint, toPagePoint, type FrameBox } from '@/chat/browser-input'

const box: FrameBox = { left: 100, top: 50, width: 640, height: 360, pageWidth: 1280, pageHeight: 720 }
const noMods = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }

describe('browser take-over input', () => {
  it('maps a point on the shown frame to the page\'s CSS pixels', () => {
    expect(toPagePoint(100, 50, box)).toEqual({ x: 0, y: 0 })
    expect(toPagePoint(420, 230, box)).toEqual({ x: 640, y: 360 })
    expect(toPagePoint(740, 410, box)).toEqual({ x: 1280, y: 720 })
    expect(toPagePoint(99, 60, box)).toBeUndefined()
  })

  it('takes letterboxing off when the frame is drawn to fit a taller box', () => {
    // 640x640 box, 16:9 page: drawn 640x360, centred with 140 px above and below.
    const tall = { ...box, height: 640 }
    expect(toPagePoint(100, 50 + 140, tall)).toEqual({ x: 0, y: 0 })
    expect(toPagePoint(420, 50 + 320, tall)).toEqual({ x: 640, y: 360 })
    expect(toPagePoint(420, 60, tall)).toBeUndefined()
  })

  it('maps a page point back to where it is drawn, the inverse of toPagePoint', () => {
    expect(toFramePoint(0, 0, box)).toEqual({ x: 100, y: 50 })
    expect(toFramePoint(640, 360, box)).toEqual({ x: 420, y: 230 })
    expect(toFramePoint(1281, 10, box)).toBeUndefined()
    const tall = { ...box, height: 640 }
    expect(toFramePoint(0, 0, tall)).toEqual({ x: 100, y: 190 })
    for (const [x, y] of [[0, 0], [300, 200], [1280, 720]] as const) {
      const c = toFramePoint(x, y, tall)!
      expect(toPagePoint(c.x, c.y, tall)).toEqual({ x, y })
    }
  })

  it('turns keys into key events, with text for keys that type', () => {
    expect(keyEvent({ key: 'a', code: 'KeyA', keyCode: 65, ...noMods }, 'down')).toEqual({ type: 'key', action: 'down', key: 'a', code: 'KeyA', key_code: 65, text: 'a' })
    expect(keyEvent({ key: 'Enter', code: 'Enter', keyCode: 13, ...noMods }, 'down')).toMatchObject({ text: '\r' })
    expect(keyEvent({ key: 'Backspace', code: 'Backspace', keyCode: 8, ...noMods }, 'down')).not.toHaveProperty('text')
    expect(keyEvent({ key: 'a', code: 'KeyA', keyCode: 65, ...noMods, ctrlKey: true }, 'down')).toEqual({ type: 'key', action: 'down', key: 'a', code: 'KeyA', key_code: 65, modifiers: 2 })
    expect(keyEvent({ key: 'a', code: 'KeyA', keyCode: 65, ...noMods }, 'up')).not.toHaveProperty('text')
    expect(modifiersOf({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true })).toBe(15)
  })

  it('turns pointer events into mouse events in page pixels', () => {
    const e = { clientX: 420, clientY: 230, button: 0, buttons: 1, detail: 2, ...noMods }
    expect(mouseEvent(e, 'down', box)).toEqual({ type: 'mouse', action: 'down', x: 640, y: 360, button: 'left', buttons: 1, click_count: 2 })
    expect(mouseEvent({ ...e, buttons: 0 }, 'move', box)).toEqual({ type: 'mouse', action: 'move', x: 640, y: 360, buttons: 0 })
    expect(mouseEvent({ ...e, clientX: 0 }, 'down', box)).toBeUndefined()
  })

  it('merges consecutive moves, wheels at one point, and resizes', () => {
    expect(coalesce([
      { type: 'mouse', action: 'move', x: 1, y: 1 },
      { type: 'mouse', action: 'move', x: 2, y: 2 },
      { type: 'wheel', x: 5, y: 5, delta_x: 0, delta_y: 10 },
      { type: 'wheel', x: 5, y: 5, delta_x: 0, delta_y: 15 },
      { type: 'mouse', action: 'down', x: 2, y: 2 },
      { type: 'mouse', action: 'move', x: 3, y: 3 },
    ])).toEqual([
      { type: 'mouse', action: 'move', x: 2, y: 2 },
      { type: 'wheel', x: 5, y: 5, delta_x: 0, delta_y: 25 },
      { type: 'mouse', action: 'down', x: 2, y: 2 },
      { type: 'mouse', action: 'move', x: 3, y: 3 },
    ])
  })
})
