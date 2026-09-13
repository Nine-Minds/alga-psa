import type { Knex } from 'knex';
import { withNamedTicketConversation } from './namedTicketConversations';
import type { CoManagedSessionActor } from './sharedWorkIdentity';
import { isNamedConversationCorrespondent } from '@alga-psa/shared/services/email/namedConversationCorrespondents';
import type { ConversationTicketReference, TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';

const EMAIL_ADDRESS_PATTERN = /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/;

/** F041: the client-facing "is this recipient new" data contract. Tells the
 * composer which To/CC addresses are NOT yet known correspondents on this
 * conversation's mailbox, so the UI can highlight them for review before the
 * next Send. Read-only; requires the same current ticket/conversation read
 * authority every other conversation read does. Purely an informational
 * classification over the existing `ticket_conversation_email_correspondents`
 * index inbound admission already maintains (`namedConversationCorrespondents.ts`)
 * -- it never grants application access, and it is not itself an admission
 * decision. Malformed/incomplete addresses (still being typed) are silently
 * skipped rather than flagged, matching the draft's own loose-while-editing
 * validation (`conversationEmailEnvelope.ts`). */
export async function getNamedConversationNewCorrespondents(db: Knex, actor: CoManagedSessionActor,
  ticket: ConversationTicketReference, input: TicketConversationReference,
  addresses: string[]): Promise<Array<{ email: string; isNew: boolean }>> {
  const unique = [...new Set(addresses.map(value => value.trim().toLowerCase()).filter(value => EMAIL_ADDRESS_PATTERN.test(value)))];
  if (!unique.length) return [];
  return withNamedTicketConversation(db, actor, ticket, input, 'read', async context => {
    const { conversation, trx } = context;
    // No mailbox selected yet: every address is necessarily new (nothing has
    // ever been sent/received on this conversation to have recorded one).
    if (!conversation.mailbox) return unique.map(email => ({ email, isNew: true }));
    const mailbox = conversation.mailbox;
    return Promise.all(unique.map(async email => ({ email,
      isNew: !(await isNamedConversationCorrespondent(trx, mailbox.tenant, mailbox.id, email)) })));
  });
}
