import { Conversation } from '@/ui/chat/Conversation'

export default async function ConversationPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  // A new key per session, so switching chats starts from a clean state.
  return <Conversation key={sessionId} sessionId={sessionId} />
}
