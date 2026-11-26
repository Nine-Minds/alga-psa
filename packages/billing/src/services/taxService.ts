import type {
  IClientTaxSettings,
  ITaxCalculationResult,
  ITaxPeriodCalculationResult,
  ITaxRateDetails as ITaxRate,
  ISO8601String,
} from '@alga-psa/types';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { initializeClientDefaultTax } from '@alga-psa/shared/billingClients/defaultTaxRate';
import {
  calculateTaxForAmount,
  calculateTaxForPeriod as calculateTaxForPeriodWithEngine,
  findClientTaxSettingsRow,
  noTaxRateMessage,
  readClientTaxSettings,
  type UnresolvedPeriodTax,
  type UnresolvedTax,
} from '@alga-psa/shared/billingClients/taxEngine';
import { ManualInvoiceError } from '../errors/manualInvoiceErrors';

export { normalizeTaxCapAmount } from '../lib/billing/taxCapMath';

/** The invoice-side meaning of an unresolved single-date result. */
function noTaxRateError(unresolved: UnresolvedTax): ManualInvoiceError {
  return new ManualInvoiceError(
    'NO_TAX_RATE',
    noTaxRateMessage(unresolved.regionCode, unresolved.date),
    { region: unresolved.regionCode, date: unresolved.date },
  );
}

/** The invoice-side meaning of an unresolved period result. */
function periodTaxError(unresolved: UnresolvedPeriodTax): ManualInvoiceError {
  const { startDate, endDate } = unresolved;
  switch (unresolved.reason) {
    case 'no_rate':
      return new ManualInvoiceError(
        'NO_TAX_RATE',
        `No active tax rate(s) found for region ${unresolved.regionCode} in period ${startDate} - ${endDate}`,
        { region: unresolved.regionCode, startDate, endDate },
      );
    case 'no_default_rate':
      return new ManualInvoiceError(
        'NO_TAX_RATE',
        `No default tax rate configured for client ${unresolved.clientId} in period ${startDate} - ${endDate}`,
        { clientId: unresolved.clientId, startDate, endDate },
      );
    case 'default_rate_inactive':
      return new ManualInvoiceError(
        'NO_TAX_RATE',
        `Default tax rate (ID: ${unresolved.defaultTaxRateId}) is inactive or does not cover period ${startDate} - ${endDate}`,
        { clientId: unresolved.clientId, startDate, endDate },
      );
    case 'coverage_gap':
      return new ManualInvoiceError(
        'TAX_RATE_COVERAGE_GAP',
        `No active tax rate covers ${startDate} to ${endDate}${unresolved.regionCode ? ` for region ${unresolved.regionCode}` : ''}`,
        { region: unresolved.regionCode ?? '', startDate, endDate },
      );
  }
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

    const outcome = await calculateTaxForAmount(knex, tenant, {
      clientId,
      netAmount,
      date,
      regionCode,
      isTaxable: is_taxable,
      currencyCode,
      provisionMissingSettings: () => this.createDefaultTaxSettings(clientId),
    });
    if (outcome.resolved === false) {
      throw noTaxRateError(outcome);
    }
    const { resolved, ...result } = outcome;
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

    const outcome = await calculateTaxForPeriodWithEngine(knex, tenant, {
      clientId,
      netAmount,
      startDate,
      endDate,
      regionCode,
      isTaxable: is_taxable,
      currencyCode,
      provisionMissingSettings: () => this.createDefaultTaxSettings(clientId),
    });
    if (outcome.resolved === false) {
      throw periodTaxError(outcome);
    }
    const { resolved, ...result } = outcome;
    return result;
  }

  /**
   * Settings for the client's default billing profile, read without writing: a
   * client with no settings row is read as default settings. Provisioning is
   * the explicit `createDefaultTaxSettings` / `ensureDefaultTaxSettings`.
   */
  private async getClientTaxSettings(clientId: string): Promise<IClientTaxSettings> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for tax settings lookup');
    }
    return readClientTaxSettings(knex, tenant, clientId);
  }

  /**
   * Provision the default tax settings row for a client's billing profile
   * (F132).
   *
   * Delegates to the shared, transactional initializer. `client_tax_settings`
   * is keyed per profile since S7; when no profile is given the client's
   * default profile is used. The client-wide default rate association is
   * shared and provisioning a second profile must not create a second default.
   */
  async createDefaultTaxSettings(
    clientId: string,
    billingProfileId?: string,
  ): Promise<IClientTaxSettings> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for creating default tax settings');
    }
    return withTransaction(knex, async (trx) =>
      initializeClientDefaultTax(trx, tenant, clientId, { billingProfileId }),
    );
  }

  async ensureDefaultTaxSettings(clientId: string): Promise<void> {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for ensuring default tax settings');
    }

    await withTransaction(knex, async (trx) => {
      await initializeClientDefaultTax(trx, tenant, clientId);
    });
  }

  async isReverseChargeApplicable(clientId: string): Promise<boolean> {
    // Pre-engine behaviour: this read provisioned a missing settings row.
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for tax settings lookup');
    }
    if (!(await findClientTaxSettingsRow(knex, tenant, clientId))) {
      await this.createDefaultTaxSettings(clientId);
    }
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