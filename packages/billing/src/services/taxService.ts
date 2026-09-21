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
import ClientTaxSettings from '../models/clientTaxSettings';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { ensureClientDefaultBillingProfile } from '@alga-psa/shared/billingClients/billingProfiles';
import { v4 as uuid4 } from 'uuid';
import { ManualInvoiceError } from '../errors/manualInvoiceErrors';

import { divideRational, multiplyRational, normalizeTaxCapAmount, rationalInteger, regionalTaxAmount, toRational } from '../lib/billing/taxCapMath';
export { normalizeTaxCapAmount } from '../lib/billing/taxCapMath';

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

/**
 * Fail when any part of the period has no applicable rate. Reports the first
 * contiguous uncovered interval so the caller knows what to configure; the
 * default path cannot invent a successor rate, and silently charging zero would
 * understate the invoice.
 */
function assertFullCoverage(segments: BuiltPeriodSegment[], regionCode?: string): void {
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
    throw new ManualInvoiceError(
      'TAX_RATE_COVERAGE_GAP',
      `No active tax rate covers ${gapStart} to ${gapEnd}${regionCode ? ` for region ${regionCode}` : ''}`,
      { region: regionCode ?? '', startDate: gapStart, endDate: gapEnd ?? gapStart },
    );
  }
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

export class TaxService {
  constructor() {
  }

  async validateTaxRateDateRange(regionCode: string, startDate: ISO8601String, endDate: ISO8601String | null, excludeTaxRateId?: string): Promise<void> {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for tax rate validation');
    }

    // Half-open intervals overlap when each starts before the other's end.
    // A missing end is unbounded, so it must not become the proposed start.
    const query = tenantDb(knex, tenant).table('tax_rates')
      .where({
        region_code: regionCode
      })
      .andWhere(function() {
        this.whereNull('end_date').orWhere('end_date', '>', startDate);
      });
    if (endDate) query.andWhere('start_date', '<', endDate);

    // Only add the excludeTaxRateId condition if it's provided
    if (excludeTaxRateId) {
      query.andWhereNot('tax_rate_id', excludeTaxRateId);
    }

    const overlappingRates = await query;

    if (overlappingRates.length > 0) {
      throw new Error(`Tax rate date range overlaps with existing rate(s) in region ${regionCode}`);
    }
  }

  async calculateTax(clientId: string, netAmount: number, date: ISO8601String, regionCode?: string, is_taxable: boolean = true, currencyCode?: string): Promise<ITaxCalculationResult> {
    const { knex, tenant } = await createTenantKnex();
    
    if (!tenant) {
      throw new Error('Tenant context is required for tax calculation');
    }

    console.log(`Calculating tax for client ${clientId} in tenant ${tenant}, net amount ${netAmount}, date ${date}, regionCode ${regionCode}, currency ${currencyCode}`);

    // Check if client is tax exempt
    const client = await tenantDb(knex, tenant).table('clients')
      .where({
        client_id: clientId
      })
      .select('is_tax_exempt')
      .first();

    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${tenant}`);
    }

    if (client.is_tax_exempt || !is_taxable) {
      console.log(`No tax applied: client ${clientId} is tax exempt or item is not taxable`);
      return { taxAmount: 0, taxRate: 0 };
    }

    // Check reverse charge applicability BEFORE any tax calculation
    // Reverse charge shifts tax liability to the buyer (common in B2B cross-border transactions)
    const taxSettings = await this.getClientTaxSettings(clientId);
    if (taxSettings.is_reverse_charge_applicable) {
      console.log(`Reverse charge is applicable for client ${clientId}. Returning zero tax.`);
      return { taxAmount: 0, taxRate: 0 };
    }

    // If regionCode is provided, use that to calculate tax directly, handling composite rates.
    if (regionCode) {
      console.log(`Calculating tax directly for regionCode: ${regionCode}, amount: ${netAmount}, date: ${date}`);
      
      // Explicitly type the result array
      const applicableRates: Pick<ITaxRate, 'tax_percentage' | 'cap_amount'>[] = await tenantDb(knex, tenant).table('tax_rates')
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
        console.error(`No active tax rate(s) found for regionCode ${regionCode} on date ${date}`);
        // Optional: Log all rates for debugging
        // Debug option: inspect all tenant tax rates through the tenantDb facade.
        // console.log('All tax rates:', allTaxRates);
        throw new ManualInvoiceError(
          'NO_TAX_RATE',
          `No active tax rate(s) found for region ${regionCode} on date ${date}`,
          { region: regionCode, date },
        );
      }

      console.log('Applicable rates:', applicableRates);
      console.log(`Found ${applicableRates.length} applicable rate(s) for regionCode ${regionCode}`);

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

      console.log(`Found ${applicableRates.length} applicable rate(s) for regionCode ${regionCode}. Combined rate: ${combinedTaxRate}%`);
      console.log(`Calculated tax amount: ${taxAmount} for net amount: ${netAmount} using combined rate ${combinedTaxRate}%`);

      return {
        taxAmount,
        taxRate: combinedTaxRate // Return the combined rate
      };
    }

    // Fallback: Get the client's default tax rate if no regionCode provided
    console.log(`No regionCode provided, fetching default tax rate for client ${clientId}`);

    // Note: Reverse charge was already checked at the top of this method

    // Find the default tax rate association
    const defaultRateAssoc = await tenantDb(knex, tenant).table('client_tax_rates')
      .where({
        client_id: clientId,
        is_default: true,
      })
      .whereNull('location_id')
      .select('tax_rate_id')
      .first();

    if (!defaultRateAssoc) {
      // Consider creating default settings if none exist, or throw error
      console.error(`No default tax rate configured for client ${clientId} in tenant ${tenant}`);
      // Option 1: Throw error
      // throw new Error(`No default tax rate configured for client ${clientId}`);
      // Option 2: Return zero tax (safer default?)
       return { taxAmount: 0, taxRate: 0 };
    }

    // Fetch the actual tax rate details using the ID found
    const taxRate = await tenantDb(knex, tenant).table<ITaxRate>('tax_rates')
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

     console.log(`Default tax rate details retrieved for client ${clientId}:`, taxRate);

    if (!taxRate) {
      const error = `Default tax rate (ID: ${defaultRateAssoc.tax_rate_id}) found for client ${clientId} is inactive or invalid for date ${date} in tenant ${tenant}`;
      console.error(error);
      // Decide how to handle - throw error or return zero tax?
      // throw new Error(error);
       return { taxAmount: 0, taxRate: 0 };
    }

    let result: ITaxCalculationResult;
    if (taxRate.is_composite) {
      console.log(`Calculating composite tax for client ${clientId}`);
      result = await this.calculateCompositeTax(taxRate, netAmount, date);
    } else {
      console.log(`Calculating simple tax for client ${clientId}`);
      result = await this.calculateSimpleTax(taxRate, netAmount, date);
    }

    console.log(`Tax calculation result for client ${clientId}:`, result);
    return result;
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
   *   An uncovered interval throws `TAX_RATE_COVERAGE_GAP` naming the interval;
   *   a period with no rate at all throws `NO_TAX_RATE`. The default path knows
   *   only the client's one default rate, so a period extending past that
   *   rate's validity fails rather than understating tax or guessing a
   *   successor rate from the region. An empty or reversed period
   *   (`end <= start`) throws.
   * - Exemption, reverse charge and currency filtering are evaluated once for
   *   the whole period, exactly as the single-date `calculateTax` does, and
   *   short-circuit before any coverage check.
   * - Caps are per rate. On the default-rate path the rate must cover the
   *   whole period (one segment), so the cap applies once. On the regional
   *   path each rate's unrounded contribution is capped before the segment sum
   *   is ceiled, so a period crossing capped rate boundaries charges the
   *   per-rate caps of every segment it touches. Progressive thresholds on the
   *   default path apply to the whole covered amount; they reset per segment
   *   only if a caller ever supplies a multi-segment default path (it cannot
   *   today, because partial coverage fails).
   */
  async calculateTaxForPeriod(
    clientId: string,
    netAmount: number,
    startDate: ISO8601String,
    endDate: ISO8601String,
    regionCode?: string,
    is_taxable: boolean = true,
    currencyCode?: string,
  ): Promise<ITaxPeriodCalculationResult> {
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      throw new Error('Tenant context is required for tax calculation');
    }

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

    console.log(`Calculating tax for client ${clientId} over period ${normalizedStart} - ${normalizedEnd} (${totalDays} days), regionCode ${regionCode}, currency ${currencyCode}`);

    // Client-level decisions are evaluated once for the whole period.
    const client = await tenantDb(knex, tenant).table('clients')
      .where({
        client_id: clientId
      })
      .select('is_tax_exempt')
      .first();

    if (!client) {
      throw new Error(`Client ${clientId} not found in tenant ${tenant}`);
    }

    if (client.is_tax_exempt || !is_taxable) {
      console.log(`No period tax applied: client ${clientId} is tax exempt or item is not taxable`);
      return emptyPeriodResult();
    }

    const taxSettings = await this.getClientTaxSettings(clientId);
    if (taxSettings.is_reverse_charge_applicable) {
      console.log(`Reverse charge is applicable for client ${clientId}. Returning zero period tax.`);
      return emptyPeriodResult();
    }

    if (regionCode) {
      const applicableRates: Pick<ITaxRate, 'tax_rate_id' | 'tax_percentage' | 'cap_amount' | 'start_date' | 'end_date'>[] =
        await tenantDb(knex, tenant).table('tax_rates')
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
        console.error(`No active tax rate(s) found for regionCode ${regionCode} in period ${normalizedStart} - ${normalizedEnd}`);
        throw new ManualInvoiceError(
          'NO_TAX_RATE',
          `No active tax rate(s) found for region ${regionCode} in period ${normalizedStart} - ${normalizedEnd}`,
          { region: regionCode, startDate: normalizedStart, endDate: normalizedEnd },
        );
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

      assertFullCoverage(built, regionCode);
      return aggregatePeriodResult(built.map(({ covered, ...segment }) => segment), netAmount);
    }

    // Default-rate fallback, mirroring calculateTax's precedence.
    const defaultRateAssoc = await tenantDb(knex, tenant).table('client_tax_rates')
      .where({
        client_id: clientId,
        is_default: true,
      })
      .whereNull('location_id')
      .select('tax_rate_id')
      .first();

    if (!defaultRateAssoc) {
      console.error(`No default tax rate configured for client ${clientId} in tenant ${tenant}`);
      throw new ManualInvoiceError(
        'NO_TAX_RATE',
        `No default tax rate configured for client ${clientId} in period ${normalizedStart} - ${normalizedEnd}`,
        { clientId, startDate: normalizedStart, endDate: normalizedEnd },
      );
    }

    const taxRate = await tenantDb(knex, tenant).table<ITaxRate>('tax_rates')
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
      console.error(`Default tax rate (ID: ${defaultRateAssoc.tax_rate_id}) is inactive or does not overlap period ${normalizedStart} - ${normalizedEnd}`);
      throw new ManualInvoiceError(
        'NO_TAX_RATE',
        `Default tax rate (ID: ${defaultRateAssoc.tax_rate_id}) is inactive or does not cover period ${normalizedStart} - ${normalizedEnd}`,
        { clientId, startDate: normalizedStart, endDate: normalizedEnd },
      );
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
          ? await this.calculateCompositeTax(taxRate, segmentNet, segmentDate)
          : await this.calculateSimpleTax(taxRate, segmentNet, segmentDate);
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

    assertFullCoverage(built);
    return aggregatePeriodResult(built.map(({ covered, ...segment }) => segment), netAmount);
  }

  private async calculateCompositeTax(taxRate: ITaxRate, netAmount: number, date: ISO8601String): Promise<ITaxCalculationResult> {
    const { knex } = await createTenantKnex();
    const components = await ClientTaxSettings.getCompositeTaxComponents(taxRate.tax_rate_id);
    if (netAmount <= 0) return { taxAmount: 0, taxRate: 0, taxComponents: [] };
    let totalTaxAmount = 0;
    const appliedComponents: ITaxComponent[] = [];

    for (const component of components) {
      if (!this.isComponentApplicable(component, date)) continue;

      const taxableAmount = component.is_compound ? netAmount + totalTaxAmount : netAmount;
      const componentTax = await this.calculateComponentTax(component, taxableAmount, date);
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

  private async calculateSimpleTax(taxRate: ITaxRate, netAmount: number, date: ISO8601String): Promise<ITaxCalculationResult> {
    const { knex } = await createTenantKnex();
    const thresholds = await ClientTaxSettings.getTaxRateThresholds(taxRate.tax_rate_id);
    
    if (thresholds.length > 0) {
      return this.calculateThresholdBasedTax(thresholds, netAmount, taxRate.cap_amount);
    }

    // PostgreSQL numeric columns hydrate as strings even though the domain
    // interface declares a number. Keep the result contract numeric on every path.
    const taxPercentage = Number(taxRate.tax_percentage);
    // For negative or zero net amounts, no tax should be applied
    if (netAmount <= 0) {
      return { taxAmount: 0, taxRate: taxPercentage };
    }

    const taxAmount = Math.ceil((netAmount * taxPercentage) / 100);
    return { taxAmount: this.applyCap(taxAmount, taxRate.cap_amount), taxRate: taxPercentage };
  }

  private calculateThresholdBasedTax(thresholds: ITaxRateThreshold[], netAmount: number, capAmount?: number | null): ITaxCalculationResult {
    console.log(`Calculating threshold-based tax for net amount: ${netAmount}`);
    console.log(`Number of thresholds: ${thresholds.length}`);

    if (netAmount <= 0) return { taxAmount: 0, taxRate: 0, appliedThresholds: [] };
    let taxAmount = 0;
    const appliedThresholds: ITaxRateThreshold[] = [];

    for (const threshold of thresholds) {
      console.log(`Processing threshold: ${JSON.stringify(threshold)}`);
      // Bounds refer to the original base, not the remainder after earlier
      // brackets. A nonzero first minimum or a gap must stay untaxed.
      const taxableAmount = Math.max(0,
        Math.min(netAmount, threshold.max_amount ?? netAmount) - threshold.min_amount);
      if (taxableAmount === 0) continue;

      console.log(`Taxable amount for this threshold: ${taxableAmount}`);

      const thresholdTax = Math.ceil((taxableAmount * threshold.rate) / 100);
      console.log(`Tax amount for this threshold: ${thresholdTax}`);

      taxAmount += thresholdTax;
      appliedThresholds.push(threshold);

      console.log(`Cumulative tax amount: ${taxAmount}`);
    }

    const cappedTaxAmount = this.applyCap(taxAmount, capAmount);
    const effectiveTaxRate = (cappedTaxAmount / netAmount) * 100;
    console.log(`Effective tax rate: ${effectiveTaxRate}%`);

    const result = {
      taxAmount: cappedTaxAmount,
      taxRate: effectiveTaxRate,
      appliedThresholds
    };

    console.log(`Final tax calculation result: ${JSON.stringify(result)}`);
    return result;
  }

  /**
   * Clamp an amount to a rate's cap. `null`/`undefined` means uncapped; a
   * stored 0 is a supplied cap. Negative, fractional, unsafe, or non-numeric
   * values throw (see `normalizeTaxCapAmount`) rather than silently disabling
   * the cap or producing negative tax.
   */
  private applyCap(taxAmount: number, capAmount?: number | null): number {
    const cap = normalizeTaxCapAmount(capAmount);
    return cap === null ? taxAmount : Math.min(taxAmount, cap);
  }

  private async calculateComponentTax(component: ITaxComponent, amount: number, date: ISO8601String): Promise<number> {
    // Check for tax holidays - currently at tax_rate level (per-component holidays planned for future)
    const holiday = await this.getApplicableTaxHoliday(component.tax_rate_id, date);
    if (holiday) {
      return 0; // No tax during holiday
    }

    return Math.ceil((amount * component.rate) / 100);
  }

  private isComponentApplicable(component: ITaxComponent, date: ISO8601String): boolean {
    const currentDate = new Date(date);
    if (component.start_date && new Date(component.start_date) > currentDate) return false;
    if (component.end_date && new Date(component.end_date) < currentDate) return false;
    return true;
  }

  private async getApplicableTaxHoliday(taxRateId: string, date: ISO8601String): Promise<ITaxHoliday | undefined> {
    const holidays = await ClientTaxSettings.getTaxHolidays(taxRateId);
    const currentDate = new Date(date);

    return holidays.find(holiday =>
      new Date(holiday.start_date) <= currentDate && new Date(holiday.end_date) >= currentDate
    );
  }

  private async getClientTaxSettings(clientId: string): Promise<IClientTaxSettings> {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for tax settings lookup');
    }

    const { knex } = await createTenantKnex();
    let taxSettings = await ClientTaxSettings.get(clientId);

    if (!taxSettings) {
      taxSettings = await this.createDefaultTaxSettings(clientId);
    }

    return taxSettings;
  }

  /**
   * Provision the default tax settings row for a client's billing profile
   * (F132).
   *
   * `client_tax_settings` is keyed per profile since S7, so provisioning for
   * the client alone would leave the resolved profile without a row and the
   * next read would provision it again. When no profile is given, the client's
   * default profile is used — which is exactly the pre-S7 behaviour for a
   * single-profile client.
   */
  async createDefaultTaxSettings(
    clientId: string,
    billingProfileId?: string,
  ): Promise<IClientTaxSettings> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for creating default tax settings');
    }
    const resolvedProfileId = billingProfileId
      ?? await ensureClientDefaultBillingProfile(knex, tenant, clientId);
    const trx = await knex.transaction();

    try {
      const db = tenantDb(trx, tenant);

      // Get the first active tax rate to use as the default
      const defaultTaxRate = await db.table<ITaxRate>('tax_rates')
        .where('is_active', true)
        .orderBy('created_at', 'asc')
        .first(); // Use first() instead of limit(1) which returns array

      if (!defaultTaxRate) {
        throw new Error('No active tax rates found in the system to assign as default.');
      }

      // Create default client tax settings (without tax_rate_id)
      const [taxSettings] = await db.table<IClientTaxSettings>('client_tax_settings')
        .insert({
          client_id: clientId,
          billing_profile_id: resolvedProfileId,
          // tax_rate_id: defaultTaxRate.tax_rate_id, // Removed
          is_reverse_charge_applicable: false,
          tenant
        })
        .onConflict(['tenant', 'client_id', 'billing_profile_id'])
        .merge({ is_reverse_charge_applicable: false })
        .returning('*');

      // The default tax-rate association and its component are per *client*,
      // not per profile — the region chain is unchanged by billing profiles
      // (F089). Provisioning for a second profile must not create a second
      // default rate for the same client.
      const existingDefaultRate = await db.table('client_tax_rates')
        .where({ client_id: clientId, is_default: true })
        .first();

      if (!existingDefaultRate) {
        await db.table('client_tax_rates')
          .insert({
            // client_tax_rate_id: uuid4(), // Assuming auto-generated or sequence
            client_id: clientId,
            tax_rate_id: defaultTaxRate.tax_rate_id,
            is_default: true,
            location_id: null,
            tenant
          });

        // Create a default tax component (linked to the tax_rate, not settings)
        // This part remains largely the same, assuming components are tied to rates
        const tax_component_id = uuid4();
        await db.table<ITaxComponent>('tax_components')
          .insert({
            tax_component_id,
            tax_rate_id: defaultTaxRate.tax_rate_id, // Link component to the chosen default rate
            name: 'Default Tax',
            rate: Math.ceil(defaultTaxRate.tax_percentage),
            sequence: 1,
            is_compound: false,
            tenant
          });
      }
        // Removed .returning('*') as it wasn't used

      await trx.commit();

      return taxSettings;
    } catch (error) {
      await trx.rollback();
      console.error('Error creating default tax settings:', error);
      throw new Error('Failed to create default tax settings');
    }
  }

  async ensureDefaultTaxSettings(clientId: string): Promise<void> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for ensuring default tax settings');
    }

    const resolvedProfileId = await ensureClientDefaultBillingProfile(knex, tenant, clientId);

    await knex.transaction(async (trx) => {
      const db = tenantDb(trx, tenant);
      const existingDefault = await db.table('client_tax_rates')
        .where({ client_id: clientId, is_default: true })
        .whereNull('location_id')
        .first();

      if (existingDefault) {
        return;
      }

      const defaultTaxRate = await db.table<ITaxRate>('tax_rates')
        .where('is_active', true)
        .whereNotNull('region_code')
        .orderBy('created_at', 'asc')
        .first();

      if (!defaultTaxRate) {
        throw new Error('No active tax rates found in the system to assign as default.');
      }

      const existingSettings = await db.table<IClientTaxSettings>('client_tax_settings')
        .where({ client_id: clientId, billing_profile_id: resolvedProfileId })
        .first();

      if (!existingSettings) {
        await db.table<IClientTaxSettings>('client_tax_settings').insert({
          client_id: clientId,
          billing_profile_id: resolvedProfileId,
          is_reverse_charge_applicable: false,
          tenant
        });
      }

      const association = await db.table('client_tax_rates')
        .where({ client_id: clientId })
        .whereNull('location_id')
        .first();

      if (association) {
        await db.table('client_tax_rates')
          .where({ client_id: clientId })
          .whereNull('location_id')
          .update({
            tax_rate_id: defaultTaxRate.tax_rate_id,
            is_default: true
          });
      } else {
        await db.table('client_tax_rates').insert({
          client_id: clientId,
          tax_rate_id: defaultTaxRate.tax_rate_id,
          is_default: true,
          location_id: null,
          tenant
        });
      }
    });
  }

  async isReverseChargeApplicable(clientId: string): Promise<boolean> {
    const taxSettings = await this.getClientTaxSettings(clientId);
    return taxSettings.is_reverse_charge_applicable;
  }

  async getTaxType(clientId: string): Promise<string> {   
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for tax type lookup');
    }

    // Find the default tax rate association for the client
    const defaultRateAssoc = await tenantDb(knex, tenant).table('client_tax_rates')
      .where({
        client_id: clientId,
        is_default: true,
      })
      .whereNull('location_id')
      .select('tax_rate_id')
      .first();

    if (!defaultRateAssoc) {
      // Handle case where no default rate is set - maybe return a default type or throw error
      console.warn(`No default tax rate configured for client ${clientId} in tenant ${tenant}. Cannot determine tax type.`);
      // Option 1: Throw error
      // throw new Error(`No default tax rate configured for client ${clientId}`);
      // Option 2: Return a default/unknown type
      return 'Unknown'; // Or potentially null/undefined depending on desired behavior
    }

    // Fetch the actual tax rate details using the ID found
    const taxRate = await tenantDb(knex, tenant).table<ITaxRate>('tax_rates')
      .where({
        tax_rate_id: defaultRateAssoc.tax_rate_id
        // Assuming we don't need activity/date check just to get the type
      })
      .select('tax_type')
      .first();


    if (!taxRate) {
      const error = `Tax rate details not found for default rate ID ${defaultRateAssoc.tax_rate_id} (Client: ${clientId}, Tenant: ${tenant})`;
      console.error(error);
      // Handle case where rate details are missing despite association existing
      // throw new Error(error);
      return 'Unknown'; // Or potentially null/undefined
    }

    return taxRate.tax_type;
  }
}
