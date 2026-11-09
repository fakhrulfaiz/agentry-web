import { describe, expect, it } from 'vitest'
import { readSse } from '@/chat/sse'

function body(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(encoder.encode(chunk))
      c.close()
    },
  })
}

async function collect(chunks: string[]) {
  const out = []
  for await (const m of readSse(body(chunks))) out.push(m)
  return out
}

describe('readSse', () => {
  it('parses ids, multi-line data and split chunks; an event without id: has no id', async () => {
    const messages = await collect(['id: 1\nda', 'ta: {"a":1}\n\n: keep-alive\n\ndata: x\ndata: y\n\nid: 2\r\nevent: e\r\ndata: z\r\n\r', '\n'])
    expect(messages).toEqual([
      { id: '1', data: '{"a":1}' },
      { data: 'x\ny' },
      { id: '2', event: 'e', data: 'z' },
    ])
  })

  it('drops an unterminated final block', async () => {
    expect(await collect(['id: 1\ndata: a\n\nid: 2\ndata: b'])).toEqual([{ id: '1', data: 'a' }])
  })
})
