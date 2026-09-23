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
 *
 * ## Lock order (single documented policy)
 *
 * Writers that take more than one of these row locks always acquire them in
 * this order:
 *
 *   clients → tax_rates → tax_regions → tenant_settings
 *
 * - The per-client initializer locks `clients` first, then the resolved rate
 *   and its region. Nothing else ever takes a `clients` lock.
 * - Default save and rate lifecycle mutations lock `tax_rates` then
 *   `tax_regions`, then upsert `tenant_settings`.
 * - Region deactivation locks only `tax_regions` and re-reads the configured
 *   default without taking a rate lock, so it cannot deadlock against a
 *   settings save that holds the rate lock and is waiting for the region lock.
 *
 * Mutation paths call the `{ lock: true }` resolver so the rate/region they
 * validate cannot be changed by a concurrent lifecycle mutation before they
 * persist the assignment. Plain readers use the unlocked path.
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

export interface DefaultTaxRateResolveOptions {
  /**
   * Take `tax_rates`/`tax_regions` row locks in the documented order before
   * validating, and re-read under lock. Use on every path that is about to
   * persist an assignment or a setting.
   */
  lock?: boolean;
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

/** Lock `clients` (lock order step 1). Returns false when the row is missing. */
export async function lockClientRow(
  conn: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<boolean> {
  const row = await tenantDb(conn, tenant)
    .table('clients')
    .where({ client_id: clientId })
    .forUpdate()
    .first('client_id');
  return Boolean(row);
}

/** Lock a `tax_rates` row (lock order step 2). Returns the row or null. */
export async function lockTaxRateRow(
  conn: Knex | Knex.Transaction,
  tenant: string,
  taxRateId: string
): Promise<ITaxRate | null> {
  const row = await tenantDb(conn, tenant)
    .table<ITaxRate>('tax_rates')
    .where({ tax_rate_id: taxRateId })
    .forUpdate()
    .first();
  return row ?? null;
}

/** Lock a `tax_regions` row (lock order step 3). Returns false when missing. */
export async function lockTaxRegionRow(
  conn: Knex | Knex.Transaction,
  tenant: string,
  regionCode: string
): Promise<boolean> {
  const row = await tenantDb(conn, tenant)
    .table('tax_regions')
    .where({ region_code: regionCode })
    .forUpdate()
    .first('region_code');
  return Boolean(row);
}

/**
 * Lock the tenant settings row (lock order step 4). Returns false when the row
 * does not exist yet (an upsert will create it). Callers that must not race a
 * concurrent settings change lock this and re-read the default id.
 */
export async function lockTenantSettingsRow(
  conn: Knex | Knex.Transaction,
  tenant: string
): Promise<boolean> {
  const row = await tenantDb(conn, tenant)
    .table('tenant_settings')
    .where({ tenant })
    .forUpdate()
    .first('tenant');
  return Boolean(row);
}

async function isRateActiveAndRegionActive(
  conn: Knex | Knex.Transaction,
  tenant: string,
  rate: Pick<ITaxRate, 'is_active' | 'region_code'>
): Promise<boolean> {
  if (rate.is_active === false) return false;
  const region = await tenantDb(conn, tenant)
    .table('tax_regions')
    .where({ region_code: rate.region_code, is_active: true })
    .first('region_code');
  return Boolean(region);
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
  if (!(await isRateActiveAndRegionActive(conn, tenant, rate))) return false;
  return isEligibleOnDate(rate, date);
}

async function loadEligibleRateById(
  conn: Knex | Knex.Transaction,
  tenant: string,
  taxRateId: string,
  date: string
): Promise<ITaxRate | null> {
  const db = tenantDb(conn, tenant);
  const rate = await db
    .table<ITaxRate>('tax_rates')
    .where({ tax_rate_id: taxRateId, is_active: true })
    .first();
  if (!rate) return null;
  if (!isEligibleOnDate(rate, date)) return null;
  if (!(await isRateActiveAndRegionActive(conn, tenant, rate))) return null;
  return rate;
}

/**
 * Locked resolver: lock `tax_rates`, then `tax_regions`, then re-read the
 * configured id and validate under the locks. Throws when the configured
 * default is missing/invalid so a mutation never persists a stale assignment.
 */
async function resolveConfiguredDefaultTaxRateLocked(
  conn: Knex | Knex.Transaction,
  tenant: string,
  date: string
): Promise<ITaxRate | null> {
  const configuredId = await readConfiguredDefaultTaxRateId(conn, tenant);
  if (!configuredId) return null;

  const rate = await lockTaxRateRow(conn, tenant, configuredId);
  if (!rate) {
    throw new InvalidDefaultTaxRateError(
      'The configured default tax rate is no longer valid: it is missing, inactive, its region is inactive, or it does not apply on the assignment date. Select a different default tax rate in Billing Settings.'
    );
  }
  await lockTaxRegionRow(conn, tenant, rate.region_code);
  if (!(await isTaxRateUsableAsDefault(conn, tenant, rate, date))) {
    throw new InvalidDefaultTaxRateError(
      'The configured default tax rate is no longer valid: it is missing, inactive, its region is inactive, or it does not apply on the assignment date. Select a different default tax rate in Billing Settings.'
    );
  }
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
  date: string = currentAssignmentDate(),
  options: DefaultTaxRateResolveOptions = {}
): Promise<ITaxRate | null> {
  if (options.lock) {
    return resolveConfiguredDefaultTaxRateLocked(conn, tenant, date);
  }

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
    if (await isRateActiveAndRegionActive(conn, tenant, row)) return row;
  }
  return null;
}

async function loadLegacyOldestActiveRateLocked(
  conn: Knex | Knex.Transaction,
  tenant: string,
  date: string
): Promise<ITaxRate | null> {
  const candidate = await loadLegacyOldestActiveRate(conn, tenant, date);
  if (!candidate) return null;
  const rate = await lockTaxRateRow(conn, tenant, candidate.tax_rate_id);
  if (!rate) return null;
  await lockTaxRegionRow(conn, tenant, rate.region_code);
  return (await isTaxRateUsableAsDefault(conn, tenant, rate, date)) ? rate : null;
}

/**
 * Client-side resolution: configured default wins; otherwise the legacy
 * oldest-eligible active rate; otherwise a setup error.
 */
export async function resolveClientDefaultTaxRate(
  conn: Knex | Knex.Transaction,
  tenant: string,
  date: string = currentAssignmentDate(),
  options: DefaultTaxRateResolveOptions = {}
): Promise<ResolvedDefaultTaxRate> {
  const configured = await resolveConfiguredDefaultTaxRate(conn, tenant, date, options);
  if (configured) {
    return { taxRateId: configured.tax_rate_id, source: 'configured', rate: configured };
  }

  const legacy = options.lock
    ? await loadLegacyOldestActiveRateLocked(conn, tenant, date)
    : await loadLegacyOldestActiveRate(conn, tenant, date);
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
  date: string = currentAssignmentDate(),
  options: DefaultTaxRateResolveOptions = {}
): Promise<string | null> {
  const configured = await resolveConfiguredDefaultTaxRate(conn, tenant, date, options);
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
 *
 * Pass `{ lock: true }` when the result is about to be persisted in the same
 * transaction so a concurrent lifecycle mutation cannot invalidate it first.
 */
export async function resolveCatalogTaxRateIdForCreate(
  conn: Knex | Knex.Transaction,
  tenant: string,
  taxRateId: string | null | undefined,
  date: string = currentAssignmentDate(),
  options: DefaultTaxRateResolveOptions = {}
): Promise<string | null> {
  if (taxRateId === undefined) {
    return resolveCatalogDefaultTaxRateId(conn, tenant, date, options);
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
 *
 * With `forUpdate` the rate and its region are locked in the documented order
 * and re-read under lock, so a concurrent region/rate mutation blocks until the
 * save commits and a save can never persist a region that was just deactivated.
 */
export async function assertValidDefaultTaxRateCandidate(
  conn: Knex | Knex.Transaction,
  tenant: string,
  taxRateId: string,
  options: { date?: string; forUpdate?: boolean } = {}
): Promise<ITaxRate> {
  const date = options.date ?? currentAssignmentDate();

  if (options.forUpdate) {
    const rate = await lockTaxRateRow(conn, tenant, taxRateId);
    if (rate) {
      await lockTaxRegionRow(conn, tenant, rate.region_code);
    }
    if (!rate || !(await isTaxRateUsableAsDefault(conn, tenant, rate, date))) {
      throw new InvalidDefaultTaxRateError(
        'The selected tax rate cannot be used as the tenant default: it must belong to this tenant and have an active region and rate that applies today.'
      );
    }
    return rate;
  }

  const rate = await loadEligibleRateById(conn, tenant, taxRateId, date);
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
 * - Locks the client row first (lock order step 1) so repeat/concurrent calls
 *   cannot create duplicate settings/defaults.
 * - Preserves a client that already has a client-wide default: it returns
 *   before resolving the tenant default, so an expired tenant default cannot
 *   break a client whose explicit default is still valid.
 * - Provisions the profile-keyed `client_tax_settings` row without overwriting
 *   reverse-charge or tax-source overrides on existing rows.
 * - Ensures exactly one client-wide default association (`is_default: true`,
 *   `location_id: null`) by looking the association up by the resolved rate id
 *   (not by picking the oldest association). An existing explicit default is
 *   preserved; a location-specific association for the same rate is an error.
 * - Never creates, rounds, or duplicates rate-global tax components.
 */
export async function initializeClientDefaultTax(
  conn: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  options: InitializeClientDefaultTaxOptions = {}
): Promise<IClientTaxSettings> {
  const db = tenantDb(conn, tenant);

  const clientLocked = await lockClientRow(conn, tenant, clientId);
  if (!clientLocked) {
    throw new Error(`Client ${clientId} not found in tenant ${tenant}.`);
  }

  const billingProfileId =
    options.billingProfileId ??
    (await ensureClientDefaultBillingProfile(conn, tenant, clientId));

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

  const readSettings = () =>
    db
      .table<IClientTaxSettings>('client_tax_settings')
      .where({ client_id: clientId, billing_profile_id: billingProfileId })
      .first();

  // An explicit client-wide default is authoritative: do not resolve (and
  // therefore do not fail on) the tenant default when one already exists.
  const existingDefault = await db
    .table('client_tax_rates')
    .where({ client_id: clientId, is_default: true })
    .whereNull('location_id')
    .forUpdate()
    .first();
  if (existingDefault) {
    return (await readSettings()) as IClientTaxSettings;
  }

  const date = options.date ?? currentAssignmentDate();
  const resolved = await resolveClientDefaultTaxRate(conn, tenant, date, { lock: true });

  // Look the association up by the resolved rate, not the oldest row: an older
  // association for a different rate must not be promoted, and an existing
  // non-default association for the resolved rate must be promoted in place
  // rather than inserted again.
  const matchingAssociation = await db
    .table('client_tax_rates')
    .where({ client_id: clientId, tax_rate_id: resolved.taxRateId })
    .whereNull('location_id')
    .forUpdate()
    .first();

  if (matchingAssociation) {
    if (!matchingAssociation.is_default) {
      await db
        .table('client_tax_rates')
        .where({
          client_tax_rates_id: matchingAssociation.client_tax_rates_id,
          tenant,
        })
        .update({ is_default: true, updated_at: conn.fn.now() });
    }
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

  return (await readSettings()) as IClientTaxSettings;
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
