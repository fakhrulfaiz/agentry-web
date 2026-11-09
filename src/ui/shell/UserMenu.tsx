'use client'

import { Avatar } from '@astryxdesign/core/Avatar'
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import { useState } from 'react'
import { api } from '@/api/client'

/** The browser-safe identity the guarded layout passes down (`publicIdentity`). */
export interface ShellIdentity {
  owner: string
  roles: string[]
  displayName: string
}

/** Signs out through the BFF, then leaves for Keycloak's end-session URL or `/login`. */
export async function signOut(): Promise<void> {
  let to = '/login'
  try {
    to = await api.logout()
  } catch {
    // The server could not be reached: `/login` still ends the visit, and the session cookie expires on its own.
  }
  window.location.assign(to)
}

/** Shows who is signed in (owner and roles from the BFF), plus Settings and Sign out. */
export function UserMenu({ identity }: { identity: ShellIdentity }) {
  const [signingOut, setSigningOut] = useState(false)
  const roles = identity.roles.length > 0 ? identity.roles.join(', ') : 'No roles'
  return (
    <DropdownMenu
      button={{
        label: identity.displayName,
        variant: 'ghost',
        width: '100%',
        icon: <Avatar name={identity.displayName} size="xsm" tooltip={false} />,
        isLoading: signingOut,
      }}
      hasChevron={false}
      placement="above"
      items={[
        {
          type: 'section',
          title: identity.displayName,
          items: [
            ...(identity.owner ? [{ label: identity.owner, description: 'Owner', isDisabled: true }] : []),
            { label: roles, description: 'Roles', isDisabled: true },
          ],
        },
        { type: 'divider' },
        { label: 'Settings', href: '/settings' },
        {
          label: 'Sign out',
          onClick: () => {
            setSigningOut(true)
            void signOut()
          },
        },
      ]}
    />
  )
}
