import type { Knex } from 'knex';
import type { EmailMessageDetails } from '../../interfaces/inbound-email.interfaces';
import type { AdmittedEmailReply } from './qualifiedReplyAdmission';
import type { ProcessInboundEmailInAppResult } from './processInboundEmailInApp';
import type { SenderAuthResults } from '../../lib/email/senderAuthVerification';
/** The inbox transaction owns delivery dedupe. Named replies retain qualified
 * destination receipts so artifact handling never infers a store from a UUID. */
export type NamedConversationReplyAdmission = (trx: Knex.Transaction, input: {
  tenant: string; providerId: string; inboxId: string; email: EmailMessageDetails; senderAuth: SenderAuthResults | null;
}, writeRequester?: (reply: AdmittedEmailReply & { audience: 'requester' }, matchedBy?: 'reply_token' | 'thread_headers') => Promise<ProcessInboundEmailInAppResult>) => Promise<
  ProcessInboundEmailInAppResult | null // No named evidence leaves ordinary intake in charge.
>;
