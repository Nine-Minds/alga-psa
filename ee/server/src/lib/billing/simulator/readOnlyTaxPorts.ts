/**
 * Strictly read-only ChargeComputeTaxPorts for the contract simulator.
 *
 * TaxService.calculateTax cannot be used here: its getClientTaxSettings
 * auto-provisions default client_tax_settings / client_tax_rates rows when a
 * client has none (packages/billing/src/services/taxService.ts:332-400), and a
 * simulation run must never INSERT/UPDATE/DELETE. These ports mirror the
 * read paths of BillingEngine.getTaxInfoFromService /
 * getLocationTaxRegionCode / getClientDefaultTaxRegionCode and the
 * region-code path of TaxService.calculateTax with zero writes.
 *
 * Fidelity notes:
 * - TaxService's composite / threshold / holiday branches only execute on its
 *   no-regionCode fallback path. The compute layer always passes a resolved
 *   region code, so the simple active-rate percentage aggregation replicated
 *   here IS the production path for engine-computed charges.
 * - Single deliberate deviation: when a client has no client_tax_settings
 *   row, production provisions a default row (a write) and proceeds as
 *   non-reverse-charge. The simulator treats the missing row as
 *   non-reverse-charge WITHOUT creating defaults — same tax result, no write.
 * - Where production throws ManualInvoiceError('NO_TAX_RATE') when no active
 *   rate matches, the simulator returns zero tax and emits a warning
 *   diagnostic so the whole timeline still renders.
 */

import type { Knex } from 'knex';
import type { ISO8601String, SimulationDiagnostic } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { getClientDefaultTaxRegionCode as getClientDefaultTaxRegionCodeShared } from '@alga-psa/shared/billingClients/clientTax';
import type {
  ChargeComputeTaxInfo,
  ChargeComputeTaxPorts,
  ChargeComputeTaxResult,
} from '@alga-psa/billing/lib/billing/compute';

export interface ReadOnlyTaxPortsOptions {
  /**
   * Hypothetical client profile binding (scenario client_binding kind
   * 'profile'). When set, calculateTax skips all client lookups — the
   * synthetic client id has no rows — and default-region resolution answers
   * with the profile's tax region.
   */
  profileBinding?: { tax_region: string | null; currency_code: string } | null;
  /** Collector for simulation diagnostics raised during tax resolution. */
  onDiagnostic: (diagnostic: SimulationDiagnostic) => void;
}

export function createReadOnlyTaxPorts(
  knex: Knex,
  tenant: string,
  options: ReadOnlyTaxPortsOptions,
): ChargeComputeTaxPorts {
  if (!tenant) {
    throw new Error('Tenant context is required to build simulator tax ports');
  }

  const db = tenantDb(knex, tenant);
  const profileBinding = options.profileBinding ?? null;

  // Per-run memoization, mirroring BillingEngine's per-instance caches.
  const taxInfoByRateId = new Map<string, ChargeComputeTaxInfo>();
  const locationRegionCache = new Map<string, string | null>();
  const clientDefaultRegionCache = new Map<string, string | null>();
  const clientTaxExemptCache = new Map<string, boolean>();
  const reverseChargeCache = new Map<string, boolean>();
  const combinedRateCache = new Map<string, number | null>();
  const emittedDiagnostics = new Set<string>();

  function emitOnce(key: string, diagnostic: SimulationDiagnostic): void {
    if (emittedDiagnostics.has(key)) {
      return;
    }
    emittedDiagnostics.add(key);
    options.onDiagnostic(diagnostic);
  }

  async function getTaxInfoFromService(service: {
    service_id?: string;
    tax_rate_id?: string | null;
  }): Promise<ChargeComputeTaxInfo> {
    // Mirrors BillingEngine.getTaxInfoFromService: a service without a
    // tax_rate_id is explicitly non-taxable; a dangling tax_rate_id is
    // treated as non-taxable.
    if (!service?.tax_rate_id) {
      return { taxRegion: null, isTaxable: false };
    }

    const cached = taxInfoByRateId.get(service.tax_rate_id);
    if (cached) {
      return cached;
    }

    const taxRateInfo = await db
      .table('tax_rates')
      .where({ tax_rate_id: service.tax_rate_id })
      .select('region_code')
      .first();

    const info: ChargeComputeTaxInfo = taxRateInfo?.region_code
      ? { taxRegion: taxRateInfo.region_code, isTaxable: true }
      : { taxRegion: null, isTaxable: false };
    taxInfoByRateId.set(service.tax_rate_id, info);
    return info;
  }

  async function getLocationTaxRegionCode(
    locationId: string | null | undefined,
  ): Promise<string | null> {
    if (!locationId) {
      return null;
    }
    if (locationRegionCache.has(locationId)) {
      return locationRegionCache.get(locationId) ?? null;
    }

    const row = await db
      .table('client_locations')
      .where({ location_id: locationId })
      .select('region_code')
      .first();
    const regionCode = (row?.region_code as string | null | undefined) ?? null;
    locationRegionCache.set(locationId, regionCode);
    return regionCode;
  }

  async function getClientDefaultTaxRegionCode(
    clientId: string,
  ): Promise<string | null> {
    if (profileBinding) {
      return profileBinding.tax_region;
    }
    if (clientDefaultRegionCache.has(clientId)) {
      return clientDefaultRegionCache.get(clientId) ?? null;
    }

    const regionCode = await getClientDefaultTaxRegionCodeShared(
      knex,
      tenant,
      clientId,
    );
    clientDefaultRegionCache.set(clientId, regionCode);
    return regionCode;
  }

  async function isClientTaxExempt(clientId: string): Promise<boolean> {
    if (clientTaxExemptCache.has(clientId)) {
      return clientTaxExemptCache.get(clientId) as boolean;
    }

    const client = await db
      .table('clients')
      .where({ client_id: clientId })
      .select('is_tax_exempt')
      .first();
    if (!client) {
      throw new Error(
        `Client ${clientId} not found in tenant ${tenant} during simulated tax calculation`,
      );
    }

    const exempt = Boolean(client.is_tax_exempt);
    clientTaxExemptCache.set(clientId, exempt);
    return exempt;
  }

  async function isReverseChargeApplicable(clientId: string): Promise<boolean> {
    if (reverseChargeCache.has(clientId)) {
      return reverseChargeCache.get(clientId) as boolean;
    }

    const settings = await db
      .table('client_tax_settings')
      .where({ client_id: clientId })
      .select('is_reverse_charge_applicable')
      .first();

    // Fidelity deviation (the only one): production auto-provisions a default
    // client_tax_settings row here when none exists. A missing row is treated
    // as non-reverse-charge without provisioning — same result, zero writes.
    const reverseCharge = Boolean(settings?.is_reverse_charge_applicable);
    reverseChargeCache.set(clientId, reverseCharge);
    return reverseCharge;
  }

  async function resolveCombinedRate(
    regionCode: string,
    date: ISO8601String,
    currencyCode: string,
  ): Promise<number | null> {
    const cacheKey = `${regionCode}:${date}:${currencyCode}`;
    if (combinedRateCache.has(cacheKey)) {
      return combinedRateCache.get(cacheKey) ?? null;
    }

    // Mirrors TaxService.calculateTax's region-code path: sum the percentages
    // of every active rate valid for the date whose currency matches (or is
    // universal/null).
    const applicableRates: Array<{ tax_percentage: number | string }> = await db
      .table('tax_rates')
      .where({ region_code: regionCode, is_active: true })
      .andWhere('start_date', '<=', date)
      .andWhere(function (this: Knex.QueryBuilder) {
        this.whereNull('end_date').orWhere('end_date', '>', date);
      })
      .andWhere(function (this: Knex.QueryBuilder) {
        this.whereNull('currency_code');
        if (currencyCode) {
          this.orWhere('currency_code', currencyCode);
        }
      })
      .select('tax_percentage');

    if (!applicableRates || applicableRates.length === 0) {
      combinedRateCache.set(cacheKey, null);
      return null;
    }

    const combinedTaxRate = applicableRates.reduce((sum, rate) => {
      const percentage =
        typeof rate.tax_percentage === 'string'
          ? parseFloat(rate.tax_percentage)
          : rate.tax_percentage;
      return sum + (Number.isNaN(percentage) ? 0 : percentage);
    }, 0);

    combinedRateCache.set(cacheKey, combinedTaxRate);
    return combinedTaxRate;
  }

  async function calculateTax(
    clientId: string,
    netAmountInCents: number,
    date: ISO8601String,
    regionCode: string,
    isTaxable: boolean,
    currencyCode: string,
  ): Promise<ChargeComputeTaxResult> {
    if (!isTaxable) {
      return { taxAmount: 0, taxRate: 0 };
    }

    if (profileBinding) {
      // Hypothetical client profile: no client rows exist to consult; the
      // profile is neither tax exempt nor reverse-charge.
    } else {
      if (await isClientTaxExempt(clientId)) {
        return { taxAmount: 0, taxRate: 0 };
      }
      if (await isReverseChargeApplicable(clientId)) {
        return { taxAmount: 0, taxRate: 0 };
      }
    }

    const combinedTaxRate = await resolveCombinedRate(
      regionCode,
      date,
      currencyCode,
    );

    if (combinedTaxRate === null) {
      // Production throws ManualInvoiceError('NO_TAX_RATE') here; the
      // simulator degrades to zero tax and surfaces a diagnostic instead so
      // the rest of the timeline still prices.
      emitOnce(`no-tax-rate:${regionCode}:${date}:${currencyCode}`, {
        severity: 'warning',
        message:
          `No active tax rate found for region "${regionCode}" on ${date} ` +
          `(currency ${currencyCode || 'any'}); simulated tax is 0. ` +
          'Production invoice generation would fail for this charge.',
      });
      return { taxAmount: 0, taxRate: 0 };
    }

    const taxAmount =
      netAmountInCents > 0
        ? Math.ceil((netAmountInCents * combinedTaxRate) / 100)
        : 0;

    return { taxAmount, taxRate: combinedTaxRate };
  }

  return {
    getTaxInfoFromService,
    getLocationTaxRegionCode,
    getClientDefaultTaxRegionCode,
    calculateTax,
  };
}
