import { redirect } from 'next/navigation'

/** Connectors moved to the Plugins page; old links land on its Connectors tab. */
export default function ConnectorsRedirect(): never {
  redirect('/plugins?tab=connectors')
}
