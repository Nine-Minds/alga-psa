import type { ConversationTicketReference, TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import type { NamedConversationAiRequest } from '../../../lib/invokeNamedConversationAi';
import type { invokeNamedConversationAiAction } from '../../../actions/conversationAiActions';

/** Long-running inference stays outside Next's serialized server-action queue.
 * Cancellation and current-source status remain independently callable. */
export async function requestConversationAi(ticket: ConversationTicketReference, destination: TicketConversationReference,
  request: NamedConversationAiRequest): Promise<Awaited<ReturnType<typeof invokeNamedConversationAiAction>>> {
  const response = await fetch('/api/tickets/conversation-ai', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket, destination, request }) });
  if (!response.ok) return { ok: false, code: response.status === 400 ? 'invalid' : [401, 403].includes(response.status) ? 'unavailable' : 'unknown' };
  return response.json();
}
