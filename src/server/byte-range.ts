/**
 * HTTP `Range` for the artifact bytes route, so videos can seek. The API serves whole files only, so the BFF
 * streams the upstream body and passes on just the asked bytes (skipping the start, cancelling after the end).
 * One range per request; anything else is answered with the whole file.
 */

/** A single satisfiable byte range (inclusive end), `unsatisfiable` (416), or `undefined` (send the whole file). */
export function parseRange(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | undefined {
  if (header === null || !Number.isInteger(size) || size < 0) return undefined
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return undefined
  const [, a, b] = m
  if (a === '' && b === '') return undefined
  if (a === '') {
    const suffix = Number(b)
    if (suffix === 0) return 'unsatisfiable'
    return size === 0 ? 'unsatisfiable' : { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(a)
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1)
  if (start >= size || end < start) return 'unsatisfiable'
  return { start, end }
}

/** `body`'s bytes `start..end` (inclusive) as a stream; the source is cancelled once the end is reached. */
export function sliceStream(body: ReadableStream<Uint8Array>, start: number, end: number): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  let offset = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          return
        }
        const from = offset
        offset += value.byteLength
        if (offset <= start) continue
        const lo = Math.max(0, start - from)
        const hi = Math.min(value.byteLength, end + 1 - from)
        if (hi > lo) controller.enqueue(value.subarray(lo, hi))
        if (offset > end) {
          controller.close()
          await reader.cancel().catch(() => {})
        }
        return
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => {})
    },
  })
}
