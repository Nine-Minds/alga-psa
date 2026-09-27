import type { Knex } from 'knex';
import { knownUnitCodeForLabel } from '@alga-psa/shared/billingClients/unitOfMeasure';
import { tenantDb } from '@alga-psa/db';

export async function resolveUnitCodeForWrite(
  knex: Knex,
  tenant: string,
  label: string | null | undefined,
  explicitCode?: string | null,
): Promise<string> {
  const normalized = label?.trim();
  if (!normalized) return explicitCode ?? 'C62';
  if (explicitCode) {
    if (knownUnitCodeForLabel(normalized)) return explicitCode;
    const units = tenantDb(knex, tenant).table('tenant_units_of_measure');
    const existing = await units.whereRaw('lower(trim(label)) = lower(trim(?))', [normalized]).first('code');
    if (!existing) await units.insert({ tenant, code: explicitCode, label: normalized, kind: 'other' }).onConflict(['tenant', 'label']).ignore();
    return explicitCode;
  }
  const known = knownUnitCodeForLabel(normalized);
  if (known) return known;
  const units = tenantDb(knex, tenant).table('tenant_units_of_measure');
  const existing = await units.whereRaw('lower(trim(label)) = lower(trim(?))', [normalized]).first('code');
  if (existing) return existing.code;
  await units.insert({ tenant, code: 'C62', label: normalized, kind: 'other' }).onConflict(['tenant', 'label']).ignore();
  return 'C62';
}
