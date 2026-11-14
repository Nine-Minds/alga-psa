import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth/rbac';
import { isClientUserType, isMspPrincipalUserType, type IUser } from '@alga-psa/types';

export class ContractScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractScopeError';
  }
}

export async function assertMspContractBillingPermission(
  user: IUser,
  tenant: string,
  action: 'read' | 'create' | 'update' | 'delete',
  context: string,
  trx?: Knex.Transaction,
): Promise<void> {
  if (!user || user.tenant !== tenant || !isMspPrincipalUserType(user.user_type)) {
    throw new ContractScopeError(`Permission denied: Cannot ${context}`);
  }
  // Test bypass never bypasses principal or tenant isolation.
  if (process.env.E2E_AUTH_BYPASS === 'true') return;
  if (!await hasPermission(user, 'billing', action, trx)) {
    throw new ContractScopeError(`Permission denied: Cannot ${context}`);
  }
}

/** Authorize the actual owner and line in the transaction that will write them. */
export async function assertContractLineMutationAuthorized(
  trx: Knex.Transaction,
  user: IUser,
  tenant: string,
  contractId: string,
  contractLineId: string,
): Promise<void> {
  if (!user || user.tenant !== tenant) {
    throw new ContractScopeError('Permission denied: Cannot modify contract lines');
  }

  const scoped = tenantDb(trx, tenant);
  // Hold the owning record through the write so its scope cannot change after authorization.
  const template = await scoped.table('contract_templates')
    .where({ template_id: contractId }).forShare().first('template_id');
  if (template) {
    if (isClientUserType(user.user_type)) {
      throw new ContractScopeError('Permission denied: Contract is outside your client scope.');
    }
    await assertMspContractBillingPermission(user, tenant, 'update', 'modify contract lines', trx);
    const line = await scoped.table('contract_template_lines')
      .where({ template_id: contractId, template_line_id: contractLineId }).forUpdate().first('template_line_id');
    if (!line) throw new ContractScopeError('Template contract line not found for the selected contract.');
    return;
  }

  const contract = await scoped.table('contracts')
    .where({ contract_id: contractId }).forShare().first('contract_id', 'owner_client_id');
  if (!contract) throw new ContractScopeError('Contract not found for the selected tenant.');
  if (isClientUserType(user.user_type) && (!user.clientId || user.clientId !== contract.owner_client_id)) {
    throw new ContractScopeError('Permission denied: Contract is outside your client scope.');
  }

  // Ownership is necessary for client scope, but does not grant MSP rate authoring.
  await assertMspContractBillingPermission(user, tenant, 'update', 'modify contract lines', trx);
  const line = await scoped.table('contract_lines')
    .where({ contract_id: contractId, contract_line_id: contractLineId }).forUpdate().first('contract_line_id');
  if (!line) throw new ContractScopeError('Contract line not found for the selected contract.');
}
