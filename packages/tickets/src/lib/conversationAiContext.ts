import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { getNamedTicketConversationMessages, listNamedTicketConversations, withNamedTicketConversation,
  type CoManagedSessionActor, type CoManagedConversationItem } from '@alga-psa/co-managed';
import { snapshotConversationReference, snapshotConversationTicket, TicketConversationError,
  type ConversationTicketReference, type TicketConversationReference, type NamedTicketConversation } from '@alga-psa/shared/lib/tickets/namedConversations';
import { snapshotCoManagedSessionActor } from '@alga-psa/co-managed';
import { extractTicketRichTextPlainText } from './ticketRichText';

import { ConversationAiError, type ConversationAiSourceRequest, type ConversationAiMessage, type ConversationAiSnapshot } from '@alga-psa/shared/lib/tickets/conversationAi';
export { ConversationAiError } from '@alga-psa/shared/lib/tickets/conversationAi';
export type { ConversationAiSourceRequest, ConversationAiMessage, ConversationAiInput, ConversationAiSnapshot } from '@alga-psa/shared/lib/tickets/conversationAi';

// These are admission bounds, not an assertion about a configured model's context
// window. Provider context-limit failures must also return an honest unavailable
// result. No path returns a prefix while claiming a complete conversation.
const defaultLimits = { messages: 5000, bytes: 512 * 1024 };
const keyOf = (ref: TicketConversationReference) => `${ref.storeTenant}:${ref.conversationId}`;
const messageKey = (item: { commentId: string; threadId: string }) => `${item.threadId}:${item.commentId}`;
const invalid = (): never => { throw new TicketConversationError('CONVERSATION_INVALID'); };
const forbidden = (): never => { throw new TicketConversationError('CONVERSATION_FORBIDDEN'); };
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function snapshotRequest(input: ConversationAiSourceRequest): ConversationAiSourceRequest {
  if (!input || typeof input !== 'object') return invalid();
  if (input.kind === 'synthesis' && Object.keys(input).every(key => ['kind', 'source'].includes(key)))
    return { kind: 'synthesis', source: snapshotConversationReference(input.source) };
  if (input.kind !== 'conversation' || Object.keys(input).some(key => !['kind', 'sources'].includes(key)) ||
    !Array.isArray(input.sources) || input.sources.length > 64) return invalid();
  const sources = input.sources.map(snapshotConversationReference);
  if (new Set(sources.map(keyOf)).size !== sources.length) return invalid();
  return { kind: 'conversation', sources };
}
function permitsContext(destination: NamedTicketConversation, source: NamedTicketConversation, actor: CoManagedSessionActor) {
  // Shared IT inference never inherits the caller's greater private visibility.
  if (destination.audience === 'shared_it') return source.audience !== 'organization_private' && source.storeTenant === destination.ticket.tenant;
  return source.audience !== 'organization_private' || source.storeTenant === actor.tenant;
}
function assertInternalAiDestination(destination: NamedTicketConversation) {
  if (destination.transport !== 'internal' || destination.audience === 'requester') return forbidden();
}
/** UI source choices use the same intersection as inference; inaccessible or
 * audience-incompatible names are not sent to the browser as disabled options. */
export async function getConversationAiSources(db: Knex, inputActor: CoManagedSessionActor, inputTicket: ConversationTicketReference,
  inputDestination: TicketConversationReference) {
  const actor = snapshotCoManagedSessionActor(inputActor), ticket = snapshotConversationTicket(inputTicket), destination = snapshotConversationReference(inputDestination);
  return withNamedTicketConversation(db, actor, ticket, destination, 'update', async context => {
    assertInternalAiDestination(context.conversation);
    return (await listNamedTicketConversations(context.trx, actor, ticket))
      .filter(source => permitsContext(context.conversation, source, actor))
      .map(source => ({ storeTenant: source.storeTenant, conversationId: source.conversationId, name: source.name, audience: source.audience }));
  });
}
/** Only this explicit projection may enter inference. Rich-document file URLs,
 * email headers, protected source links, draft content and qualified actor/store
 * identifiers are never copied from the general history DTO into model input. */
export async function readConversationAiSnapshot(db: Knex, inputActor: CoManagedSessionActor, inputTicket: ConversationTicketReference,
  inputDestination: TicketConversationReference, input: ConversationAiSourceRequest, limits = defaultLimits): Promise<ConversationAiSnapshot> {
  const actor = snapshotCoManagedSessionActor(inputActor), ticket = snapshotConversationTicket(inputTicket);
  const destination = snapshotConversationReference(inputDestination), request = snapshotRequest(input);
  if (![limits.messages, limits.bytes].every(value => Number.isSafeInteger(value) && value > 0)) return invalid();
  // Snapshot trusted limits as well: a caller cannot grow the admission budget
  // while asynchronous source reads are in flight.
  const maxMessages = limits.messages, maxBytes = limits.bytes;
  return withNamedTicketConversation(db, actor, ticket, destination, 'update', async context => {
    if (request.kind === 'conversation') assertInternalAiDestination(context.conversation);
    const result: ConversationAiSnapshot = { destination: { ...destination, revision: context.conversation.revision, audience: context.conversation.audience },
      request, sources: [], input: { audience: context.conversation.audience, conversations: [] } };
    let count = 0, scanned = 0, bytes = 0;
    for (const reference of request.kind === 'synthesis' ? [request.source] : request.sources) {
      // A deliberate synthesis can cross from a private source to an outward
      // PRIVATE draft. Ordinary conversational AI cannot use that exception.
      let cursor: Parameters<typeof getNamedTicketConversationMessages>[4];
      const messages: CoManagedConversationItem[] = [];
      let source: NamedTicketConversation | undefined;
      do {
        const page = await getNamedTicketConversationMessages(context.trx, actor, ticket, reference, cursor);
        source = page.conversation;
        if (request.kind === 'conversation' && !permitsContext(context.conversation, source, actor)) return forbidden();
        for (const item of page.items) {
          if (++scanned > maxMessages) throw new ConversationAiError('AI_CONTEXT_TOO_LARGE');
          if (item.deleted || item.note === null) continue;
          // Count before materializing an additional model message. The bytes
          // include rich input so hidden embedded metadata cannot bypass bounds.
          count++; bytes += Buffer.byteLength(item.note, 'utf8');
          if (count > maxMessages || bytes > maxBytes) throw new ConversationAiError('AI_CONTEXT_TOO_LARGE');
          messages.push(item);
        }
        cursor = page.nextBefore ?? undefined;
      } while (cursor);
      const ordered = replyOrder(messages);
      const keys = new Map(ordered.map((item, index) => [messageKey(item), `message-${index + 1}`]));
      const manifest: ConversationAiSnapshot['sources'][number]['messages'] = [];
      const modelMessages = ordered.map(item => {
        const parent = item.parentCommentId ? keys.get(`${item.threadId}:${item.parentCommentId}`) : undefined;
        const message: ConversationAiMessage = { key: keys.get(messageKey(item))!, ...(parent ? { replyTo: parent } : {}), createdAt: item.createdAt,
          ...(item.author?.displayName ? { author: item.author.displayName } : {}), text: extractTicketRichTextPlainText(item.note),
          files: (item.attachments ?? []).map(file => ({ name: file.fileName, mimeType: file.mimeType, size: file.size })) };
        const attachmentIds = (item.attachments ?? []).map(file => file.attachmentId).sort();
        manifest.push({ commentId: item.commentId, threadId: item.threadId, attachmentIds, fingerprint: fingerprint({
          // Hash stable source identity/content, not page-relative model keys.
          note: item.note, revision: item.revision, updatedAt: item.updatedAt, parent: item.parentCommentId,
          author: message.author ?? null, files: message.files, attachmentIds }) });
        return message;
      });
      result.sources.push({ reference, revision: source!.revision, messageVersion: source!.messageVersion, messages: manifest });
      result.input.conversations.push({ name: request.kind === 'synthesis' && context.conversation.audience === 'requester' ? 'Source conversation' : source!.name,
        messages: modelMessages });
      if (Buffer.byteLength(JSON.stringify(result.input), 'utf8') > maxBytes) throw new ConversationAiError('AI_CONTEXT_TOO_LARGE');
    }
    if (request.kind === 'synthesis' && count === 0) throw new ConversationAiError('AI_SOURCE_INVALID');
    return result;
  });
}
function replyOrder(messages: CoManagedConversationItem[]) {
  const sorted = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.commentId.localeCompare(b.commentId));
  const keys = new Set(sorted.map(messageKey)), children = new Map<string, CoManagedConversationItem[]>(), roots: CoManagedConversationItem[] = [];
  for (const message of sorted) {
    const parent = message.parentCommentId ? `${message.threadId}:${message.parentCommentId}` : null;
    if (!parent || !keys.has(parent)) roots.push(message);
    else children.set(parent, [...children.get(parent) ?? [], message]);
  }
  const result: CoManagedConversationItem[] = [], stack = roots.reverse(), seen = new Set<string>();
  while (stack.length) {
    const item = stack.pop()!, key = messageKey(item);
    if (seen.has(key)) throw new ConversationAiError('AI_SOURCE_INVALID');
    seen.add(key); result.push(item); stack.push(...[...children.get(key) ?? []].reverse());
  }
  if (result.length !== messages.length) throw new ConversationAiError('AI_SOURCE_INVALID');
  return result;
}
/** Reauthorize before making generated output visible. Appended messages are a
 * review notice; removed/edited/redacted original input invalidates completion. */
export async function revalidateConversationAiSnapshot(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  previous: ConversationAiSnapshot) {
  const current = await readConversationAiSnapshot(db, actor, ticket,
    { storeTenant: previous.destination.storeTenant, conversationId: previous.destination.conversationId }, previous.request);
  if (current.destination.revision !== previous.destination.revision) throw new ConversationAiError('AI_SOURCE_CHANGED');
  let newSourceMessages = false;
  for (const source of previous.sources) {
    const next = current.sources.find(value => keyOf(value.reference) === keyOf(source.reference));
    if (!next || next.revision !== source.revision) throw new ConversationAiError('AI_SOURCE_CHANGED');
    const messages = new Map(next.messages.map(item => [messageKey(item), item.fingerprint]));
    if (source.messages.some(item => messages.get(messageKey(item)) !== item.fingerprint)) throw new ConversationAiError('AI_SOURCE_CHANGED');
    newSourceMessages ||= next.messages.length > source.messages.length || next.messageVersion !== source.messageVersion;
  }
  return { newSourceMessages };
}
