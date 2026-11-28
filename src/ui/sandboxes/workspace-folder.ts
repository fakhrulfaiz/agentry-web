/**
 * A folder inside an environment's workspace, as a Project names it. Mirrors the API's
 * `normalizeWorkspaceSubdir` so a bad folder is refused before saving.
 */

/**
 * @param input - what the user typed.
 * @returns the cleaned relative folder (`''` for the workspace root), or the rule that was broken.
 */
export function normalizeWorkspaceFolder(input: string): { value: string } | { error: string } {
  let value = input.trim()
  if (/[\u0000-\u001f\u007f]/.test(value)) return { error: 'The folder cannot contain control characters.' }
  if (value.includes('\\')) return { error: 'The folder cannot contain backslashes.' }
  if (value.startsWith('/') && value.replaceAll('/', '') !== '') return { error: 'Use a folder inside the workspace, not an absolute path.' }
  value = value.replace(/\/{2,}/g, '/')
  while (value.startsWith('./')) value = value.slice(2)
  value = value.replace(/\/+$/, '')
  if (value === '' || value === '.' || value === '/') return { value: '' }
  if (value.length > 200) return { error: 'The folder can be at most 200 characters.' }
  const segments = value.split('/')
  if (segments.includes('..')) return { error: 'The folder cannot contain "..".' }
  if (segments.length > 8) return { error: 'The folder can have at most 8 levels.' }
  return { value }
}

/** Top-level folder names of an environment's files (absolute `/workspace/...` paths), A to Z, skipping dot-folders. */
export function topLevelFolders(paths: string[]): string[] {
  const names = new Set<string>()
  for (const path of paths) {
    const rel = path.replace(/^\/workspace\//, '')
    const slash = rel.indexOf('/')
    if (slash > 0 && !rel.startsWith('.')) names.add(rel.slice(0, slash))
  }
  return [...names].sort()
}
