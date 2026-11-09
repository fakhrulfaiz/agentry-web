import type { NextRequest } from 'next/server'
import { getConfig } from '@/config/env'
import { jsonError } from '@/server/agentry'
import { handlers } from '@/server/authjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Auth.js endpoints exist only in keycloak mode.
export function GET(req: NextRequest): Promise<Response> | Response {
  if (getConfig().auth !== 'keycloak') return jsonError(404, 'not_found')
  return handlers.GET(req)
}

export function POST(req: NextRequest): Promise<Response> | Response {
  if (getConfig().auth !== 'keycloak') return jsonError(404, 'not_found')
  return handlers.POST(req)
}
