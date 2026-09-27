'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';

export interface TenantUnitSelection { code: string; label: string }

export const listTenantUnitsOfMeasure = withAuth(async (user, { tenant }): Promise<TenantUnitSelection[]> => {
  if (!await hasPermission(user, 'service', 'read')) throw new Error('Permission denied: cannot list units of measure');
  const { knex } = await createTenantKnex();
  const rows = await tenantDb(knex, tenant).table('tenant_units_of_measure').select('code', 'label').orderBy('label');
  return rows.map((row) => ({ code: row.code, label: row.label }));
});

export const registerTenantUnitOfMeasure = withAuth(async (user, { tenant }, label: string): Promise<TenantUnitSelection> => {
  if (!await hasPermission(user, 'service', 'create')) throw new Error('Permission denied: cannot add units of measure');
  const normalized = label.trim();
  if (!normalized || normalized.length > 128) throw new Error('Unit label must contain 1 to 128 characters');
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant).table('tenant_units_of_measure');
  const existing = await db.whereRaw('lower(trim(label)) = lower(trim(?))', [normalized]).first('code', 'label');
  if (existing) return { code: existing.code, label: existing.label };
  await db.insert({ tenant, code: 'C62', label: normalized, kind: 'other' }).onConflict(['tenant', 'label']).ignore();
  const created = await db.whereRaw('lower(trim(label)) = lower(trim(?))', [normalized]).first('code', 'label');
  if (!created) throw new Error('Unit was not registered');
  return { code: created.code, label: created.label };
});
