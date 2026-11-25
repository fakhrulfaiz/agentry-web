/** Vitest setup: each test starts with no page data remembered (see `src/ui/page-cache.ts`). */
import { beforeEach } from 'vitest'
import { clearPageCache } from '@/ui/page-cache'

beforeEach(() => clearPageCache())
