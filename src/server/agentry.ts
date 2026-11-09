import 'server-only'
import { getConfig } from '@/config/env'

/** Absolute upstream URL for an Agentry `/v1` path such as `/agents/sessions`. */
export function agentryUrl(path: string, search = ''): string {
  return `${getConfig().apiUrl.replace(/\/+$/, '')}/v1${path}${search}`
}

/** Headers every upstream Agentry call carries. */
export function agentryHeaders(authorization: string, extra: Record<string, string> = {}): Headers {
  return new Headers({ ...extra, authorization, 'openai-beta': 'agents=v1' })
}

export function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } })
}
