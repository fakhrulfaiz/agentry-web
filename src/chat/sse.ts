/**
 * Minimal Server-Sent Events parser over a fetch body. Unlike `EventSource`,
 * an event's `id` is reported only when that event block has its own `id:`
 * line: Agentry's ephemeral events carry none and must not inherit the last id.
 */
export interface SseMessage {
  id?: string
  event?: string
  data: string
}

/** Yields each dispatched message; returns when the body ends. Comments and empty-data blocks are skipped. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let block: { id?: string; event?: string; data: string[] } = { data: [] }
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        const match = /\r\n|\r|\n/.exec(buffer)
        // A lone trailing `\r` may be the first half of `\r\n`: wait for more input.
        if (!match || (match[0] === '\r' && match.index === buffer.length - 1)) break
        const line = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        if (line === '') {
          if (block.data.length > 0) {
            yield { ...(block.id !== undefined && { id: block.id }), ...(block.event && { event: block.event }), data: block.data.join('\n') }
          }
          block = { data: [] }
          continue
        }
        if (line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        let value = colon === -1 ? '' : line.slice(colon + 1)
        if (value.startsWith(' ')) value = value.slice(1)
        if (field === 'data') block.data.push(value)
        else if (field === 'id' && !value.includes('\0')) block.id = value
        else if (field === 'event') block.event = value
      }
    }
  } finally {
    // Early exit (the consumer stopped or threw): stop reading the body.
    await reader.cancel().catch(() => undefined)
  }
}
