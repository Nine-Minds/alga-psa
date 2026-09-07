import type { Knex } from 'knex';
import type { SenderAuthResults } from '../../lib/email/senderAuthVerification';

/** Trusted worker composition supplies the admission policy. The mail engine
 * never turns a token into an internal user or chooses another requester. */
export interface AdmittedRequesterReply {
  kind: 'requester';
  audience: 'requester';
  ticketId: string;
  parentCommentId: string;
  clientId: string;
  contactId?: string;
  senderEmail: string;
  /** Cutoff policy may create a new ticket, but only in an admitted destination. */
  assertDestination: (destination: { clientId: string; boardId: string }) => Promise<void>;
}
export type RequesterReplyAdmission = <T>(trx: Knex.Transaction, input: {
  tenant: string; token: string; senderEmail: string; senderAuth: SenderAuthResults | null;
}, write: (requester: AdmittedRequesterReply) => Promise<T>) => Promise<{ admitted: true; result: T } | { admitted: false }>;
