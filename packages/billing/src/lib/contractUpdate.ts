/**
 * Contract header update rules shared by the MSP UI server action (`updateContract`) and the
 * REST API (`PUT /api/v1/contracts/{contractId}`): system-managed refusal, expired-status
 * handling, the draft-with-invoices guard, the update itself, the CONTRACT_UPDATED event and
 * the post-update reactivation of expired contracts.
 *
 * `applyContractHeaderUpdate` (writes) and `publishContractHeaderUpdated` (announces) are
 * separate so the quick-add save can write the header inside its own transaction and publish
 * once that transaction has committed; `updateContractHeaderWithEvents` composes the two.
 *
 * Authorization (billing `update`) is the caller's job.
 */

import type { Knex } from 'knex';
import type { IContract } from '@alga-psa/types';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildContractRecordUpdatedPayload } from '@alga-psa/workflow-streams';
import Contract from '../models/contract';

export type ContractUpdateErrorCode = 'SYSTEM_MANAGED' | 'EXPIRED_STATUS' | 'HAS_INVOICES';

export class ContractUpdateError extends Error {
  readonly code: ContractUpdateErrorCode;

  constructor(code: ContractUpdateErrorCode, message: string) {
    super(message);
    this.name = 'ContractUpdateError';
    this.code = code;
  }
}

/** A header update that has been written; the input to {@link publishContractHeaderUpdated}. */
export type AppliedContractHeaderUpdate = {
  /** The row the update returned. */
  updated: IContract;
  /** The row as it was before the update. */
  before: IContract;
  /** The patch actually written (system-managed and tenant columns stripped). */
  patch: Record<string, unknown>;
  occurredAt: string;
};

/**
 * Apply the header rules and the update itself on a caller-owned connection or
 * transaction: system-managed refusal, expired-status handling and the
 * draft-with-invoices guard. Event publication is a separate step
 * ({@link publishContractHeaderUpdated}) so a caller that writes more rows in
 * the same transaction announces the change only once it has committed.
 */
export async function applyContractHeaderUpdate(
  knex: Knex | Knex.Transaction,
  tenant: string,
  currentContract: IContract,
  updateData: Partial<IContract>,
): Promise<AppliedContractHeaderUpdate> {
  const contractId = currentContract.contract_id;
  const data: Partial<IContract> = { ...updateData };

  if (currentContract.is_system_managed_default === true) {
    throw new ContractUpdateError(
      'SYSTEM_MANAGED',
      'System-managed default contracts are attribution-only; contract authoring and lifecycle edits are disabled.',
    );
  }

  if (currentContract.status === 'expired') {
    if (data.status && data.status !== 'expired') {
      throw new ContractUpdateError(
        'EXPIRED_STATUS',
        'Cannot manually change the status of an expired contract. To reactivate, extend the contract end date.',
      );
    }
    // Status is re-derived from the end dates after the update.
    if (data.status === 'expired') {
      delete data.status;
    }
  } else if (data.status === 'expired') {
    throw new ContractUpdateError(
      'EXPIRED_STATUS',
      'Cannot manually set contract to expired. Contracts are automatically expired when their end date passes.',
    );
  }

  if (data.status === 'draft') {
    if (await Contract.hasInvoices(knex, tenant, contractId)) {
      throw new ContractUpdateError(
        'HAS_INVOICES',
        'Cannot set contract to draft because it has associated invoices. Contracts with invoices cannot be set to draft.',
      );
    }
  }

  const {
    tenant: _ignoredTenant,
    is_system_managed_default: _ignoredSystemManagedMarker,
    owner_client_id: _ignoredOwnerClientId,
    ...safeUpdateData
  } = data as any;
  const updated = await Contract.update(knex, tenant, contractId, safeUpdateData);
  const occurredAt = updated.updated_at ?? new Date().toISOString();

  return { updated, before: currentContract, patch: safeUpdateData, occurredAt };
}

/** Announce an applied header update. Call it after the writing transaction has committed. */
export async function publishContractHeaderUpdated(
  tenant: string,
  applied: AppliedContractHeaderUpdate,
  actorUserId: string,
): Promise<void> {
  const { updated, before, patch, occurredAt } = applied;
  await publishWorkflowEvent({
    eventType: 'CONTRACT_UPDATED',
    payload: buildContractRecordUpdatedPayload({
      contractId: updated.contract_id,
      ownerClientId: updated.owner_client_id,
      userId: actorUserId,
      occurredAt: new Date(occurredAt).toISOString(),
      status: updated.status,
      patch,
      before: before as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
    }),
    ctx: {
      tenantId: tenant,
      occurredAt,
      actor: { actorType: 'USER' as const, actorUserId },
    },
    idempotencyKey: `contract_updated:${updated.contract_id}:${occurredAt}`,
  });
}

/**
 * Update a non-template contract header. `currentContract` must already be loaded by the
 * caller (the UI needs it first to decide between the contract and template branches).
 */
export async function updateContractHeaderWithEvents(
  knex: Knex,
  tenant: string,
  currentContract: IContract,
  updateData: Partial<IContract>,
  actorUserId: string,
): Promise<IContract> {
  const applied = await applyContractHeaderUpdate(knex, tenant, currentContract, updateData);
  await publishContractHeaderUpdated(tenant, applied, actorUserId);

  // After updating, check if an expired contract should be reactivated based on end dates.
  if (currentContract.status === 'expired') {
    await Contract.checkAndReactivateExpiredContract(knex, tenant, currentContract.contract_id);
    const reactivatedContract = await Contract.getById(knex, tenant, currentContract.contract_id);
    return reactivatedContract!;
  }

  return applied.updated;
}
