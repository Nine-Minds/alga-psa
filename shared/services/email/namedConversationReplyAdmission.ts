import type { Knex } from 'knex';
import type { EmailMessageDetails } from '../../interfaces/inbound-email.interfaces';
import type { SenderAuthResults } from '../../lib/email/senderAuthVerification';
/** The inbox transaction owns delivery dedupe. Named replies retain qualified
 * destination receipts so artifact handling never infers a store from a UUID. */
export type NamedConversationReplyAdmission = (trx: Knex.Transaction, input: {
  tenant: string; providerId: string; inboxId: string; email: EmailMessageDetails; senderAuth: SenderAuthResults | null;
}) => Promise<
  | { outcome: 'replied'; ticketId: string; commentId: string; matchedBy: 'reply_token' | 'thread_headers' | 'manual_review' }
  | { outcome: 'quarantined'; reason: 'conversation_reply_requires_admission'; matchedBy: 'reply_token' | 'thread_headers' | 'correspondent' }
  | { outcome: 'skipped'; reason: 'self_notification' }
  | null // No named-conversation evidence; ordinary intake still owns it.
>;
