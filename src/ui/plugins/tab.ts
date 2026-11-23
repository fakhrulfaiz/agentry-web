/** The Plugins page tabs; shared by the server route and the client tabs, so it is not a client module. */

export type PluginsTab = 'connectors' | 'skills'

/** @returns `'skills'` for that query value, else `'connectors'`. */
export function pluginsTabOf(value: string | string[] | undefined): PluginsTab {
  return value === 'skills' ? 'skills' : 'connectors'
}
