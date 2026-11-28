/**
 * Which Markdown image sources are files of the chat's own workspace. The agent
 * writes `![chart](chart.png)` or an absolute path such as
 * `/home/u/agentry-workspaces/dev/sess_<id>/chart.png`; both name a workspace
 * file the BFF can serve. Anything with a scheme (`https:`, `data:`, `//host`)
 * is never a workspace file and stays a link, so a prompt-injected URL cannot
 * make the browser fetch it.
 */

/** The workspace-relative path `src` names for `sessionId`, or `null` when it is not a workspace file. */
export function workspaceImagePath(src: string, sessionId: string): string | null {
  let value = src.trim()
  if (value.toLowerCase().startsWith('file://')) value = value.slice('file://'.length)
  if (value === '' || value.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null
  try {
    value = decodeURI(value)
  } catch {
    return null
  }
  let relative = value
  if (value.startsWith('/')) {
    // An absolute path counts only inside this chat's own workspace folder (its session or sandbox directory).
    const marker = `/${sessionId}/`
    const at = value.indexOf(marker)
    if (at >= 0) relative = value.slice(at + marker.length)
    else {
      const sandbox = /\/sandbox-env_[0-9a-f]+\//.exec(value)
      if (!sandbox) return null
      relative = value.slice(sandbox.index + sandbox[0].length)
    }
  }
  relative = relative.replace(/^\.\//, '')
  const segments = relative.split('/')
  if (relative === '' || segments.some((s) => s === '' || s === '..' || s.startsWith('.'))) return null
  return relative
}
