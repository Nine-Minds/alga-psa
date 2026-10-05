'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  listTenantUnits,
  registerTenantUnit,
  type TenantUnitSelection,
} from '@alga-psa/shared/billingClients/tenantUnitsOfMeasure';

export const listTenantUnitsOfMeasure = withAuth(async (user, { tenant }): Promise<TenantUnitSelection[]> => {
  if (!await hasPermission(user, 'service', 'read')) throw new Error('Permission denied: cannot list units of measure');
  const { knex } = await createTenantKnex();
  return listTenantUnits(knex, tenant);
});

export const registerTenantUnitOfMeasure = withAuth(async (user, { tenant }, label: string): Promise<TenantUnitSelection> => {
  if (!await hasPermission(user, 'service', 'create')) throw new Error('Permission denied: cannot add units of measure');
  const { knex } = await createTenantKnex();
  return registerTenantUnit(knex, tenant, label);
});
