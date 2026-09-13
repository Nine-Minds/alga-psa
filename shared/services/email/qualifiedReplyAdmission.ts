import type { Knex } from 'knex';
import type { SenderAuthResults } from '../../lib/email/senderAuthVerification';
import type { AdmittedRequesterReply } from './requesterReplyAdmission';

export type AdmittedEmailReply = AdmittedRequesterReply | (Omit<AdmittedRequesterReply, 'kind' | 'audience'> & {
  kind: 'customer_technician'; userId: string;
  audience: 'requester' | 'shared_it' | 'organization_private';
  /** Current authorized title used instead of a private reply's email subject. */
  followupTitle?: string;
});
/** Trusted composition supplies identity and current read/write authority. The
 * engine does not resolve a privileged user from a sender address or token ID. */
export type EmailReplyAdmission = <T extends { outcome: string; ticketId?: string; commentId?: string }>(trx: Knex.Transaction, input: {
  tenant: string; inboxId: string; sourceSha256?: string; token: string; senderEmail: string; senderAuth: SenderAuthResults | null;
}, write: (reply: AdmittedEmailReply) => Promise<T>) => Promise<{ admitted: true; result: T } | { admitted: false }>;

export function isQualifiedReplyToken(token: unknown): token is string {
  return typeof token === 'string' && /^cm[12]:/i.test(token);
}
/** A named vendor exchange must never enter legacy requester matching, even
 * when its body marker is malformed, quoted beside another token, or stripped
 * while its conversation RFC reference survives. */
export function hasNamedConversationReplyHint(input: { body?: { text?: string; html?: string }; inReplyTo?: string; references?: string[] }): boolean {
  const marker = /(?:ALGA-REPLY-TOKEN[\s:]+|data-alga-reply-token\s*=\s*["']|alga:reply-token:)tc1:/i;
  return [input.body?.text, input.body?.html].some(value => value && marker.test(value)) ||
    [input.inReplyTo, ...(input.references ?? [])].some(value => value && /(?:^|[\s<])conversation-[0-9a-f-]+@/i.test(value));
}
/** Reserve malformed/case-variant markers before any native dedupe or matching. */
export function qualifiedReplyTokenFromBody(body: { text?: string; html?: string } | undefined): string | undefined {
  for (const content of [body?.text, body?.html]) {
    if (!content) continue;
    const match = /(?:ALGA-REPLY-TOKEN[\s:]+|data-alga-reply-token\s*=\s*["']|alga:reply-token:)(cm[12]:[^\s<>"'\]]*?)(?=-->|[\s<>"'\]]|$)/i.exec(content);
    if (match) return match[1];
  }
  return undefined;
}
