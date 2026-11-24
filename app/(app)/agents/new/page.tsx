import { redirect } from 'next/navigation'

/** Old link: the editor is a dialog on the Agents page now. */
export default async function NewAgentRoute({ searchParams }: { searchParams: Promise<{ starter?: string | string[] }> }) {
  const starter = (await searchParams).starter
  redirect(typeof starter === 'string' ? `/agents?starter=${encodeURIComponent(starter)}` : '/agents?new=1')
}
