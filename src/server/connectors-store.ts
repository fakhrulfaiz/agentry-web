import 'server-only'
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getConfig } from '@/config/env'

/** Raised for a key that is empty or does not start with `ck_`. */
export class InvalidConnectorKeyError extends Error {
  constructor() {
    super('invalid_key')
    this.name = 'InvalidConnectorKeyError'
  }
}

interface Entry {
  iv: string
  tag: string
  data: string
}

type Store = Record<string, Entry>

function file(): string {
  return path.join(process.env.AGENTRY_WEB_DATA_DIR ?? '.data', 'connectors.json')
}

/** AES-256 key derived from the session secret; the owner id is bound as authenticated data. */
function derivedKey(): Buffer {
  return Buffer.from(hkdfSync('sha256', getConfig().sessionSecret, '', 'agentry-web connectors v1', 32))
}

async function read(): Promise<Store> {
  let text: string
  try {
    text = await readFile(file(), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  return JSON.parse(text) as Store
}

// Serializes read-modify-write so concurrent updates do not drop each other.
let queue: Promise<unknown> = Promise.resolve()

function update(change: (store: Store) => void): Promise<void> {
  const run = queue.then(async () => {
    const store = await read()
    change(store)
    await mkdir(path.dirname(file()), { recursive: true })
    const tmp = `${file()}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(store), { mode: 0o600 })
    await rename(tmp, file())
  })
  queue = run.catch(() => undefined)
  return run
}

/** The owner's stored consumer key, or `undefined`. Server-only: never send this to the browser. */
export async function getKey(owner: string): Promise<string | undefined> {
  const entry = (await read())[owner]
  if (!entry) return undefined
  const decipher = createDecipheriv('aes-256-gcm', derivedKey(), Buffer.from(entry.iv, 'base64'))
  decipher.setAAD(Buffer.from(owner))
  decipher.setAuthTag(Buffer.from(entry.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(entry.data, 'base64')), decipher.final()]).toString('utf8')
}

/** Encrypts and saves the owner's key, replacing any earlier one. Throws `InvalidConnectorKeyError`. */
export async function setKey(owner: string, key: string): Promise<void> {
  const value = key.trim()
  if (!value.startsWith('ck_') || value.length <= 3) throw new InvalidConnectorKeyError()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', derivedKey(), iv)
  cipher.setAAD(Buffer.from(owner))
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const entry: Entry = { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }
  await update((store) => {
    store[owner] = entry
  })
}

/** Deletes the owner's key; a no-op when none is stored. */
export async function removeKey(owner: string): Promise<void> {
  await update((store) => {
    delete store[owner]
  })
}

/** True when the owner has a stored key. */
export async function hasKey(owner: string): Promise<boolean> {
  return owner in (await read())
}

/** The store key for a signed-in user; apikey mode has no owner id, so those users share one slot. */
export function ownerOf(identity?: { owner: string }): string {
  return identity?.owner || 'apikey'
}
