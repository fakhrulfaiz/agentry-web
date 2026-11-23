import { afterEach, describe, expect, it, vi } from 'vitest'
import { categoryLabel, connectHref, filterEntries, parseEntry, pickFeatured, promptText, topCategories, type CatalogEntry } from '@/connectors/catalog'
import { featuredSlugs, getCatalog, parseCatalog } from '@/server/connector-catalog'

const row = (slug: string, name: string, category = 'email', toolCount = 3) => ({ slug, name, logo: 'x', category, toolCount, triggerCount: 0 })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('catalog validation', () => {
  it('keeps valid rows, drops malformed and duplicate ones, trims to the fields used', () => {
    const entries = parseCatalog([row('gmail', 'Gmail'), null, 'x', { slug: 'bad slug', name: 'N' }, { slug: 'a', name: '' }, row('gmail', 'Dup'), { slug: 'x1', name: 'X', category: 5, toolCount: -1 }])
    expect(entries).toEqual([
      { slug: 'gmail', name: 'Gmail', category: 'email', toolCount: 3 },
      { slug: 'x1', name: 'X', category: '', toolCount: 0 },
    ])
  })

  it('rejects non-arrays and arrays without a usable row', () => {
    expect(parseCatalog({})).toBeNull()
    expect(parseCatalog([{ nope: 1 }])).toBeNull()
    expect(parseEntry(undefined)).toBeNull()
  })
})

describe('getCatalog', () => {
  it('returns the live list with the default featured four, in configured order', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([row('github', 'GitHub'), row('gmail', 'Gmail'), row('other', 'Other')])))
    const catalog = await getCatalog()
    expect(catalog.failed).toBe(false)
    expect(catalog.entries).toHaveLength(3)
    expect(catalog.featured.map((e) => e.slug)).toEqual(['gmail', 'github'])
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ next: { revalidate: 86400 } })
  })

  it('reads featured slugs from AGENTRY_WEB_CONNECTORS_FEATURED', async () => {
    vi.stubEnv('AGENTRY_WEB_CONNECTORS_FEATURED', ' Other , gmail ,')
    expect(featuredSlugs()).toEqual(['other', 'gmail'])
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([row('gmail', 'Gmail'), row('other', 'Other')])))
    expect((await getCatalog()).featured.map((e) => e.slug)).toEqual(['other', 'gmail'])
  })

  it.each([
    ['a network error', () => Promise.reject(new Error('offline'))],
    ['a non-200 answer', async () => new Response('no', { status: 503 })],
    ['invalid JSON shape', async () => Response.json({ not: 'an array' })],
  ])('falls back to the bundled list with an error flag on %s', async (_name, impl) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(impl))
    const catalog = await getCatalog()
    expect(catalog.failed).toBe(true)
    expect(catalog.entries.map((e) => e.slug)).toEqual(['gmail', 'github', 'googledrive', 'googlecalendar', 'slack', 'notion', 'linear', 'googlesheets'])
    expect(catalog.featured.map((e) => e.slug)).toEqual(['gmail', 'github', 'googledrive', 'googlecalendar'])
  })
})

describe('list logic', () => {
  const entries: CatalogEntry[] = [
    { slug: 'gmail', name: 'Gmail', category: 'email', toolCount: 5 },
    { slug: 'outlook', name: 'Outlook', category: 'email', toolCount: 4 },
    { slug: 'github', name: 'GitHub', category: 'developer tools', toolCount: 9 },
  ]

  it('filters by name, slug and category case-insensitively, and by exact category', () => {
    expect(filterEntries(entries, 'GIT', null).map((e) => e.slug)).toEqual(['github'])
    expect(filterEntries(entries, 'developer', null).map((e) => e.slug)).toEqual(['github'])
    expect(filterEntries(entries, 'gma', null).map((e) => e.slug)).toEqual(['gmail'])
    expect(filterEntries(entries, '', 'email').map((e) => e.slug)).toEqual(['gmail', 'outlook'])
    expect(filterEntries(entries, 'git', 'email')).toEqual([])
    expect(filterEntries(entries, '  ', null)).toHaveLength(3)
  })

  it('ranks categories by size and limits them', () => {
    expect(topCategories(entries)).toEqual(['email', 'developer tools'])
    expect(topCategories(entries, 1)).toEqual(['email'])
    expect(categoryLabel('developer tools')).toBe('Developer tools')
    expect(categoryLabel('')).toBe('Other')
  })

  it('picks featured entries in slug order and skips unknown slugs', () => {
    expect(pickFeatured(entries, ['github', 'nope', 'gmail']).map((e) => e.slug)).toEqual(['github', 'gmail'])
  })

  it('sanitizes the prompt prefill and builds the connect link', () => {
    expect(promptText('a\u0000b\nc')).toBe('a b c')
    expect(promptText('y'.repeat(300))).toHaveLength(200)
    expect(promptText(null)).toBe('')
    expect(connectHref('Google Drive')).toBe('/?prompt=Connect%20my%20Google%20Drive%20account')
  })
})
