import type { Knex } from 'knex';
import type { SenderAuthResults } from '../../lib/email/senderAuthVerification';

/** Trusted worker composition supplies the admission policy. The mail engine
 * never turns a token into an internal user or chooses another requester. */
export interface AdmittedRequesterReply {
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

/** Reserve malformed and case-variant tokens too; rejection cannot fall through
 * to legacy tokens, RFC thread headers, subject matching or new-ticket rules. */
export function isRequesterReplyToken(token: unknown): token is string {
  return typeof token === 'string' && /^cm1:/i.test(token);
}

/** Detect reserved markers even if the generic parser rejects malformed token
 * characters. A malformed qualified marker must not become native threading. */
export function requesterReplyTokenFromBody(body: { text?: string; html?: string } | undefined): string | undefined {
  for (const content of [body?.text, body?.html]) {
    if (!content) continue;
    const match = /(?:ALGA-REPLY-TOKEN[\s:]+|data-alga-reply-token\s*=\s*["']|alga:reply-token:)(cm1:[^\s<>"'\]]*?)(?=-->|[\s<>"'\]]|$)/i.exec(content);
    if (match) return match[1];
  }
  return undefined;
}
