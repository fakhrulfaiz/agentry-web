/**
 * Runs the real mock Agentry API for component flow tests, so the web app's
 * client is exercised against actual Project and session routes (not a second
 * set of stubs written in the test).
 *
 * The browser client talks to the BFF (`/api/agentry/...`), which adds the
 * credential server-side. `bridgeFetch` rewrites those calls to the mock's
 * `/v1/...` with a test API key; every other request uses the original fetch.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'

export interface MockApi {
  base: string
  /** Forgets every session and Project (the mock's `/__mock/reset`). */
  reset(): Promise<void>
  stop(): Promise<void>
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
    })
  })
}

export async function startMockApi(): Promise<MockApi> {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const root = process.cwd()
  const script = resolve(root, 'mock/agentry-mock.ts')
  const child = spawn(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, MOCK_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout?.on('data', (chunk: Buffer) => { log += chunk.toString() })
  child.stderr?.on('data', (chunk: Buffer) => { log += chunk.toString() })
  const deadline = Date.now() + 10_000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`Mock API exited (${child.exitCode}): ${log}`)
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) })
      if (res.ok) break
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      child.kill()
      throw new Error(`Mock API did not start: ${log}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return {
    base,
    async reset() {
      const res = await fetch(`${base}/__mock/reset`, { method: 'POST' })
      if (!res.ok) throw new Error(`Mock reset failed (${res.status})`)
    },
    async stop() {
      if (child.exitCode === null) {
        child.kill()
        await new Promise<void>((resolve) => child.once('exit', () => resolve()))
      }
    },
  }
}

export function bridgeFetch(base: string): typeof fetch {
  const native = globalThis.fetch
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), 'http://local.test')
    if (!url.pathname.startsWith('/api/agentry/')) return native(input, init)
    const target = new URL(`${url.pathname.replace(/^\/api\/agentry/, '/v1')}${url.search}`, base)
    const headers = new Headers(init?.headers)
    headers.set('authorization', 'Bearer agk_test')
    return native(target, { ...init, headers })
  }
}
