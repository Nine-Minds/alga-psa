import type { Knex } from 'knex';
import type { ZodError } from 'zod';
import { withTransaction, createTenantKnex } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth/rbac';
import { actionError, permissionError, type ActionMessageError, type ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { createAssetReadContext, isAssetReadAllowed } from '@alga-psa/assets/lib/assetReadAuthorization';
import { publishCustodyChanged } from '@alga-psa/assets/lib/custody/publishCustodyChanged';
import { isCustodyError } from '@alga-psa/assets/lib/custody/errors';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildAssetUpdatedPayload } from '@alga-psa/workflow-streams';
import { RmaTransitionError } from './stateMachine';
import { WarrantyError, type WarrantyTransitionResult } from './warrantyTransitions';
import { publishRmaUpdated } from './publishRmaUpdated';

/**
 * Shared plumbing for the warranty server actions: the permission rule, error → value mapping, the record-level
 * asset gate, and the post-commit publishes. Not a 'use server' module (it exports non-actions).
 */

export type WarrantyActionError = ActionMessageError | ActionPermissionError;

/**
 * Warranty work needs `warranty:<action>` OR the legacy `inventory:<action>` (so existing custom roles that
 * can run RMAs keep working), and every write additionally needs `asset:update` because it touches a client asset.
 */
export async function requireWarrantyPerm(user: any, action: 'create' | 'read' | 'update'): Promise<void> {
  const ok = (await hasPermission(user, 'warranty', action)) || (await hasPermission(user, 'inventory', action));
  if (!ok) throw new Error(`Permission denied: warranty ${action} required`);
  if (action !== 'read' && !(await hasPermission(user, 'asset', 'update'))) {
    throw new Error('Permission denied: asset update required');
  }
}

const CODE_MESSAGES: Record<string, [string, string]> = {
  not_found: ['RMA case not found. It may have been updated or deleted. Please refresh and try again.', 'features/inventory:errors.rma.caseNotFound'],
  unit_tracked: ['This RMA is for a stock unit. Use the stock-unit RMA actions.', 'features/inventory:errors.rma.warrantyUnitTracked'],
  stock_tracked_asset: ['This device was sold from stock. Open an RMA from its stock unit instead.', 'features/inventory:errors.rma.warrantyStockTrackedAsset'],
  not_client_owned: ['Warranty claims are for client-owned equipment.', 'features/inventory:errors.rma.warrantyNotClientOwned'],
  no_custody: ['The device is not in custody. Receive the equipment first.', 'features/inventory:errors.rma.warrantyNoCustody'],
  custody_wrong_state: ['The device is not in the right place for this step. Refresh and check its custody.', 'features/inventory:errors.rma.warrantyCustodyWrongState'],
  vendor_required: ['Choose a valid vendor.', 'features/inventory:errors.rma.vendorRequired'],
  location_required: ['Choose where the device is now so it can be received back.', 'features/inventory:errors.rma.warrantyLocationRequired'],
  invalid_transition: ['That step is not available in the RMA’s current status. Refresh and try again.', 'features/inventory:errors.rma.warrantyInvalidTransition'],
  warranty_review_close: ['Approve or deny the claim before closing it.', 'features/inventory:errors.rma.warrantyReviewClose'],
};

/**
 * Input that fails its Zod schema is a refusal, not a throw: a ZodError's `issues` do not survive the server-action
 * boundary, so the first issue is returned as a value with its translation key. Messages in the schemas are the
 * user-facing strings; anything without a curated one (a malformed id, say) gets the generic message.
 */
const VALIDATION_MESSAGES: Record<string, string> = {
  'Describe what is wrong with the device': 'features/inventory:errors.rma.warrantyReasonRequired',
  'Give the reason the claim is not covered': 'features/inventory:errors.rma.warrantyDenialReasonRequired',
  'Enter the carrier': 'features/inventory:errors.rma.warrantyCarrierRequired',
  'Enter the tracking number': 'features/inventory:errors.rma.warrantyTrackingRequired',
  'Enter the replacement serial number': 'features/inventory:errors.rma.warrantyReplacementSerialRequired',
  'Use YYYY-MM-DD': 'features/inventory:errors.rma.warrantyDateFormat',
  'Not a real calendar date': 'features/inventory:errors.rma.warrantyDateInvalid',
};

export function validationActionError(error: ZodError): WarrantyActionError {
  const message = error.issues[0]?.message ?? '';
  const key = VALIDATION_MESSAGES[message];
  return key
    ? actionError(message, key)
    : actionError('Some of the details are not valid. Check them and try again.', 'features/inventory:errors.rma.warrantyInputInvalid');
}

export function warrantyActionErrorFrom(error: unknown): WarrantyActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied') || error.message === 'user is not logged in') {
      return permissionError(error.message);
    }
    if (error instanceof WarrantyError || error instanceof RmaTransitionError) {
      const [message, key] = CODE_MESSAGES[error.code] ?? [error.message, undefined];
      return actionError(message, key);
    }
    if (isCustodyError(error)) return actionError(error.message);
  }
  const code = (error as { code?: string })?.code;
  if (code === '23503') return actionError('One of the selected records is no longer valid. Please refresh and try again.', 'features/inventory:errors.rma.recordInvalid');
  if (code === '23505') return actionError('That RMA reference or number is already in use.', 'features/inventory:errors.rma.duplicateReference');
  if (code === '23514') return actionError('That value is not allowed for this RMA.', 'features/inventory:errors.rma.checkViolation');
  return null;
}

export async function withWarrantyErrors<T>(operation: () => Promise<T>): Promise<T | WarrantyActionError> {
  try {
    return await operation();
  } catch (error) {
    const expected = warrantyActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

/** Builds the core option that applies the asset's record-level read check; a miss reads as "not found". */
export async function assetGate(trx: Knex.Transaction, tenant: string, user: { user_id: string } & Record<string, any>) {
  const ctx = await createAssetReadContext(trx, tenant, user as any);
  return async (assetId: string, clientId: string | null) => {
    if (!(await isAssetReadAllowed(trx, tenant, ctx, { asset_id: assetId, client_id: clientId }))) {
      throw new WarrantyError('not_found', 'RMA case not found');
    }
  };
}

/** Run one transition core inside a transaction, then publish its post-commit events. */
export async function runWarrantyTransition(
  user: { user_id: string } & Record<string, any>,
  tenant: string,
  core: (trx: Knex.Transaction, authorizeAsset: (assetId: string, clientId: string | null) => Promise<void>) => Promise<WarrantyTransitionResult>
): Promise<WarrantyTransitionResult> {
  const { knex: db } = await createTenantKnex();
  const result = await withTransaction(db, async (trx: Knex.Transaction) => core(trx, await assetGate(trx, tenant, user)));
  await publishAfterCommit(tenant, user.user_id, result);
  return result;
}

export async function publishAfterCommit(tenant: string, actorUserId: string, result: WarrantyTransitionResult): Promise<void> {
  await publishRmaUpdated(tenant, result.rma, result.previousStatus, result.changedFields, actorUserId);
  for (const effect of result.custodyEffects) {
    await publishCustodyChanged({ tenant, actorUserId, custody: effect.custody, eventType: effect.eventType as any, occurredAt: effect.occurredAt });
    const change = effect.assetStatusChange;
    if (change) await publishAssetUpdated(tenant, actorUserId, change.assetId, { status: change.before }, { status: change.after }, ['status']);
  }
  if (result.assetEffect) {
    const a = result.assetEffect;
    await publishAssetUpdated(tenant, actorUserId, a.assetId, a.before, a.after, a.changedPaths);
  }
}

async function publishAssetUpdated(
  tenant: string, actorUserId: string, assetId: string,
  before: Record<string, unknown>, after: Record<string, unknown>, updatedPaths: string[]
) {
  const occurredAt = new Date().toISOString();
  try {
    await publishWorkflowEvent({
      eventType: 'ASSET_UPDATED',
      payload: buildAssetUpdatedPayload({ assetId, before, after, updatedPaths, updatedByUserId: actorUserId, updatedAt: occurredAt }),
      ctx: { tenantId: tenant, occurredAt, actor: { actorType: 'USER', actorUserId } },
    });
  } catch (error) {
    console.error(`Post-commit effect failed (tenant=${tenant} asset_id=${assetId} event=ASSET_UPDATED):`, error);
  }
}
