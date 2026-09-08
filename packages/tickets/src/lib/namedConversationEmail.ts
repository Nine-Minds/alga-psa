import { namedConversationFileStorage } from './conversationFileStorage';
import { readNamedConversationFileBytes, type NamedConversationEmailFile } from '@alga-psa/co-managed';
import type { Knex } from 'knex';
import { TenantEmailService } from '@alga-psa/email';
import { convertBlockNoteToHTML } from '@alga-psa/formatting/blocknoteUtils';
import { encodeConversationContent } from '@alga-psa/co-managed/conversationContent';
import { prepareNamedConversationEmail, confirmNamedConversationEmail, deliverNamedConversationEmail,
  type NamedConversationEmailTransport, type NamedConversationEmailRequest, type CoManagedSessionActor } from '@alga-psa/co-managed';
import type { ConversationTicketReference, TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { extractTicketRichTextPlainText } from './ticketRichText';
import { applyNamedTicketConversationPost } from './postNamedTicketConversation';
import { TicketCloseValidationError } from './closeRuleConstants';
import { getNamedTicketConversationPublicationCapabilities } from '@alga-psa/co-managed';

async function emailFiles(files: NamedConversationEmailFile[] = []) {
  return Promise.all(files.map(async file => ({ filename: file.fileName, contentType: file.mimeType,
    content: await readNamedConversationFileBytes(file, namedConversationFileStorage) })));
}
/** The renderer sees one selected draft, never a ticket's or vendor's history. */
export const namedConversationEmailTransport: NamedConversationEmailTransport = {
  async prepare({ mailbox, content, envelope, headers, replyToken, files }) {
    const { note } = encodeConversationContent(content);
    const text = extractTicketRichTextPlainText(note);
    const payload = { from: { email: mailbox.email, ...(mailbox.name ? { name: mailbox.name } : {}) }, replyTo: { email: mailbox.email },
      ...envelope, headers, ...(files.length ? { files } : {}),
      html: `<div data-alga-reply-boundary="true"></div>${convertBlockNoteToHTML(note)}<div style="display:none" data-alga-reply-token="${replyToken}"></div>`,
      text: `--- Please reply above this line ---\n\n${text}\n\n[ALGA-REPLY-TOKEN ${replyToken}]` };
    const review = await TenantEmailService.getInstance(mailbox.tenant).prepareReviewedEmail({ ...payload, attachments: await emailFiles(payload.files), tenantId: mailbox.tenant, threading: 'conversation' });
    return { payload, review };
  },
  async recheck(payload, mailbox) {
    return TenantEmailService.getInstance(mailbox.tenant).prepareReviewedEmail({ ...payload, attachments: await emailFiles(payload.files), tenantId: mailbox.tenant, threading: 'conversation' });
  },
  async send(payload, review, mailbox) {
    return TenantEmailService.getInstance(mailbox.tenant).sendEmail({ ...payload, attachments: await emailFiles(payload.files), tenantId: mailbox.tenant,
      threading: 'conversation', retryPolicy: 'caller', reviewed: review });
  },
};
export function prepareNamedTicketEmail(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  ref: TicketConversationReference, request: NamedConversationEmailRequest) {
  return prepareNamedConversationEmail(db, actor, ticket, ref, request, namedConversationEmailTransport);
}
export async function sendNamedTicketEmail(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  ref: TicketConversationReference, operationId: string, reviewHash: string) {
  let confirmed;
  try {
    confirmed = await confirmNamedConversationEmail(db, actor, ticket, ref, operationId, reviewHash,
      namedConversationEmailTransport, applyNamedTicketConversationPost, namedConversationFileStorage);
  } catch (error) {
    if (!(error instanceof TicketCloseValidationError)) throw error;
    // The failed transaction has released its locks. Re-admit the caller before
    // returning narrow rule identifiers, without hidden field values or counts.
    const capabilities = await getNamedTicketConversationPublicationCapabilities(db, actor, ticket, ref);
    if (!capabilities.closeStatuses?.length) throw error;
    return { status: 'close_blocked' as const, failedRules: error.failures.map(failure => failure.rule) };
  }
  return confirmed.status === 'pending' ? deliverNamedConversationEmail(db, actor, ticket, ref, operationId, namedConversationEmailTransport) : confirmed;
}
