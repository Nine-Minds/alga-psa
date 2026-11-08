/**
 * Contract header update rules shared by the MSP UI server action (`updateContract`) and the
 * REST API (`PUT /api/v1/contracts/{contractId}`): system-managed refusal, expired-status
 * handling, the draft-with-invoices guard, the update itself, the CONTRACT_UPDATED event and
 * the post-update reactivation of expired contracts.
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
  await publishWorkflowEvent({
    eventType: 'CONTRACT_UPDATED',
    payload: buildContractRecordUpdatedPayload({
      contractId,
      ownerClientId: updated.owner_client_id,
      userId: actorUserId,
      occurredAt: new Date(occurredAt).toISOString(),
      status: updated.status,
      patch: safeUpdateData,
      before: currentContract as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
    }),
    ctx: {
      tenantId: tenant,
      occurredAt,
      actor: { actorType: 'USER' as const, actorUserId },
    },
    idempotencyKey: `contract_updated:${contractId}:${occurredAt}`,
  });

  // After updating, check if an expired contract should be reactivated based on end dates.
  if (currentContract.status === 'expired') {
    await Contract.checkAndReactivateExpiredContract(knex, tenant, contractId);
    const reactivatedContract = await Contract.getById(knex, tenant, contractId);
    return reactivatedContract!;
  }

  return updated;
}
