'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex } from '@alga-psa/db';
import { requireCapabilityForAction } from '@alga-psa/core/capability/server';
import {
  CoManagedSeatArrangementError, endCoManagedSeatArrangement, previewCoManagedSeatArrangementEnd,
  type CoManagedSeatArrangementEndPreview, type CoManagedSeatArrangementEndResult,
} from '@alga-psa/co-managed';

// Every seat surface resolves the `co-managed-seat` capability, never the raw release flag. Ending
// an arrangement is a management action, so it gates on `admits` (flag and eligibility): with the
// flag off nothing here is reachable, whether or not an arrangement exists.

export type CoManagedSeatEndPreviewResult =
  | { ok: true; preview: CoManagedSeatArrangementEndPreview }
  | { ok: false; reason: 'denied' | 'not_found' };

export type CoManagedSeatEndResult =
  | { ok: true; result: CoManagedSeatArrangementEndResult }
  | { ok: false; reason: 'denied' | 'not_found' };

const mayManage = async (user: Parameters<typeof hasPermission>[0]) =>
  user.user_type === 'internal' && await hasPermission(user, 'co_management', 'manage');

/** The effects of ending an arrangement, for the confirmation. Reads only. */
export const getCoManagedSeatArrangementEndPreview = withAuth(async (user, { tenant },
  input: { arrangementId: string }): Promise<CoManagedSeatEndPreviewResult> => {
  await requireCapabilityForAction('co-managed-seat', tenant, 'admits');
  if (!await mayManage(user)) return { ok: false, reason: 'denied' };
  const { knex } = await createTenantKnex(tenant);
  try {
    return { ok: true, preview: await previewCoManagedSeatArrangementEnd(knex, { sponsorTenant: tenant, arrangementId: input.arrangementId }) };
  } catch (error) {
    if (error instanceof CoManagedSeatArrangementError && error.code === 'ARRANGEMENT_NOT_FOUND') return { ok: false, reason: 'not_found' };
    throw error;
  }
});

/** Ends the arrangement. Replaying it after it completed changes nothing and succeeds. */
export const endCoManagedSeatArrangementAction = withAuth(async (user, { tenant },
  input: { arrangementId: string }): Promise<CoManagedSeatEndResult> => {
  await requireCapabilityForAction('co-managed-seat', tenant, 'admits');
  if (!await mayManage(user)) return { ok: false, reason: 'denied' };
  const { knex } = await createTenantKnex(tenant);
  try {
    return { ok: true, result: await endCoManagedSeatArrangement(knex, {
      sponsorTenant: tenant, arrangementId: input.arrangementId, actorUserId: user.user_id }) };
  } catch (error) {
    if (error instanceof CoManagedSeatArrangementError && error.code === 'ARRANGEMENT_NOT_FOUND') return { ok: false, reason: 'not_found' };
    throw error;
  }
});
