'use server';

import type { Knex } from 'knex';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import {
  listClientBillingProfiles,
  type ClientBillingProfileRow,
} from '@alga-psa/shared/billingClients/billingProfiles';

/**
 * Billing-profile reads and assignment for the billing surfaces (F044, F045).
 *
 * The list is a thin wrapper over the shared model, not a re-implementation:
 * the D6 invisibility rule keys off `profiles.length > 1`, and a second
 * implementation of that list would eventually disagree with the first about
 * whether a client is segmented.
 */

export type { ClientBillingProfileRow };

async function assertBillingRead(user: any): Promise<void> {
  if (!(await hasPermission(user, 'billing', 'read'))) {
    throw new Error('Permission denied: Cannot read billing profiles');
  }
}

async function assertBillingUpdate(user: any): Promise<void> {
  if (!(await hasPermission(user, 'billing', 'update'))) {
    throw new Error('Permission denied: Cannot assign billing profiles');
  }
}

export const getClientBillingProfilesForBilling = withAuth(async (
  user,
  { tenant },
  clientId: string,
): Promise<ClientBillingProfileRow[]> => {
  await assertBillingRead(user);
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: Knex.Transaction) =>
    listClientBillingProfiles(trx, tenant, clientId));
});

/**
 * Assign a contract to a billing profile — step 3 of the resolution chain.
 * A contract assignment beats the work item, so this is what makes the
 * multi-site and shared-site customer shapes bill correctly.
 */
export const assignContractBillingProfile = withAuth(async (
  user,
  { tenant },
  input: { clientContractId: string; billingProfileId: string | null },
): Promise<{ success: true }> => {
  await assertBillingUpdate(user);
  const { knex } = await createTenantKnex();
  await withTransaction(knex, async (trx: Knex.Transaction) => {
    const db = tenantDb(trx, tenant);
    if (input.billingProfileId) {
      const contract = await db
        .table('client_contracts')
        .where({ client_contract_id: input.clientContractId })
        .first('client_id');
      const profile = await db
        .table('client_billing_profiles')
        .where({ billing_profile_id: input.billingProfileId })
        .first('client_id');
      if (!contract || !profile || contract.client_id !== profile.client_id) {
        throw new Error('That billing profile belongs to a different client.');
      }
    }
    await db
      .table('client_contracts')
      .where({ client_contract_id: input.clientContractId })
      .update({ billing_profile_id: input.billingProfileId, updated_at: knex.fn.now() });
  });
  return { success: true };
});

/**
 * Assign a contract line to a billing profile — step 2, the most specific
 * contract-side step. A line assignment overrides its contract's.
 */
export const assignContractLineBillingProfile = withAuth(async (
  user,
  { tenant },
  input: { contractLineId: string; billingProfileId: string | null },
): Promise<{ success: true }> => {
  await assertBillingUpdate(user);
  const { knex } = await createTenantKnex();
  await withTransaction(knex, async (trx: Knex.Transaction) => {
    const db = tenantDb(trx, tenant);
    if (input.billingProfileId) {
      const query = db.table('contract_lines');
      db.tenantJoin(query, 'client_contracts', 'client_contracts.contract_id', 'contract_lines.contract_id');
      const owner = await query
        .where({ 'contract_lines.contract_line_id': input.contractLineId })
        .first('client_contracts.client_id');
      const profile = await db
        .table('client_billing_profiles')
        .where({ billing_profile_id: input.billingProfileId })
        .first('client_id');
      if (!owner || !profile || owner.client_id !== profile.client_id) {
        throw new Error('That billing profile belongs to a different client.');
      }
    }
    await db
      .table('contract_lines')
      .where({ contract_line_id: input.contractLineId })
      .update({ billing_profile_id: input.billingProfileId, updated_at: knex.fn.now() });
  });
  return { success: true };
});

/**
 * A project's billing profile — the work-item step of the chain for time logged
 * against project tasks, and for project milestone/deposit charges, which have
 * no contract line behind them at all (F048).
 */
export const getProjectBillingProfileId = withAuth(async (
  user,
  { tenant },
  projectId: string,
): Promise<{ clientId: string | null; billingProfileId: string | null }> => {
  await assertBillingRead(user);
  const { knex } = await createTenantKnex();
  const row = await tenantDb(knex, tenant)
    .table('projects')
    .where({ project_id: projectId })
    .first('client_id', 'billing_profile_id');
  return {
    clientId: (row?.client_id as string | null) ?? null,
    billingProfileId: (row?.billing_profile_id as string | null) ?? null,
  };
});

export const assignProjectBillingProfile = withAuth(async (
  user,
  { tenant },
  input: { projectId: string; billingProfileId: string | null },
): Promise<{ success: true }> => {
  await assertBillingUpdate(user);
  const { knex } = await createTenantKnex();
  await withTransaction(knex, async (trx: Knex.Transaction) => {
    const db = tenantDb(trx, tenant);
    if (input.billingProfileId) {
      const project = await db
        .table('projects')
        .where({ project_id: input.projectId })
        .first('client_id');
      const profile = await db
        .table('client_billing_profiles')
        .where({ billing_profile_id: input.billingProfileId })
        .first('client_id');
      if (!project || !profile || project.client_id !== profile.client_id) {
        throw new Error('That billing profile belongs to a different client.');
      }
    }
    await db
      .table('projects')
      .where({ project_id: input.projectId })
      .update({ billing_profile_id: input.billingProfileId, updated_at: knex.fn.now() });
  });
  return { success: true };
});
