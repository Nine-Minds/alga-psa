import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  DEFAULT_UNIT_CODE,
  defaultUnitForKind,
  isUnitOfMeasureCode,
  knownUnitCodeForLabel,
  labelForUnitCode,
  type UnitDefaultKind,
} from './unitOfMeasure';

/**
 * Tenant custom units of measure (`tenant_units_of_measure`, distributed by
 * tenant). Every custom label maps to a Rec 20 code, C62 by default (D5).
 * This is the one place that reads/writes the table.
 */
export interface TenantUnitSelection { code: string; label: string }

const MAX_LABEL_LENGTH = 128;

function units(knex: Knex | Knex.Transaction, tenant: string) {
  // Fresh builder per query: knex builders are mutable and must not be reused.
  return tenantDb(knex, tenant).table('tenant_units_of_measure');
}

export async function listTenantUnits(knex: Knex | Knex.Transaction, tenant: string): Promise<TenantUnitSelection[]> {
  const rows = await units(knex, tenant).select('code', 'label').orderBy('label');
  return rows.map((row: TenantUnitSelection) => ({ code: row.code, label: row.label }));
}

async function findTenantUnit(knex: Knex | Knex.Transaction, tenant: string, label: string): Promise<TenantUnitSelection | undefined> {
  return units(knex, tenant).whereRaw('lower(trim(label)) = lower(trim(?))', [label]).first('code', 'label');
}

/** Resolve a quote snapshot label against tenant units before system labels. */
export async function resolveTenantUnitCodeForLabel(
  knex: Knex | Knex.Transaction,
  tenant: string,
  label: string | null | undefined,
  explicitCode?: string | null,
): Promise<string | null> {
  const normalized = label?.trim();
  if (!normalized) return explicitCode ?? null;
  const custom = await findTenantUnit(knex, tenant, normalized);
  if (custom) return custom.code;
  const known = knownUnitCodeForLabel(normalized);
  if (known) return known;
  return resolveUnitCodeForWrite(knex, tenant, normalized, explicitCode);
}

/** Register (idempotently, case-insensitively) a custom label; returns the stored unit. */
export async function registerTenantUnit(
  knex: Knex | Knex.Transaction,
  tenant: string,
  label: string,
  code: string = DEFAULT_UNIT_CODE,
): Promise<TenantUnitSelection> {
  const normalized = label.trim();
  if (!normalized || normalized.length > MAX_LABEL_LENGTH) {
    throw new Error(`Unit label must contain 1 to ${MAX_LABEL_LENGTH} characters`);
  }
  if (!isUnitOfMeasureCode(code)) throw new Error(`Unknown unit of measure code: ${code}`);
  const existing = await findTenantUnit(knex, tenant, normalized);
  if (existing) return existing;
  await units(knex, tenant)
    .insert({ tenant, code, label: normalized, kind: 'other' })
    .onConflict(['tenant', 'label'])
    .ignore();
  const created = await findTenantUnit(knex, tenant, normalized);
  if (!created) throw new Error('Unit was not registered');
  return created;
}

/**
 * The code to persist for a catalog write. Explicit code wins. A known label
 * maps to its vocabulary code; an unknown label is registered as a tenant
 * custom unit (so the picker shows it) and takes that unit's code. Empty → null.
 */
export async function resolveUnitCodeForWrite(
  knex: Knex | Knex.Transaction,
  tenant: string,
  label: string | null | undefined,
  explicitCode?: string | null,
): Promise<string | null> {
  const normalized = label?.trim();
  if (!normalized) return explicitCode ?? null;
  const known = knownUnitCodeForLabel(normalized);
  if (known) return explicitCode ?? known;
  const registered = await registerTenantUnit(knex, tenant, normalized, explicitCode ?? DEFAULT_UNIT_CODE);
  return explicitCode ?? registered.code;
}

export interface CatalogUnitInput {
  unit_of_measure?: string | null;
  unit_code?: string | null;
  item_kind?: string | null;
  billing_method?: string | null;
}

/** Which D1–D3 default applies to a catalog item. */
export function catalogUnitDefaultKind(input: Pick<CatalogUnitInput, 'item_kind' | 'billing_method'>): UnitDefaultKind {
  if (input.item_kind === 'product') return 'product';
  if (input.billing_method === 'hourly' || input.billing_method === 'usage') return input.billing_method;
  return 'fixed';
}

/**
 * The `{ unit_of_measure, unit_code }` pair to persist when creating a catalog
 * item (service or product). Applies D1–D3 defaults when neither is supplied;
 * a usage service with no unit stays null (callers validate it as required).
 */
export async function resolveCatalogUnitForCreate(
  knex: Knex | Knex.Transaction,
  tenant: string,
  input: CatalogUnitInput,
): Promise<{ unit_of_measure: string | null; unit_code: string | null }> {
  const label = input.unit_of_measure?.trim() || null;
  const explicitCode = input.unit_code || null;
  if (label) return { unit_of_measure: label, unit_code: await resolveUnitCodeForWrite(knex, tenant, label, explicitCode) };
  if (explicitCode) return { unit_of_measure: labelForUnitCode(explicitCode), unit_code: explicitCode };
  const fallback = defaultUnitForKind(catalogUnitDefaultKind(input));
  return { unit_of_measure: fallback?.label ?? null, unit_code: fallback?.code ?? null };
}

/**
 * The unit columns to write on a catalog update, or `{}` when the update does
 * not touch the unit. A label change without a code re-derives the code so the
 * two columns never drift apart.
 */
export async function resolveCatalogUnitForUpdate(
  knex: Knex | Knex.Transaction,
  tenant: string,
  input: Pick<CatalogUnitInput, 'unit_of_measure' | 'unit_code'>,
): Promise<{ unit_of_measure?: string; unit_code?: string | null }> {
  if (input.unit_of_measure === undefined && input.unit_code === undefined) return {};
  const label = input.unit_of_measure?.trim() || null;
  if (label) return { unit_of_measure: label, unit_code: await resolveUnitCodeForWrite(knex, tenant, label, input.unit_code) };
  if (input.unit_code) return { unit_of_measure: labelForUnitCode(input.unit_code), unit_code: input.unit_code };
  return {};
}
