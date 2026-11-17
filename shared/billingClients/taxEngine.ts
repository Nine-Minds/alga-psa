/**
 * The one tax calculation engine.
 *
 * Quotes, invoices and the workflow worker all calculate tax here. Every entry
 * point takes `knexOrTrx` and `tenant` explicitly and writes nothing, so the
 * workflow worker can import it: this module must never import session or
 * tenant-context helpers (`createTenantKnex`, `getCurrentUser`, ...) or anything
 * from `packages/billing`.
 *
 * The arithmetic (`regionalTaxAmount`, `applyCap`, bracket and composite
 * functions, `Math.ceil` rounding) is the former `TaxService` arithmetic, moved
 * unchanged. Where a taxable amount has no applicable rate the engine returns an
 * unresolved result instead of throwing; callers decide what that means
 * (`TaxService` raises `NO_TAX_RATE`, quotes flag the line).
 */
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  IClientTaxSettings,
  ITaxCalculationResult,
  ITaxComponent,
  ITaxHoliday,
  ITaxPeriodCalculationResult,
  ITaxPeriodSegment,
  ITaxRateDetails as ITaxRate,
  ITaxRateThreshold,
  ISO8601String,
} from '@alga-psa/types';

import { divideRational, multiplyRational, normalizeTaxCapAmount, rationalInteger, regionalTaxAmount, toRational } from './taxCapMath';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * UTC midnight for a calendar day. `Date.UTC` maps years 0-99 to 1900-1999, so
 * build the date first and set the full year explicitly; otherwise SQL dates
 * (which use the normalized `YYYY-MM-DD` string) and segmentation (which uses
 * this Date) would disagree for years below 100.
 */
function utcDateFromCalendar(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function daysInMonth(year: number, month: number): number {
  return utcDateFromCalendar(year, month + 1, 0).getUTCDate();
}

function isValidTimeOfDay(time: string): boolean {
  const match = time.match(/^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/);
  if (!match) return false;
  if (Number(match[1]) > 23 || Number(match[2]) > 59) return false;
  if (match[3] !== undefined && Number(match[3]) > 59) return false;
  if (match[4] && match[4] !== 'Z') {
    const [offsetHours, offsetMinutes] = match[4].slice(1).split(':').map(Number);
    if (offsetHours > 23 || offsetMinutes > 59) return false;
  }
  return true;
}

/**
 * Supported date inputs for tax calculations:
 * - `YYYY-MM-DD` calendar days.
 * - ISO 8601 timestamps: `YYYY-MM-DD`, optional `THH:mm[:ss[.sss]]`, optional
 *   `Z` or `±HH:mm` offset. The calendar day is the one the timestamp spells
 *   out in its own offset (its leading date), not the UTC instant, so an
 *   offset never shifts the day count.
 * - `Date` objects, interpreted by their local calendar components because
 *   PostgreSQL `date` columns hydrate as local midnight.
 *
 * Anything else — `2026-02-30`, `2026-06-15junk`, `2026-01-01T25:00` — throws.
 */
function parseCalendarDay(value: ISO8601String | Date): { year: number; month: number; day: number } {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error('Invalid tax calculation date: Invalid Date');
    }
    return { year: value.getFullYear(), month: value.getMonth() + 1, day: value.getDate() };
  }

  const text = String(value).trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](.+))?$/);
  if (!match) {
    throw new Error(`Invalid tax calculation date: ${text}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error(`Invalid tax calculation date: ${text}`);
  }
  if (match[4] !== undefined && !isValidTimeOfDay(match[4])) {
    throw new Error(`Invalid tax calculation date: ${text}`);
  }
  return { year, month, day };
}

/** Normalize any supported input to a `YYYY-MM-DD` calendar day. */
function normalizeCalendarDay(value: ISO8601String | Date): ISO8601String {
  const { year, month, day } = parseCalendarDay(value);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** UTC midnight for a calendar day, used only for inclusive/exclusive day math. */
function calendarDayToUtc(value: ISO8601String | Date): Date {
  const { year, month, day } = parseCalendarDay(value);
  return utcDateFromCalendar(year, month, day);
}

function daysBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
}

function formatDay(date: Date): ISO8601String {
  return date.toISOString().slice(0, 10);
}

/** PostgreSQL numeric columns hydrate as strings; keep percentage math numeric. */
function normalizePercentage(value: number | string): number {
  const percentage = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isNaN(percentage) ? 0 : percentage;
}

/** A rate applies to a day when start_date <= day < end_date (end null = open). */
function isRateActiveOn(rate: Pick<ITaxRate, 'start_date' | 'end_date'>, day: Date): boolean {
  if (calendarDayToUtc(rate.start_date).getTime() > day.getTime()) return false;
  if (rate.end_date && calendarDayToUtc(rate.end_date).getTime() <= day.getTime()) return false;
  return true;
}

/**
 * Split [periodStart, periodEnd) at every rate start/end that falls strictly
 * inside the period, returning a sorted, de-duplicated list of boundaries that
 * always begins at periodStart and ends at periodEnd.
 */
function collectBoundaries(
  periodStart: Date,
  periodEnd: Date,
  rates: Pick<ITaxRate, 'start_date' | 'end_date'>[],
): Date[] {
  const boundaries: Date[] = [periodStart];
  for (const rate of rates) {
    for (const value of [rate.start_date, rate.end_date]) {
      if (!value) continue;
      const day = calendarDayToUtc(value);
      if (day.getTime() > periodStart.getTime() && day.getTime() < periodEnd.getTime()) {
        boundaries.push(day);
      }
    }
  }
  boundaries.push(periodEnd);
  boundaries.sort((a, b) => a.getTime() - b.getTime());
  return boundaries.filter((day, index) => index === 0 || day.getTime() !== boundaries[index - 1].getTime());
}

function segmentsFromBoundaries(boundaries: Date[]): { start: Date; end: Date; days: number }[] {
  const segments: { start: Date; end: Date; days: number }[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const days = daysBetween(start, end);
    if (days > 0) segments.push({ start, end, days });
  }
  return segments;
}

interface BuiltPeriodSegment extends ITaxPeriodSegment {
  covered: boolean;
}

/** A taxable amount whose region has no active rate on the date. */
export interface UnresolvedTax {
  resolved: false;
  reason: 'no_rate';
  regionCode: string;
  date: ISO8601String;
}

export type TaxCalculationOutcome =
  | ({ resolved: true } & ITaxCalculationResult)
  | UnresolvedTax;

/**
 * Why a period could not be fully taxed. `no_rate` and the two default-rate
 * reasons mean nothing applied at all; `coverage_gap` means part of the period
 * has no applicable rate.
 */
export type UnresolvedPeriodTax =
  | { resolved: false; reason: 'no_rate'; regionCode: string; startDate: ISO8601String; endDate: ISO8601String }
  | { resolved: false; reason: 'no_default_rate'; clientId: string; startDate: ISO8601String; endDate: ISO8601String }
  | {
      resolved: false;
      reason: 'default_rate_inactive';
      clientId: string;
      defaultTaxRateId: string;
      startDate: ISO8601String;
      endDate: ISO8601String;
    }
  | { resolved: false; reason: 'coverage_gap'; regionCode?: string; startDate: ISO8601String; endDate: ISO8601String };

export type TaxPeriodCalculationOutcome =
  | ({ resolved: true } & ITaxPeriodCalculationResult)
  | UnresolvedPeriodTax;

export interface TaxCalculationInput {
  clientId: string;
  netAmount: number;
  date: ISO8601String;
  regionCode?: string;
  isTaxable?: boolean;
  currencyCode?: string | null;
  /** Billing profile whose settings apply; defaults to the client's default profile. */
  billingProfileId?: string;
}

export interface TaxPeriodCalculationInput {
  clientId: string;
  netAmount: number;
  startDate: ISO8601String;
  endDate: ISO8601String;
  regionCode?: string;
  isTaxable?: boolean;
  currencyCode?: string | null;
  billingProfileId?: string;
}

/** Message `TaxService` has always raised for a region with no rate on a date. */
export function noTaxRateMessage(regionCode: string, date: ISO8601String): string {
  return `No active tax rate(s) found for region ${regionCode} on date ${date}`;
}

/**
 * Find the first contiguous uncovered interval so the caller knows what to
 * configure; the default path cannot invent a successor rate, and silently
 * charging zero would understate the invoice.
 */
function findCoverageGap(
  segments: BuiltPeriodSegment[],
): { startDate: ISO8601String; endDate: ISO8601String } | null {
  let gapStart: ISO8601String | null = null;
  let gapEnd: ISO8601String | null = null;
  for (const segment of segments) {
    if (!segment.covered) {
      if (gapStart === null) gapStart = segment.start_date;
      gapEnd = segment.end_date;
      continue;
    }
    if (gapStart !== null) break;
  }
  if (gapStart !== null) {
    return { startDate: gapStart, endDate: gapEnd ?? gapStart };
  }
  return null;
}

function emptyPeriodResult(): ITaxPeriodCalculationResult {
  return { taxAmount: 0, taxRate: 0, segments: [] };
}

function aggregatePeriodResult(segments: ITaxPeriodSegment[], netAmount: number): ITaxPeriodCalculationResult {
  const taxAmount = segments.reduce((sum, segment) => sum + segment.taxAmount, 0);
  return {
    taxAmount,
    taxRate: netAmount > 0 ? (taxAmount / netAmount) * 100 : 0,
    segments,
  };
}

// ---------------------------------------------------------------------------
// Reads. None of these write; a client without a settings row is read as
// default settings.
// ---------------------------------------------------------------------------

export async function getCompositeTaxComponents(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  taxRateId: string,
): Promise<ITaxComponent[]> {
  const facade = tenantDb(knexOrTrx, tenant);
  const componentsQuery = facade.parentScopedTable<ITaxComponent>('composite_tax_mappings as ctm')
    .where('ctm.composite_tax_id', taxRateId)
    .orderBy('ctm.sequence');
  facade.tenantJoin(componentsQuery, 'tax_components as tc', 'ctm.tax_component_id', 'tc.tax_component_id', {
    tenantPredicate: 'literal',
  });
  return await componentsQuery.select('tc.*') as ITaxComponent[];
}

export async function getTaxRateThresholds(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  taxRateId: string,
): Promise<ITaxRateThreshold[]> {
  return tenantDb(knexOrTrx, tenant)
    .parentScopedTable<ITaxRateThreshold>('tax_rate_thresholds')
    .where({ tax_rate_id: taxRateId })
    .orderBy('min_amount');
}

export async function getTaxHolidays(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  taxRateId: string,
): Promise<ITaxHoliday[]> {
  return tenantDb(knexOrTrx, tenant)
    .parentScopedTable<ITaxHoliday>('tax_holidays')
    .where('tax_rate_id', taxRateId)
    .orderBy('start_date');
}

/**
 * Tax settings for a client's billing profile, resolved the way
 * `ClientTaxSettings.get` resolves them: the named profile, else the client's
 * default profile. Unlike the model this never provisions anything — no default
 * profile and no settings row both read as the default settings, in memory.
 */
export async function readClientTaxSettings(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  billingProfileId?: string,
): Promise<IClientTaxSettings> {
  const db = tenantDb(knexOrTrx, tenant);
  const defaults: IClientTaxSettings = {
    tenant,
    client_id: clientId,
    billing_profile_id: billingProfileId,
    is_reverse_charge_applicable: false,
  };

  let profileId = billingProfileId;
  if (!profileId) {
    const profile = await db.table('client_billing_profiles')
      .where({ client_id: clientId, is_default: true })
      .select('billing_profile_id')
      .first();
    profileId = profile?.billing_profile_id as string | undefined;
  }
  if (!profileId) return defaults;

  const row = await db.table<IClientTaxSettings>('client_tax_settings')
    .where({ client_id: clientId, billing_profile_id: profileId })
    .first();
  return row ?? { ...defaults, billing_profile_id: profileId };
}

// ---------------------------------------------------------------------------
// Rate arithmetic: moved from TaxService unchanged.
// ---------------------------------------------------------------------------

/**
 * Clamp an amount to a rate's cap. `null`/`undefined` means uncapped; a
 * stored 0 is a supplied cap. Negative, fractional, unsafe, or non-numeric
 * values throw (see `normalizeTaxCapAmount`) rather than silently disabling
 * the cap or producing negative tax.
 */
function applyCap(taxAmount: number, capAmount?: number | null): number {
  const cap = normalizeTaxCapAmount(capAmount);
  return cap === null ? taxAmount : Math.min(taxAmount, cap);
}

function isComponentApplicable(component: ITaxComponent, date: ISO8601String): boolean {
  const currentDate = new Date(date);
  if (component.start_date && new Date(component.start_date) > currentDate) return false;
  if (component.end_date && new Date(component.end_date) < currentDate) return false;
  return true;
}

async function getApplicableTaxHoliday(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  taxRateId: string,
  date: ISO8601String,
): Promise<ITaxHoliday | undefined> {
  const holidays = await getTaxHolidays(knexOrTrx, tenant, taxRateId);
  const currentDate = new Date(date);

  return holidays.find(holiday =>
    new Date(holiday.start_date) <= currentDate && new Date(holiday.end_date) >= currentDate
  );
}

async function calculateComponentTax(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  component: ITaxComponent,
  amount: number,
  date: ISO8601String,
): Promise<number> {
  // Check for tax holidays - currently at tax_rate level (per-component holidays planned for future)
  const holiday = await getApplicableTaxHoliday(knexOrTrx, tenant, component.tax_rate_id, date);
  if (holiday) {
    return 0; // No tax during holiday
  }

  return Math.ceil((amount * component.rate) / 100);
}

async function calculateCompositeTax(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  taxRate: ITaxRate,
  netAmount: number,
  date: ISO8601String,
): Promise<ITaxCalculationResult> {
  const components = await getCompositeTaxComponents(knexOrTrx, tenant, taxRate.tax_rate_id);
  if (netAmount <= 0) return { taxAmount: 0, taxRate: 0, taxComponents: [] };
  let totalTaxAmount = 0;
  const appliedComponents: ITaxComponent[] = [];

  for (const component of components) {
    if (!isComponentApplicable(component, date)) continue;

    const taxableAmount = component.is_compound ? netAmount + totalTaxAmount : netAmount;
    const componentTax = await calculateComponentTax(knexOrTrx, tenant, component, taxableAmount, date);
    totalTaxAmount += componentTax;
    appliedComponents.push(component);
  }

  const effectiveTaxRate = (totalTaxAmount / netAmount) * 100;

  return {
    taxAmount: totalTaxAmount,
    taxRate: effectiveTaxRate,
    taxComponents: appliedComponents
  };
}

function calculateThresholdBasedTax(thresholds: ITaxRateThreshold[], netAmount: number, capAmount?: number | null): ITaxCalculationResult {
  if (netAmount <= 0) return { taxAmount: 0, taxRate: 0, appliedThresholds: [] };
  let taxAmount = 0;
  const appliedThresholds: ITaxRateThreshold[] = [];

  for (const threshold of thresholds) {
    // Bounds refer to the original base, not the remainder after earlier
    // brackets. A nonzero first minimum or a gap must stay untaxed.
    const taxableAmount = Math.max(0,
      Math.min(netAmount, threshold.max_amount ?? netAmount) - threshold.min_amount);
    if (taxableAmount === 0) continue;

    const thresholdTax = Math.ceil((taxableAmount * threshold.rate) / 100);

    taxAmount += thresholdTax;
    appliedThresholds.push(threshold);
  }

  const cappedTaxAmount = applyCap(taxAmount, capAmount);
  const effectiveTaxRate = (cappedTaxAmount / netAmount) * 100;

  return {
    taxAmount: cappedTaxAmount,
    taxRate: effectiveTaxRate,
    appliedThresholds
  };
}

async function calculateSimpleTax(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  taxRate: ITaxRate,
  netAmount: number,
): Promise<ITaxCalculationResult> {
  const thresholds = await getTaxRateThresholds(knexOrTrx, tenant, taxRate.tax_rate_id);

  if (thresholds.length > 0) {
    return calculateThresholdBasedTax(thresholds, netAmount, taxRate.cap_amount);
  }

  // PostgreSQL numeric columns hydrate as strings even though the domain
  // interface declares a number. Keep the result contract numeric on every path.
  const taxPercentage = Number(taxRate.tax_percentage);
  // For negative or zero net amounts, no tax should be applied
  if (netAmount <= 0) {
    return { taxAmount: 0, taxRate: taxPercentage };
  }

  const taxAmount = Math.ceil((netAmount * taxPercentage) / 100);
  return { taxAmount: applyCap(taxAmount, taxRate.cap_amount), taxRate: taxPercentage };
}

async function isClientTaxExempt(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
): Promise<boolean> {
  const client = await tenantDb(knexOrTrx, tenant).table('clients')
    .where({
      client_id: clientId
    })
    .select('is_tax_exempt')
    .first();

  if (!client) {
    throw new Error(`Client ${clientId} not found in tenant ${tenant}`);
  }
  return Boolean(client.is_tax_exempt);
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export async function calculateTaxForAmount(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  input: TaxCalculationInput,
): Promise<TaxCalculationOutcome> {
  const { clientId, netAmount, date, regionCode, currencyCode } = input;
  const isTaxable = input.isTaxable ?? true;
  const db = tenantDb(knexOrTrx, tenant);

  // Check if client is tax exempt
  const isExempt = await isClientTaxExempt(knexOrTrx, tenant, clientId);
  if (isExempt || !isTaxable) {
    return { resolved: true, taxAmount: 0, taxRate: 0 };
  }

  // Check reverse charge applicability BEFORE any tax calculation
  // Reverse charge shifts tax liability to the buyer (common in B2B cross-border transactions)
  const taxSettings = await readClientTaxSettings(knexOrTrx, tenant, clientId, input.billingProfileId);
  if (taxSettings.is_reverse_charge_applicable) {
    return { resolved: true, taxAmount: 0, taxRate: 0 };
  }

  // If regionCode is provided, use that to calculate tax directly, handling composite rates.
  if (regionCode) {
    const applicableRates: Pick<ITaxRate, 'tax_percentage' | 'cap_amount'>[] = await db.table('tax_rates')
      .where({
        region_code: regionCode,
        is_active: true
      })
      .andWhere('start_date', '<=', date)
      .andWhere(function() {
        this.whereNull('end_date')
          .orWhere('end_date', '>', date);
      })
      .andWhere(function() {
        // Currency check: Match specific currency or allow universal (null)
        this.whereNull('currency_code');
        if (currencyCode) {
          this.orWhere('currency_code', currencyCode);
        }
      })
      .select('tax_percentage', 'cap_amount');

    if (!applicableRates || applicableRates.length === 0) {
      return { resolved: false, reason: 'no_rate', regionCode, date };
    }

    // Sum percentages for the reported combined rate
    const combinedTaxRate = applicableRates.reduce(
      (sum, rate) => sum + normalizePercentage(rate.tax_percentage),
      0,
    );

    // Cap each rate's contribution; no binding cap keeps the original
    // combined-rate expression, and capped sums use exact rational math.
    const taxAmount = regionalTaxAmount(
      netAmount,
      toRational(netAmount),
      applicableRates.map(rate => ({
        percentage: normalizePercentage(rate.tax_percentage),
        cap: normalizeTaxCapAmount(rate.cap_amount),
      })),
      combinedTaxRate,
    );

    return {
      resolved: true,
      taxAmount,
      taxRate: combinedTaxRate // Return the combined rate
    };
  }

  // Fallback: Get the client's default tax rate if no regionCode provided
  // Find the default tax rate association
  const defaultRateAssoc = await db.table('client_tax_rates')
    .where({
      client_id: clientId,
      is_default: true,
    })
    .whereNull('location_id')
    .select('tax_rate_id')
    .first();

  if (!defaultRateAssoc) {
    // No default rate configured: zero tax, not unresolved (no region to name).
    return { resolved: true, taxAmount: 0, taxRate: 0 };
  }

  // Fetch the actual tax rate details using the ID found
  const taxRate = await db.table<ITaxRate>('tax_rates')
    .where({
      tax_rate_id: defaultRateAssoc.tax_rate_id,
      is_active: true // Ensure the default rate is active
    })
    // Add date validity check similar to regionCode logic
    .andWhere('start_date', '<=', date)
    .andWhere(function() {
      this.whereNull('end_date')
        .orWhere('end_date', '>', date);
    })
    .andWhere(function() {
      this.whereNull('currency_code');
      if (currencyCode) {
        this.orWhere('currency_code', currencyCode);
      }
    })
    .first();

  if (!taxRate) {
    // Default rate inactive or invalid for the date: zero tax, as before.
    return { resolved: true, taxAmount: 0, taxRate: 0 };
  }

  const result = taxRate.is_composite
    ? await calculateCompositeTax(knexOrTrx, tenant, taxRate, netAmount, date)
    : await calculateSimpleTax(knexOrTrx, tenant, taxRate, netAmount);
  return { resolved: true, ...result };
}

/**
 * Calculate tax for a period that may span several rate-validity windows.
 *
 * Semantics (the approved design left these under-specified; this is the
 * draft's contract, and domain review may change them):
 *
 * - Period is [startDate, endDate): the start day is charged, the end day is
 *   not. Inputs are strictly validated and normalized to a `YYYY-MM-DD`
 *   calendar day (see `parseCalendarDay`); the same normalized days are used
 *   for the SQL overlap filters and for segmentation.
 * - Every rate `start_date`/`end_date` strictly inside the period splits it
 *   into constant-rate segments. Each segment's net amount is its day-share
 *   of the requested net amount; tax is `ceil`-rounded per segment, not once
 *   for the whole period. `netAmount` may be fractional; only tax is rounded.
 * - Coverage is mandatory: every taxable day must have an applicable rate.
 *   An uncovered interval is reported as `coverage_gap` naming the interval;
 *   a period with no rate at all is reported as unresolved `no_rate` (or the
 *   default-rate variants). The default path knows only the client's one
 *   default rate, so a period extending past that rate's validity is
 *   unresolved rather than understating tax or guessing a successor rate from
 *   the region. An empty or reversed period (`end <= start`) throws.
 * - Exemption, reverse charge and currency filtering are evaluated once for
 *   the whole period, exactly as the single-date calculation does, and
 *   short-circuit before any coverage check.
 * - Caps are per rate. On the default-rate path the rate must cover the
 *   whole period (one segment), so the cap applies once. On the regional
 *   path each rate's unrounded contribution is capped before the segment sum
 *   is ceiled, so a period crossing capped rate boundaries charges the
 *   per-rate caps of every segment it touches. Progressive thresholds on the
 *   default path apply to the whole covered amount; they reset per segment
 *   only if a caller ever supplies a multi-segment default path (it cannot
 *   today, because partial coverage is unresolved).
 */
export async function calculateTaxForPeriod(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  input: TaxPeriodCalculationInput,
): Promise<TaxPeriodCalculationOutcome> {
  const { clientId, netAmount, startDate, endDate, regionCode, currencyCode } = input;
  const isTaxable = input.isTaxable ?? true;
  const db = tenantDb(knexOrTrx, tenant);

  // Validate and normalize both ends first; the same calendar days are used
  // for the SQL overlap filters and for segmentation.
  const periodStart = calendarDayToUtc(startDate);
  const periodEnd = calendarDayToUtc(endDate);
  const normalizedStart = normalizeCalendarDay(startDate);
  const normalizedEnd = normalizeCalendarDay(endDate);
  const totalDays = daysBetween(periodStart, periodEnd);
  if (totalDays <= 0) {
    throw new Error('Tax period end date must be after start date');
  }

  // Client-level decisions are evaluated once for the whole period.
  const isExempt = await isClientTaxExempt(knexOrTrx, tenant, clientId);
  if (isExempt || !isTaxable) {
    return { resolved: true, ...emptyPeriodResult() };
  }

  const taxSettings = await readClientTaxSettings(knexOrTrx, tenant, clientId, input.billingProfileId);
  if (taxSettings.is_reverse_charge_applicable) {
    return { resolved: true, ...emptyPeriodResult() };
  }

  if (regionCode) {
    const applicableRates: Pick<ITaxRate, 'tax_rate_id' | 'tax_percentage' | 'cap_amount' | 'start_date' | 'end_date'>[] =
      await db.table('tax_rates')
        .where({
          region_code: regionCode,
          is_active: true
        })
        .andWhere('start_date', '<', normalizedEnd)
        .andWhere(function() {
          this.whereNull('end_date')
            .orWhere('end_date', '>', normalizedStart);
        })
        .andWhere(function() {
          this.whereNull('currency_code');
          if (currencyCode) {
            this.orWhere('currency_code', currencyCode);
          }
        })
        .select('tax_rate_id', 'tax_percentage', 'cap_amount', 'start_date', 'end_date');

    if (!applicableRates || applicableRates.length === 0) {
      return { resolved: false, reason: 'no_rate', regionCode, startDate: normalizedStart, endDate: normalizedEnd };
    }

    const netRational = toRational(netAmount);
    const boundaries = collectBoundaries(periodStart, periodEnd, applicableRates);
    const built: BuiltPeriodSegment[] = segmentsFromBoundaries(boundaries).map(({ start, end, days }) => {
      const segmentNet = netAmount * (days / totalDays);
      // Exact day-share for capped contributions; the reported/uncapped value
      // keeps the original float expression.
      const segmentNetRational = divideRational(
        multiplyRational(netRational, rationalInteger(days)),
        rationalInteger(totalDays),
      );
      const ratesForSegment = applicableRates.filter(rate => isRateActiveOn(rate, start));
      const combinedTaxRate = ratesForSegment.reduce(
        (sum, rate) => sum + normalizePercentage(rate.tax_percentage),
        0,
      );
      // No binding cap keeps the original combined-rate expression; a binding
      // cap sums exact capped contributions per segment.
      const taxAmount = regionalTaxAmount(
        segmentNet,
        segmentNetRational,
        ratesForSegment.map(rate => ({
          percentage: normalizePercentage(rate.tax_percentage),
          cap: normalizeTaxCapAmount(rate.cap_amount),
        })),
        combinedTaxRate,
      );
      return {
        start_date: formatDay(start),
        end_date: formatDay(end),
        days,
        netAmount: segmentNet,
        taxAmount,
        taxRate: combinedTaxRate,
        covered: ratesForSegment.length > 0,
      };
    });

    const gap = findCoverageGap(built);
    if (gap) {
      return { resolved: false, reason: 'coverage_gap', regionCode, ...gap };
    }
    return { resolved: true, ...aggregatePeriodResult(built.map(({ covered, ...segment }) => segment), netAmount) };
  }

  // Default-rate fallback, mirroring the single-date calculation's precedence.
  const defaultRateAssoc = await db.table('client_tax_rates')
    .where({
      client_id: clientId,
      is_default: true,
    })
    .whereNull('location_id')
    .select('tax_rate_id')
    .first();

  if (!defaultRateAssoc) {
    return { resolved: false, reason: 'no_default_rate', clientId, startDate: normalizedStart, endDate: normalizedEnd };
  }

  const taxRate = await db.table<ITaxRate>('tax_rates')
    .where({
      tax_rate_id: defaultRateAssoc.tax_rate_id,
      is_active: true
    })
    .andWhere('start_date', '<', normalizedEnd)
    .andWhere(function() {
      this.whereNull('end_date')
        .orWhere('end_date', '>', normalizedStart);
    })
    .andWhere(function() {
      this.whereNull('currency_code');
      if (currencyCode) {
        this.orWhere('currency_code', currencyCode);
      }
    })
    .first();

  if (!taxRate) {
    return {
      resolved: false,
      reason: 'default_rate_inactive',
      clientId,
      defaultTaxRateId: defaultRateAssoc.tax_rate_id,
      startDate: normalizedStart,
      endDate: normalizedEnd,
    };
  }

  const boundaries = collectBoundaries(periodStart, periodEnd, [taxRate]);
  const built: BuiltPeriodSegment[] = [];
  for (const { start, end, days } of segmentsFromBoundaries(boundaries)) {
    const segmentNet = netAmount * (days / totalDays);
    const covered = isRateActiveOn(taxRate, start);
    let taxAmount = 0;
    let segmentTaxRate = 0;

    if (covered) {
      const segmentDate = formatDay(start);
      const result = taxRate.is_composite
        ? await calculateCompositeTax(knexOrTrx, tenant, taxRate, segmentNet, segmentDate)
        : await calculateSimpleTax(knexOrTrx, tenant, taxRate, segmentNet);
      taxAmount = result.taxAmount;
      segmentTaxRate = result.taxRate;
    }

    built.push({
      start_date: formatDay(start),
      end_date: formatDay(end),
      days,
      netAmount: segmentNet,
      taxAmount,
      taxRate: segmentTaxRate,
      covered,
    });
  }

  const gap = findCoverageGap(built);
  if (gap) {
    return { resolved: false, reason: 'coverage_gap', ...gap };
  }
  return { resolved: true, ...aggregatePeriodResult(built.map(({ covered, ...segment }) => segment), netAmount) };
}
