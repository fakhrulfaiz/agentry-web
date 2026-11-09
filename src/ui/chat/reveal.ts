import { ITEM_ANCHOR } from './Message'

/** Scrolls the conversation row of `itemId` into view; false when it is not rendered. */
export function scrollToItem(itemId: string, smooth = true): boolean {
  const row = Array.from(document.querySelectorAll<HTMLElement>(`[${ITEM_ANCHOR}]`)).find((el) => el.getAttribute(ITEM_ANCHOR) === itemId)
  if (!row) return false
  row.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' })
  return true
}
