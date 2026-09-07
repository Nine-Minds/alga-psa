import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { type CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import { withCoManagedSharedWork, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { withCoManagedCustomerTicket } from './customerWork';
import { assertCoManagedSessionUnexpired, isCoManagedUuid, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { coManagedConversationBodySources, coManagedConversationAuthorSources, coManagedConversationAttachmentSources } from './conversationPolicy';

export interface CoManagedThreadReference { storeTenant: string; threadId: string }
export interface CoManagedThreadDisclosurePreview extends CoManagedThreadReference {
  audience: CommentAudience; snapshot: string; comments: number; attachments: number; pendingAttachments: number;
}
export interface CoManagedThreadDisclosureRequest extends CoManagedThreadReference {
  operationId: string; expectedSnapshot: string; audience: CommentAudience; confirmed: true;
}
export interface CoManagedThreadDisclosureReceipt extends CoManagedThreadReference { operationId: string; audience: CommentAudience; appliedAt: string }
export class CoManagedThreadDisclosureError extends Error {
  constructor(public readonly code: 'INVALID_THREAD_DISCLOSURE' | 'THREAD_DISCLOSURE_CONFLICT' | 'THREAD_DISCLOSURE_OPERATION_CONFLICT') {
    super({ INVALID_THREAD_DISCLOSURE: 'The audience change is not valid.', THREAD_DISCLOSURE_CONFLICT: 'The conversation changed. Review it again before changing its audience.',
      THREAD_DISCLOSURE_OPERATION_CONFLICT: 'This operation was already used for a different audience change.' }[code]);
    this.name = 'CoManagedThreadDisclosureError';
  }
}
export const deny = (): never => { throw new CoManagedSharedWorkError(); };
export const invalid = (): never => { throw new CoManagedThreadDisclosureError('INVALID_THREAD_DISCLOSURE'); };
export const conflict = (): never => { throw new CoManagedThreadDisclosureError('THREAD_DISCLOSURE_CONFLICT'); };
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function target(input: CoManagedThreadReference): CoManagedThreadReference {
  if (!input || ![input.storeTenant, input.threadId].every(isCoManagedUuid)) invalid();
  return { storeTenant: input.storeTenant.toLowerCase(), threadId: input.threadId.toLowerCase() };
}
export function resourceSnapshot(input: CoManagedSharedResource): CoManagedSharedResource {
  if (!input || input.kind !== 'ticket' || ![input.tenant, input.relationshipId, input.id].every(isCoManagedUuid)) deny();
  return { kind: 'ticket', tenant: input.tenant.toLowerCase(), relationshipId: input.relationshipId.toLowerCase(), id: input.id.toLowerCase() };
}
export async function withAuthority<T>(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource,
  work: (context: CoManagedSharedWorkContext) => Promise<T>, privateStore = false): Promise<T> {
  const authorize = actor.tenant === resource.tenant ? withCoManagedCustomerTicket : withCoManagedSharedWork;
  return authorize(db, actor, resource, 'update', context => authorize(context.trx, actor, resource, 'read', async read => {
    if (isCoManagedReadFieldHidden([...context.redactedFields, ...read.redactedFields], [...coManagedConversationBodySources,
      ...coManagedConversationAuthorSources, ...coManagedConversationAttachmentSources, 'comments', 'comment_threads', 'co_management_conversation_drafts', ...(privateStore ? ['co_management_private_comments', 'co_management_private_threads', 'co_management_thread_transfers'] : [])])) deny();
    await assertCoManagedSessionUnexpired(context.trx, actor);
    const result = await work(context);
    await assertCoManagedSessionUnexpired(context.trx, actor); await assertCoManagedOperationalWrite(context.trx, resource.tenant);
    return result;
  }));
}
