import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IClientTaxSettings, ITaxRate } from '@alga-psa/types';
import { ensureClientDefaultBillingProfile } from './billingProfiles';

/**
 * Tenant-wide default tax rate assignment (card alga-2026-0002527).
 *
 * One nullable `tenant_settings.default_tax_rate_id` names an existing
 * regional rate. The region is derived from the selected rate — there is no
 * second, independently editable default region. Nothing here hard-codes a
 * jurisdiction or percentage; the administrator selects a rate they created
 * through the existing region/rate editor.
 *
 * Semantics (see docs/plans/2026-09-21-default-tax-rate/PRD.md):
 *  - configured: must belong to the tenant, have an active region and rate,
 *    and apply on the assignment day (`start_date <= day < end_date`, NULL end
 *    open). An invalid configured default throws an actionable error; it never
 *    falls back to an unrelated rate.
 *  - unset for clients: legacy fallback to the oldest eligible active rate
 *    (deterministic id tie-break). No active rate is still a setup error.
 *  - unset for catalog: NULL (billing reads NULL as non-taxable).
 */

export const TENANT_DEFAULT_TAX_RATE_COLUMN = 'default_tax_rate_id';

export type DefaultTaxRateSource = 'configured' | 'legacy-oldest-active';

export interface ResolvedDefaultTaxRate {
  taxRateId: string;
  source: DefaultTaxRateSource;
  rate: ITaxRate;
}

export class InvalidDefaultTaxRateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDefaultTaxRateError';
  }
}

export class NoActiveTaxRateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoActiveTaxRateError';
  }
}

export class InvalidTaxRateSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTaxRateSelectionError';
  }
}

/** `YYYY-MM-DD` in UTC, the assignment day used for rate date-range checks. */
export function currentAssignmentDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Normalize a `date`/timestamp value to a `YYYY-MM-DD` string.
 *
 * node-postgres parses `date` columns into JS `Date` objects at local midnight,
 * so `String(value)` is not an ISO date. Use the local components (matching the
 * driver's parse) rather than `toISOString()` so a negative/positive offset
 * cannot shift the assignment day by one.
 */
function toIsoDate(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value ?? '').slice(0, 10);
}

function isEligibleOnDate(rate: Pick<ITaxRate, 'start_date' | 'end_date'>, date: string): boolean {
  const start = toIsoDate(rate.start_date);
  if (start > date) return false;
  if (rate.end_date) {
    const end = toIsoDate(rate.end_date);
    if (end <= date) return false;
  }
  return true;
}

export async function readConfiguredDefaultTaxRateId(
  conn: Knex | Knex.Transaction,
  tenant: string
): Promise<string | null> {
  const row = await tenantDb(conn, tenant)
    .table('tenant_settings')
    .where({ tenant })
    .select(TENANT_DEFAULT_TAX_RATE_COLUMN)
    .first();
  const value = (row as Record<string, unknown> | undefined)?.[TENANT_DEFAULT_TAX_RATE_COLUMN];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Evaluate whether a rate (as it currently exists, or with proposed mutations)
 * would still be a usable tenant default: active rate, active region, and
 * applicable on the assignment day. Used by lifecycle guards so a configured
 * default cannot be silently invalidated.
 */
export async function isTaxRateUsableAsDefault(
  conn: Knex | Knex.Transaction,
  tenant: string,
  rate: Pick<ITaxRate, 'is_active' | 'region_code' | 'start_date' | 'end_date'>,
  date: string = currentAssignmentDate()
): Promise<boolean> {
  if (rate.is_active === false) return false;
  if (!isEligibleOnDate(rate, date)) return false;
  const region = await tenantDb(conn, tenant)
    .table('tax_regions')
    .where({ region_code: rate.region_code, is_active: true })
    .first('region_code');
  return Boolean(region);
}

async function loadEligibleRateById(
  conn: Knex | Knex.Transaction,
  tenant: string,
  taxRateId: string,
  date: string,
  options: { forUpdate?: boolean } = {}
): Promise<ITaxRate | null> {
  const db = tenantDb(conn, tenant);
  const query = db
    .table<ITaxRate>('tax_rates')
    .where({ tax_rate_id: taxRateId, is_active: true });
  if (options.forUpdate) {
    // Lock order for default assignments: tax rate row, then settings/tenant
    // row. The rate lifecycle writers lock the rate row first too, so a
    // concurrent deactivation cannot slip between this validation and the save.
    query.forUpdate();
  }
  const rate = await query.first();
  if (!rate) return null;
  if (!isEligibleOnDate(rate, date)) return null;

  const region = await db
    .table('tax_regions')
    .where({ region_code: rate.region_code, is_active: true })
    .first('region_code');
  if (!region) return null;

  return rate;
}

/**
 * The configured default, or null when none is set. Throws when a default is
 * configured but no longer usable — callers must surface that, not silently
 * substitute another rate.
 */
export async function resolveConfiguredDefaultTaxRate(
  conn: Knex | Knex.Transaction,
  tenant: string,
  date: string = currentAssignmentDate()
): Promise<ITaxRate | null> {
  const configuredId = await readConfiguredDefaultTaxRateId(conn, tenant);
  if (!configuredId) return null;

  const rate = await loadEligibleRateById(conn, tenant, configuredId, date);
  if (!rate) {
    throw new InvalidDefaultTaxRateError(
      'The configured default tax rate is no longer valid: it is missing, inactive, its region is inactive, or it does not apply on the assignment date. Select a different default tax rate in Billing Settings.'
    );
  }
  return rate;
}

async function loadLegacyOldestActiveRate(
  conn: Knex | Knex.Transaction,
  tenant: string,
  date: string
): Promise<ITaxRate | null> {
  const db = tenantDb(conn, tenant);
  const rows = await db
    .table<ITaxRate>('tax_rates')
    .where({ is_active: true })
    .where('start_date', '<=', date)
    .andWhere(function () {
      this.whereNull('end_date').orWhere('end_date', '>', date);
    })
    .orderBy([
      { column: 'created_at', order: 'asc' },
      { column: 'tax_rate_id', order: 'asc' },
    ]);

  for (const row of rows) {
    const region = await db
      .table('tax_regions')
      .where({ region_code: row.region_code, is_active: true })
      .first('region_code');
    if (region) return row;
  }
  return null;
}

/**
 * Client-side resolution: configured default wins; otherwise the legacy
 * oldest-eligible active rate; otherwise a setup error.
 */
export async function resolveClientDefaultTaxRate(
  conn: Knex | Knex.Transaction,
  tenant: string,
  date: string = currentAssignmentDate()
): Promise<ResolvedDefaultTaxRate> {
  const configured = await resolveConfiguredDefaultTaxRate(conn, tenant, date);
  if (configured) {
    return { taxRateId: configured.tax_rate_id, source: 'configured', rate: configured };
  }

  const legacy = await loadLegacyOldestActiveRate(conn, tenant, date);
  if (!legacy) {
    throw new NoActiveTaxRateError(
      'No active tax rates found in the system to assign as default.'
    );
  }
  return { taxRateId: legacy.tax_rate_id, source: 'legacy-oldest-active', rate: legacy };
}

/**
 * Catalog-side resolution: the configured default id, or null when unset.
 * Explicit invalid configuration throws via resolveConfiguredDefaultTaxRate.
 */
export async function resolveCatalogDefaultTaxRateId(
  conn: Knex | Knex.Transaction,
  tenant: string,
  date: string = currentAssignmentDate()
): Promise<string | null> {
  const configured = await resolveConfiguredDefaultTaxRate(conn, tenant, date);
  return configured ? configured.tax_rate_id : null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Catalog create contract:
 *  - `undefined` (omitted) inherits the tenant default (or NULL when unset);
 *  - `null` means intentionally non-taxable and passes through untouched;
 *  - a UUID is an explicit override validated to exist in the authenticated
 *    tenant. Empty-string/whitespace/invalid ids are rejected rather than
 *    silently treated as NULL.
 */
export async function resolveCatalogTaxRateIdForCreate(
  conn: Knex | Knex.Transaction,
  tenant: string,
  taxRateId: string | null | undefined,
  date: string = currentAssignmentDate()
): Promise<string | null> {
  if (taxRateId === undefined) {
    return resolveCatalogDefaultTaxRateId(conn, tenant, date);
  }
  if (taxRateId === null) {
    return null;
  }
  if (typeof taxRateId !== 'string') {
    throw new InvalidTaxRateSelectionError('Invalid tax rate selection.');
  }
  const trimmed = taxRateId.trim();
  if (!trimmed) {
    throw new InvalidTaxRateSelectionError(
      'Invalid tax rate selection: an empty tax rate id is not allowed. Omit the field to inherit the default or send null for non-taxable.'
    );
  }
  if (!UUID_PATTERN.test(trimmed)) {
    throw new InvalidTaxRateSelectionError(`Invalid tax rate id '${trimmed}'.`);
  }
  const exists = await tenantDb(conn, tenant)
    .table('tax_rates')
    .where({ tax_rate_id: trimmed })
    .first('tax_rate_id');
  if (!exists) {
    throw new InvalidTaxRateSelectionError(
      'The selected tax rate does not exist in this tenant.'
    );
  }
  return trimmed;
}

/**
 * Validate a candidate default for the settings writer. Returns the rate and
 * throws an actionable InvalidDefaultTaxRateError when the candidate cannot be
 * a default (foreign tenant, missing, inactive, inactive region, or not
 * applicable on the assignment day).
 */
export async function assertValidDefaultTaxRateCandidate(
  conn: Knex | Knex.Transaction,
  tenant: string,
  taxRateId: string,
  options: { date?: string; forUpdate?: boolean } = {}
): Promise<ITaxRate> {
  const date = options.date ?? currentAssignmentDate();
  const rate = await loadEligibleRateById(conn, tenant, taxRateId, date, {
    forUpdate: options.forUpdate,
  });
  if (!rate) {
    throw new InvalidDefaultTaxRateError(
      'The selected tax rate cannot be used as the tenant default: it must belong to this tenant and have an active region and rate that applies today.'
    );
  }
  return rate;
}

export interface InitializeClientDefaultTaxOptions {
  billingProfileId?: string;
  date?: string;
}

/**
 * Idempotent, transactional client tax initialization.
 *
 * - Serializes on the client row (`SELECT ... FOR UPDATE`) so repeat/concurrent
 *   calls cannot create duplicate defaults.
 * - Provisions the profile-keyed `client_tax_settings` row without overwriting
 *   reverse-charge or tax-source overrides on existing rows.
 * - Ensures exactly one client-wide default association (`is_default: true`,
 *   `location_id: null`), reusing an existing NULL-location association for the
 *   resolved rate where possible. An existing explicit default is preserved.
 * - Never creates, rounds, or duplicates rate-global tax components.
 */
export async function initializeClientDefaultTax(
  conn: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  options: InitializeClientDefaultTaxOptions = {}
): Promise<IClientTaxSettings> {
  const db = tenantDb(conn, tenant);

  const client = await db
    .table('clients')
    .where({ client_id: clientId })
    .forUpdate()
    .first('client_id');
  if (!client) {
    throw new Error(`Client ${clientId} not found in tenant ${tenant}.`);
  }

  const billingProfileId =
    options.billingProfileId ??
    (await ensureClientDefaultBillingProfile(conn, tenant, clientId));

  const date = options.date ?? currentAssignmentDate();
  const resolved = await resolveClientDefaultTaxRate(conn, tenant, date);

  const existingSettings = await db
    .table<IClientTaxSettings>('client_tax_settings')
    .where({ client_id: clientId, billing_profile_id: billingProfileId })
    .first();
  if (!existingSettings) {
    await db.table<IClientTaxSettings>('client_tax_settings').insert({
      client_id: clientId,
      billing_profile_id: billingProfileId,
      is_reverse_charge_applicable: false,
      tenant,
    });
  }

  const existingDefault = await db
    .table('client_tax_rates')
    .where({ client_id: clientId, is_default: true })
    .whereNull('location_id')
    .first();

  if (!existingDefault) {
    const existingNullLocation = await db
      .table('client_tax_rates')
      .where({ client_id: clientId })
      .whereNull('location_id')
      .orderBy('created_at', 'asc')
      .first();

    if (existingNullLocation && existingNullLocation.tax_rate_id === resolved.taxRateId) {
      await db
        .table('client_tax_rates')
        .where({
          client_tax_rates_id: existingNullLocation.client_tax_rates_id,
          tenant,
        })
        .update({ is_default: true, updated_at: conn.fn.now() });
    } else {
      const conflictingLocationAssociation = await db
        .table('client_tax_rates')
        .where({ client_id: clientId, tax_rate_id: resolved.taxRateId })
        .whereNotNull('location_id')
        .first();
      if (conflictingLocationAssociation) {
        throw new InvalidDefaultTaxRateError(
          `Cannot set a client-wide default tax rate for client ${clientId}: the resolved rate already has a location-specific association. Review the client's tax associations before retrying.`
        );
      }

      await db.table('client_tax_rates').insert({
        client_id: clientId,
        tax_rate_id: resolved.taxRateId,
        is_default: true,
        location_id: null,
        tenant,
      });
    }
  }

  const settings = await db
    .table<IClientTaxSettings>('client_tax_settings')
    .where({ client_id: clientId, billing_profile_id: billingProfileId })
    .first();

  return settings as IClientTaxSettings;
}

/**
 * Repair-oriented alias: ensure the client has a usable client-wide default.
 * Shares the same idempotent, transactional implementation as creation.
 */
export async function ensureClientDefaultTaxSettings(
  conn: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  billingProfileId?: string
): Promise<IClientTaxSettings> {
  return initializeClientDefaultTax(conn, tenant, clientId, { billingProfileId });
}
