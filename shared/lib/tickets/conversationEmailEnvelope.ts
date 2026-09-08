import { TicketConversationError } from './namedConversations';
import type { ReviewedEmailAddress } from '../email/reviewedEmail';
/** Incomplete addresses are retained while editing; strict admission happens at review. */
export interface ConversationEmailDraft { subject: string; to: string[]; cc: string[] }
export function snapshotConversationEmailDraft(input: unknown): ConversationEmailDraft | null {
  if (input == null) return null;
  const value = input as ConversationEmailDraft;
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['subject', 'to', 'cc'].includes(key)) ||
      typeof value.subject !== 'string' || value.subject.length > 255 || /[\r\n\0]/.test(value.subject) ||
      ![value.to, value.cc].every(list => Array.isArray(list) && list.length <= 100 && list.every(item => typeof item === 'string' && item.length <= 500 && !/[\r\n\0]/.test(item)))) {
    throw new TicketConversationError('CONVERSATION_INVALID');
  }
  return { subject: value.subject, to: [...value.to], cc: [...value.cc] };
}
export function reviewConversationEmailDraft(input: ConversationEmailDraft, routingAddresses: readonly string[]) {
  const draft = snapshotConversationEmailDraft(input)!;
  if (!draft.subject.trim()) throw new TicketConversationError('CONVERSATION_INVALID');
  const seen = new Set(routingAddresses.map(value => value.trim().toLowerCase()));
  const list = (values: string[]) => values.flatMap(value => {
    const text = value.trim();
    if (!text) return [];
    const match = /^(?:"?([^"<>]*)"?\s*)?<([^<>]+)>$/.exec(text);
    const email = (match ? match[2] : text).trim().toLowerCase(), name = match?.[1]?.trim();
    if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email)) throw new TicketConversationError('CONVERSATION_INVALID');
    if (seen.has(email)) return [];
    seen.add(email);
    return [{ email, ...(name ? { name } : {}) } satisfies ReviewedEmailAddress];
  });
  const to = list(draft.to), cc = list(draft.cc);
  if (!to.length) throw new TicketConversationError('CONVERSATION_INVALID');
  return { subject: draft.subject.trim(), to, cc };
}
