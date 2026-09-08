import type { Knex } from 'knex';
import { TenantEmailService } from '@alga-psa/email';
import { convertBlockNoteToHTML } from '@alga-psa/formatting/blocknoteUtils';
import { encodeConversationContent } from '@alga-psa/co-managed/conversationContent';
import { prepareNamedConversationEmail, confirmNamedConversationEmail, deliverNamedConversationEmail,
  type NamedConversationEmailTransport, type NamedConversationEmailRequest, type CoManagedSessionActor } from '@alga-psa/co-managed';
import type { ConversationTicketReference, TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { extractTicketRichTextPlainText } from './ticketRichText';
import { applyNamedTicketConversationPost } from './postNamedTicketConversation';

/** The renderer sees one selected draft, never a ticket's or vendor's history. */
export const namedConversationEmailTransport: NamedConversationEmailTransport = {
  async prepare({ mailbox, content, envelope, headers, replyToken }) {
    const { note } = encodeConversationContent(content);
    const text = extractTicketRichTextPlainText(note);
    const payload = { from: { email: mailbox.email, ...(mailbox.name ? { name: mailbox.name } : {}) }, replyTo: { email: mailbox.email },
      ...envelope, headers,
      html: `<div data-alga-reply-boundary="true"></div>${convertBlockNoteToHTML(note)}<div style="display:none" data-alga-reply-token="${replyToken}"></div>`,
      text: `--- Please reply above this line ---\n\n${text}\n\n[ALGA-REPLY-TOKEN ${replyToken}]` };
    const review = await TenantEmailService.getInstance(mailbox.tenant).prepareReviewedEmail({ ...payload, tenantId: mailbox.tenant, threading: 'conversation' });
    return { payload, review };
  },
  recheck(payload, mailbox) {
    return TenantEmailService.getInstance(mailbox.tenant).prepareReviewedEmail({ ...payload, tenantId: mailbox.tenant, threading: 'conversation' });
  },
  send(payload, review, mailbox) {
    return TenantEmailService.getInstance(mailbox.tenant).sendEmail({ ...payload, tenantId: mailbox.tenant,
      threading: 'conversation', retryPolicy: 'caller', reviewed: review });
  },
};
export function prepareNamedTicketEmail(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  ref: TicketConversationReference, request: NamedConversationEmailRequest) {
  return prepareNamedConversationEmail(db, actor, ticket, ref, request, namedConversationEmailTransport);
}
export async function sendNamedTicketEmail(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  ref: TicketConversationReference, operationId: string, reviewHash: string) {
  const confirmed = await confirmNamedConversationEmail(db, actor, ticket, ref, operationId, reviewHash,
    namedConversationEmailTransport, applyNamedTicketConversationPost);
  return confirmed.status === 'pending' ? deliverNamedConversationEmail(db, actor, ticket, ref, operationId, namedConversationEmailTransport) : confirmed;
}
