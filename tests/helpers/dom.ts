/**
 * jsdom gaps that astryx relies on: `<dialog>.showModal()` / `.close()`.
 * Import this from DOM tests (after `// @vitest-environment jsdom`).
 */
const proto = globalThis.HTMLDialogElement?.prototype
if (proto && typeof proto.showModal !== 'function') {
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.show = function show(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  proto.close = function close(this: HTMLDialogElement, returnValue?: string) {
    if (!this.hasAttribute('open')) return
    if (returnValue !== undefined) this.returnValue = returnValue
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}
export {}
