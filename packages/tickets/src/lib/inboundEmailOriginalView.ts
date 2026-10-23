/**
 * Wiring for the "Original email" view of an inbound-email body.
 *
 * A ticket description or comment created from inbound mail stores the lossy
 * rich-text conversion of the message. `/api/tickets/:id/email-html` re-renders
 * the archived `.eml` for readers who want the sender's formatting back; these
 * helpers decide when that view can exist at all, so the toggle is never
 * offered for a body that was never an email. The endpoint answers 404 when no
 * artifact was archived, which the viewer turns into "hide the toggle".
 */

import { COMMENT_RESPONSE_SOURCES, type IComment } from '@alga-psa/types';
import { getCommentResponseSource } from './responseSource';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function messageIdOf(metadata: unknown): string | null {
  const record = asRecord(metadata);
  if (!record) return null;
  const email = asRecord(record.email) ?? record;
  const messageId = email.messageId ?? record.messageId;
  return typeof messageId === 'string' && messageId.trim() ? messageId.trim() : null;
}

/** Endpoint for a comment's original email, or null when there can be none. */
export function originalEmailSourceForComment(
  ticketId: string | null | undefined,
  comment: Pick<IComment, 'comment_id' | 'metadata' | 'is_internal' | 'author_type' | 'user_id' | 'response_source'>
): string | null {
  if (!ticketId || !comment.comment_id) return null;
  if (getCommentResponseSource(comment as IComment) !== COMMENT_RESPONSE_SOURCES.INBOUND_EMAIL) return null;
  if (!messageIdOf(comment.metadata)) return null;
  return `/api/tickets/${ticketId}/email-html?commentId=${comment.comment_id}`;
}

/** Endpoint for a ticket description's original email, or null when there can be none. */
export function originalEmailSourceForTicket(
  ticket: { ticket_id?: string | null; email_metadata?: unknown } | null | undefined
): string | null {
  if (!ticket?.ticket_id) return null;
  if (!messageIdOf(ticket.email_metadata)) return null;
  return `/api/tickets/${ticket.ticket_id}/email-html`;
}

export interface OriginalEmailToggleLabels {
  text: string;
  originalEmail: string;
  emailShort: string;
  loading: string;
  error: string;
  group: string;
}

/** The switcher strings, so all four hosts stay on the same wording. */
export function originalEmailToggleLabels(
  t: (key: string, defaultValue: string) => string
): OriginalEmailToggleLabels {
  return {
    text: t('originalEmail.text', 'Text'),
    originalEmail: t('originalEmail.original', 'Original email'),
    emailShort: t('originalEmail.emailShort', 'Email'),
    loading: t('originalEmail.loading', 'Loading the original email…'),
    error: t('originalEmail.error', 'The original email could not be loaded.'),
    group: t('originalEmail.group', 'Message view'),
  };
}
