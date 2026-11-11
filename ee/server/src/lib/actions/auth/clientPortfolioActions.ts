'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { tenantDb } from '@alga-psa/db';
import { TIER_FEATURES } from '@alga-psa/types';
import { createTenantKnex } from '@/lib/db';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import {
  readUserClientPortfolio,
  setUserClientPortfolio,
} from '@alga-psa/authorization/portfolios/service';

/**
 * Thin actions over the stored client portfolio (`user_client_portfolios`, packages/authorization). They add
 * only what the service leaves to its caller: the Pro tier gate, the permission check (the same
 * `system_settings` permission the bundle actions require), and client names for display.
 */

export interface UserClientPortfolioEntry {
  clientId: string;
  clientName: string;
}

async function assertPortfolioPermission(user: unknown, action: 'read' | 'write'): Promise<void> {
  const allowed = await hasPermission(user as any, 'system_settings', action === 'write' ? 'update' : 'read');
  if (!allowed) {
    throw new Error('You do not have permission to manage client portfolios.');
  }
}

async function loadClientNames(
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
  tenant: string,
  clientIds: readonly string[]
): Promise<UserClientPortfolioEntry[]> {
  if (clientIds.length === 0) return [];
  const rows = await tenantDb(knex, tenant)
    .table('clients')
    .whereIn('client_id', [...clientIds])
    .orderBy('client_name', 'asc')
    .select<Array<{ client_id: string; client_name: string }>>('client_id', 'client_name');
  return rows.map((row) => ({ clientId: row.client_id, clientName: row.client_name }));
}

async function assertPortfolioUser(
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
  tenant: string,
  userId: string
): Promise<void> {
  const row = await tenantDb(knex, tenant)
    .table('users')
    .where({ user_id: userId })
    .first<{ user_type: string | null }>('user_type');
  if (!row) {
    throw new Error('User not found in tenant scope.');
  }
  if (row.user_type === 'client') {
    throw new Error('A client portfolio applies to MSP users only.');
  }
}

export const getUserClientPortfolioAction = withAuth(
  async (user, { tenant }, input: { userId: string }): Promise<UserClientPortfolioEntry[]> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES);
    await assertPortfolioPermission(user, 'read');

    const { knex } = await createTenantKnex();
    await assertPortfolioUser(knex, tenant, input.userId);
    return loadClientNames(knex, tenant, await readUserClientPortfolio(knex, { tenant, userId: input.userId }));
  }
);

export const setUserClientPortfolioAction = withAuth(
  async (
    user,
    { tenant },
    input: { userId: string; clientIds: string[] }
  ): Promise<UserClientPortfolioEntry[]> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES);
    await assertPortfolioPermission(user, 'write');

    const { knex } = await createTenantKnex();
    await assertPortfolioUser(knex, tenant, input.userId);
    const stored = await setUserClientPortfolio(knex, { tenant, userId: input.userId, clientIds: input.clientIds });
    return loadClientNames(knex, tenant, stored);
  }
);

/** Display names for client ids the editor holds, e.g. one just chosen in the client picker. */
export const getPortfolioClientNamesAction = withAuth(
  async (user, { tenant }, input: { clientIds: string[] }): Promise<UserClientPortfolioEntry[]> => {
    await assertTierAccess(TIER_FEATURES.ADVANCED_AUTHORIZATION_BUNDLES);
    await assertPortfolioPermission(user, 'read');

    const { knex } = await createTenantKnex();
    return loadClientNames(knex, tenant, input.clientIds);
  }
);
