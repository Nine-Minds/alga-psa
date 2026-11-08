'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { CoManagedLifecycleError } from '@alga-psa/licensing/lifecycle-error';
import { requireCapabilityEitherMode, requireCapabilityForAction } from '@alga-psa/core/capability/server';
import { CoManagedSharedWorkError, assertCoManagedSessionUnexpired, type CoManagedSharedResource, type CoManagedConversationCursor } from '@alga-psa/co-managed';
import { getCoManagedProjectTaskConversation, getCoManagedProjectTaskWriteAudiences, mutateCoManagedProjectTaskComment,
  CoManagedTaskCommentError, type CoManagedTaskCommentCommand } from '@alga-psa/co-managed/projectTaskConversation';
import { CoManagedPrivateCommentError } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';

// Reading serves what exists (`serves`); writing continues existing shared work and is also gated per
// mode by the capability. The actor always comes from the verified session, never from the caller.
// LEVERAGE: friction task-comment-outbox — L4a's outbox/event-source engine is not on main, so a saved
// task comment publishes nothing yet; the receipt still carries the operation id the outbox will key on.

export const getSharedProjectTaskConversationAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, before?: CoManagedConversationCursor) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return withTransaction(knex, async trx => {
    const writeAudiences = await getCoManagedProjectTaskWriteAudiences(trx, actor, resource);
    const conversation = await getCoManagedProjectTaskConversation(trx, actor, resource, before);
    await assertCoManagedSessionUnexpired(trx, actor);
    return { ...conversation, actor: { tenant: actor.tenant, userId: actor.userId }, writeAudiences };
  });
});

export type SaveSharedProjectTaskCommentResult =
  | { ok: true; receipt: Awaited<ReturnType<typeof mutateCoManagedProjectTaskComment>> }
  | { ok: false; code: 'invalid' | 'conflict' | 'operationConflict' | 'forbidden' | 'readOnly' | 'unknownOutcome' };

export const saveSharedProjectTaskCommentAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource,
  request: CoManagedTaskCommentCommand): Promise<SaveSharedProjectTaskCommentResult> => {
  await requireCapabilityEitherMode('co-managed', tenant);
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    const receipt = await withTransaction(knex, trx => mutateCoManagedProjectTaskComment(trx, actor, resource, request));
    return { ok: true, receipt };
  } catch (error) {
    if (error instanceof CoManagedSharedWorkError) return { ok: false, code: 'forbidden' };
    if (error instanceof CoManagedLifecycleError) return { ok: false, code: 'readOnly' };
    if (error instanceof CoManagedTaskCommentError || error instanceof CoManagedPrivateCommentError) {
      return { ok: false, code: error.code.includes('OPERATION_CONFLICT') ? 'operationConflict' : error.code.endsWith('CONFLICT') ? 'conflict' : 'invalid' };
    }
    return { ok: false, code: 'unknownOutcome' };
  }
});
