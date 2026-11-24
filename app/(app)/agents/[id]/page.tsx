import { redirect } from 'next/navigation'

/** Old link: the editor is a dialog on the Agents page now. */
export default async function EditAgentRoute({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/agents?agent=${encodeURIComponent((await params).id)}`)
}
