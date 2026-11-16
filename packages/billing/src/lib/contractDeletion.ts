/**
 * Contract deletion rules shared by the MSP UI server action (`deleteContract`) and the
 * REST API (`DELETE /api/v1/contracts/{contractId}`), so the two can never drift.
 *
 * Authorization is the caller's job (UI: billing `delete` permission; API: the same
 * permission via the API user). Everything else — template branch, system-managed
 * refusal, invoice guard, single-transaction delete, post-commit events — lives here.
 */

import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { publishNonCatalogWorkflowEvent } from '@alga-psa/event-bus/publishers';
import Contract from '../models/contract';
import ContractTemplateModel from '../models/contractTemplate';

export type ContractDeletionErrorCode = 'NOT_FOUND' | 'SYSTEM_MANAGED' | 'HAS_INVOICES';

export class ContractDeletionError extends Error {
  readonly code: ContractDeletionErrorCode;

  constructor(code: ContractDeletionErrorCode, message: string) {
    super(message);
    this.name = 'ContractDeletionError';
    this.code = code;
  }
}

// The UI maps this exact message to its localized "has invoices" error.
export const CONTRACT_HAS_INVOICES_MESSAGE = 'Cannot delete contract that has associated invoices';
export const CONTRACT_SYSTEM_MANAGED_MESSAGE = 'System-managed default contracts cannot be deleted manually';

export async function deleteContractWithEvents(
  knex: Knex,
  tenant: string,
  contractId: string,
  actorUserId: string,
): Promise<void> {
  const template = await tenantDb(knex, tenant)
    .table('contract_templates')
    .where({ template_id: contractId })
    .first();
  if (template) {
    await ContractTemplateModel.delete(contractId, tenant);
    return;
  }

  // LEVERAGE: friction contract-delete-owns-transaction — Contract.delete issues ~15
  // statements but leaves the transaction to its caller, so every caller must remember
  // to wrap it or a mid-way failure orphans the contract header.
  // Everything commits together or rolls back; events are published only after commit.
  const clientContracts = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const currentContract = await Contract.getById(trx, tenant, contractId);
    if (!currentContract) {
      throw new ContractDeletionError('NOT_FOUND', `Contract ${contractId} not found`);
    }
    if (currentContract.is_system_managed_default === true) {
      throw new ContractDeletionError('SYSTEM_MANAGED', CONTRACT_SYSTEM_MANAGED_MESSAGE);
    }
    if (await Contract.hasInvoices(trx, tenant, contractId)) {
      throw new ContractDeletionError('HAS_INVOICES', CONTRACT_HAS_INVOICES_MESSAGE);
    }

    const rows = await tenantDb(trx, tenant)
      .table('client_contracts')
      .where({ contract_id: contractId })
      .select('client_contract_id', 'client_id');

    await Contract.delete(trx, tenant, contractId);
    return rows;
  });

  const occurredAt = new Date().toISOString();
  const actor = { actorType: 'USER' as const, actorUserId };

  for (const clientContract of clientContracts) {
    await publishNonCatalogWorkflowEvent({
      eventType: 'CLIENT_CONTRACT_DELETED',
      payload: {
        clientContractId: clientContract.client_contract_id,
        contractId,
        clientId: clientContract.client_id,
        userId: actorUserId,
        timestamp: occurredAt,
      },
      ctx: { tenantId: tenant, occurredAt, actor },
      idempotencyKey: `client_contract_deleted:${clientContract.client_contract_id}:${occurredAt}`,
    });
  }

  await publishNonCatalogWorkflowEvent({
    eventType: 'CONTRACT_DELETED',
    payload: { contractId, userId: actorUserId, timestamp: occurredAt },
    ctx: { tenantId: tenant, occurredAt, actor },
    idempotencyKey: `contract_deleted:${contractId}:${occurredAt}`,
  });
}
