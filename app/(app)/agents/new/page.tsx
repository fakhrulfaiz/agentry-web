import { redirect } from 'next/navigation'

/** Old link: the new-agent form now opens as a dialog on the Agents page. */
export default function NewAgentRoute() {
  redirect('/agents?new=1')
}
