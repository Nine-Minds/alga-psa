'use server'

import { Knex } from 'knex';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildClientMergedPayload } from '@alga-psa/workflow-streams';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { assertMspPermission } from '../lib/authHelpers';
import {
  ClientMergeBlockedError,
  executeClientMerge,
  previewClientMerge as previewClientMergeInternal,
  type ClientMergeInput,
  type ClientMergePreview,
  type ClientMergeResult,
} from '../lib/clientMergeEngine';

/**
 * Merging a client into a parent as a billing profile.
 *
 * Absorbing a client is the most destructive non-deletion operation in the
 * product — it moves every ticket, contact, contract and invoice a client has —
 * so it is gated on both `client:update` (it writes to the target) and
 * `client:delete` (it retires the source), and it always offers a dry run
 * first.
 */

export type ClientMergeActionError = ActionMessageError | ActionPermissionError;

export type { ClientMergePreview, ClientMergeResult, ClientMergeInput };

function mergeActionErrorFrom(error: unknown): ClientMergeActionError | null {
  if (error instanceof ClientMergeBlockedError) {
    const first = error.blockers[0];
    return actionError(
      error.message,
      first?.i18nKey ?? 'msp/clients:errors.clientMerge.blocked',
    );
  }
  if (error instanceof Error) {
    if (error.message.includes('Permission denied')) {
      return permissionError(error.message);
    }
    if (/unauthorized|not authenticated|must sign in/i.test(error.message)) {
      return permissionError(
        'You must be signed in to merge clients.',
        'msp/clients:errors.clientMerge.signInRequired',
      );
    }
  }
  return null;
}

async function assertCanMerge(user: any): Promise<void> {
  await assertMspPermission(user, 'client', 'update', 'Permission denied: Cannot merge clients');
  await assertMspPermission(user, 'client', 'delete', 'Permission denied: Cannot merge clients');
}

/**
 * A dry run. Returns the counts, the profiles that would move, the contracts
 * with their suggested date treatment and any blockers, and writes nothing —
 * the transaction exists only to give the reads a consistent snapshot.
 */
export const previewClientMerge = withAuth(async (
  user,
  { tenant },
  input: { sourceClientId: string; targetClientId: string },
): Promise<ClientMergePreview | ClientMergeActionError> => {
  try {
    await assertCanMerge(user);
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) =>
      previewClientMergeInternal(trx, tenant, input));
  } catch (error) {
    const expected = mergeActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const mergeClientIntoParent = withAuth(async (
  user,
  { tenant },
  input: ClientMergeInput,
): Promise<ClientMergeResult | ClientMergeActionError> => {
  try {
    await assertCanMerge(user);
    const { knex } = await createTenantKnex();
    const result = await withTransaction(knex, async (trx: Knex.Transaction) =>
      executeClientMerge(trx, tenant, user.user_id, input));

    // Published after the transaction commits: a subscriber that reacted to a
    // merge that then rolled back would be acting on a client that still exists.
    const mergedAt = new Date().toISOString();
    await publishWorkflowEvent({
      eventType: 'CLIENT_MERGED',
      payload: buildClientMergedPayload({
        sourceClientId: result.sourceClientId,
        targetClientId: result.targetClientId,
        mergedByUserId: user.user_id,
        mergedAt,
        strategy: 'merge_into_billing_profile',
      }),
      ctx: {
        tenantId: tenant,
        occurredAt: mergedAt,
        actor: { actorType: 'USER' as const, actorUserId: user.user_id },
      },
      idempotencyKey: `client_merged:${result.mergeId}`,
    });

    return result;
  } catch (error) {
    const expected = mergeActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
