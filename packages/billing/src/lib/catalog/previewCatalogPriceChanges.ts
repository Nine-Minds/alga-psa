/**
 * One preview core for one catalog price change or many (plan §5.3).
 *
 * Sorts every live contract line that uses a changed service into
 * `willChange` / `custom` / `unreviewed` / `excluded`, by running the same
 * resolver billing uses (`resolveFixedLineRate`) against the catalog as it is
 * and as it would be with every change applied. Resolver inputs are loaded once
 * for the union of affected lines, and each line is resolved once, so a line
 * that uses several changed services yields one row carrying the combined change.
 *
 * `previewServicePriceChange` (one item, the rollout dialog) and the price book
 * import preview are both callers.
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  loadFixedLineRateInputs,
  toResolverInput,
  type FixedLineRateInputBundle,
} from '../billing/pricing/loadFixedLineRateInputs';
import {
  normalizeProvenance,
  resolveFixedLineRate,
  toCalendarDate,
  type RateProvenance,
} from '../billing/pricing/resolveFixedLineRate';
import { isPeriodAlreadyInvoiced, type InvoicedPeriod } from '../billing/pricing/isPeriodAlreadyInvoiced';

export interface CatalogPriceChange {
  serviceId: string;
  currency: string;
  newRateCents: number;
}

export interface CatalogPriceChangePreviewRow {
  contractLineId: string;
  contractLineName: string | null;
  contractId: string | null;
  contractName: string | null;
  clientId: string | null;
  clientName: string | null;
  currency: string;
  provenance: RateProvenance;
  currentRateCents: number | null;
  newRateCents: number | null;
  deltaCents: number;
  reason: string | null;
  /** The changed services this line uses (one entry per service whose change reached the line's currency). */
  serviceIds: string[];
}

export interface CatalogPriceChangesPreview {
  effectiveDate: string;
  period: InvoicedPeriod;
  willChange: CatalogPriceChangePreviewRow[];
  custom: CatalogPriceChangePreviewRow[];
  unreviewed: CatalogPriceChangePreviewRow[];
  excluded: CatalogPriceChangePreviewRow[];
  /** Monthly revenue change of the `willChange` rows, per contract currency. */
  totalMonthlyDeltaByCurrency: Record<string, number>;
}

export interface PreviewCatalogPriceChangesOptions {
  /**
   * The reason shown for a line whose contract bills in a currency none of the
   * changes prices. Defaults to the price book wording.
   */
  currencyMismatchReason?: (billsIn: string, itemNames: string[]) => string;
}

const defaultCurrencyMismatchReason = (billsIn: string, itemNames: string[]): string =>
  `Bills in ${billsIn}; this price book has no ${billsIn} price for ${itemNames.join(', ')}.`;

export function calendarDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addOneMonth(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return calendarDate(date);
}

export function toCents(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

/** Replace the price row for one service + currency at the effective date. */
function withNewPrice(
  prices: FixedLineRateInputBundle['catalogPrices'],
  serviceId: string,
  currency: string,
  newRateCents: number,
  effectiveDate: string,
): FixedLineRateInputBundle['catalogPrices'] {
  // pg materialises the `date` column as a JS `Date`, so this must go through
  // `toCalendarDate`; `String(date).slice(0, 10)` yields e.g. "Thu Oct 01" and
  // never matches the calendar date, leaving the stale scheduled row in place.
  const target = toCalendarDate(effectiveDate);
  const retained = prices.filter(
    (price) =>
      !(
        price.service_id === serviceId &&
        price.currency_code === currency &&
        (toCalendarDate(price.effective_date ?? '1970-01-01') ?? '1970-01-01') === target
      ),
  );
  return [
    ...retained,
    {
      price_id: null,
      service_id: serviceId,
      currency_code: currency,
      rate: newRateCents,
      effective_date: effectiveDate,
    },
  ];
}

/** Contract lines that use any of the services. */
export async function loadLineIdsForServices(
  trx: Knex | Knex.Transaction,
  tenant: string,
  serviceIds: string[],
): Promise<string[]> {
  if (serviceIds.length === 0) return [];
  const rows = await tenantDb(trx, tenant)
    .table('contract_line_services')
    .whereIn('service_id', serviceIds)
    .distinct('contract_line_id');
  return rows
    .map((row: { contract_line_id: string | null }) => row.contract_line_id)
    .filter((id): id is string => Boolean(id));
}

export async function previewCatalogPriceChanges(
  trx: Knex | Knex.Transaction,
  tenant: string,
  changes: CatalogPriceChange[],
  effectiveDate: string,
  options: PreviewCatalogPriceChangesOptions = {},
): Promise<CatalogPriceChangesPreview> {
  const db = tenantDb(trx, tenant);
  const period: InvoicedPeriod = { start: effectiveDate, end: addOneMonth(effectiveDate) };
  const mismatchReason = options.currencyMismatchReason ?? defaultCurrencyMismatchReason;

  const changedServiceIds = [...new Set(changes.map((change) => change.serviceId))];
  const lineIds = await loadLineIdsForServices(trx, tenant, changedServiceIds);
  const bundles = await loadFixedLineRateInputs(trx, tenant, lineIds);

  const clientIds = [
    ...new Set(
      [...bundles.values()].map((bundle) => bundle.clientId).filter((id): id is string => Boolean(id)),
    ),
  ];
  const clientRows = clientIds.length > 0
    ? await db.table('clients').whereIn('client_id', clientIds).select('client_id', 'client_name')
    : [];
  const clientNameById = new Map(
    (clientRows as Array<{ client_id: string; client_name: string }>).map((row) => [String(row.client_id), row.client_name]),
  );

  let serviceNameById: Map<string, string> | null = null;
  const serviceNames = async (ids: string[]): Promise<string[]> => {
    if (!serviceNameById) {
      const rows = await db.table('service_catalog').whereIn('service_id', changedServiceIds).select('service_id', 'service_name');
      serviceNameById = new Map(
        (rows as Array<{ service_id: string; service_name: string }>).map((row) => [String(row.service_id), row.service_name]),
      );
    }
    return ids.map((id) => serviceNameById!.get(id) ?? id);
  };

  const willChange: CatalogPriceChangePreviewRow[] = [];
  const custom: CatalogPriceChangePreviewRow[] = [];
  const unreviewed: CatalogPriceChangePreviewRow[] = [];
  const excluded: CatalogPriceChangePreviewRow[] = [];
  const totalMonthlyDeltaByCurrency: Record<string, number> = {};

  for (const bundle of bundles.values()) {
    const stored = toCents(bundle.line.custom_rate);
    const provenance = normalizeProvenance(bundle.line.rate_provenance, stored);
    const lineServiceIds = changedServiceIds.filter((id) => bundle.serviceIds.includes(id));
    const applicable = changes.filter(
      (change) => bundle.serviceIds.includes(change.serviceId) && change.currency === bundle.currency,
    );
    const baseRow = {
      contractLineId: bundle.contractLineId,
      contractLineName: bundle.contractLineName,
      contractId: bundle.contractId,
      contractName: bundle.contractName,
      clientId: bundle.clientId,
      clientName: bundle.clientId ? clientNameById.get(bundle.clientId) ?? null : null,
      currency: bundle.currency,
      provenance,
      serviceIds: applicable.length > 0 ? [...new Set(applicable.map((change) => change.serviceId))] : lineServiceIds,
    };
    const exclude = (reason: string) => excluded.push({
      ...baseRow,
      currentRateCents: null,
      newRateCents: null,
      deltaCents: 0,
      reason,
    });

    if (await isPeriodAlreadyInvoiced(trx, tenant, bundle.contractLineId, period)) {
      exclude('This period is already invoiced.');
      continue;
    }
    if (!bundle.contractIsActive || bundle.contractHasEnded) {
      exclude('Contract is inactive or has ended.');
      continue;
    }
    if (applicable.length === 0) {
      exclude(mismatchReason(bundle.currency, await serviceNames(lineServiceIds)));
      continue;
    }

    const current = resolveFixedLineRate(toResolverInput(bundle, period));
    const catalogPrices = applicable.reduce(
      (prices, change) => withNewPrice(prices, change.serviceId, change.currency, change.newRateCents, effectiveDate),
      bundle.catalogPrices,
    );
    const next = resolveFixedLineRate(toResolverInput({ ...bundle, catalogPrices }, period));

    const row: CatalogPriceChangePreviewRow = {
      ...baseRow,
      currentRateCents: current.line.rateCents,
      newRateCents: next.line.rateCents,
      deltaCents: (next.line.rateCents ?? 0) - (current.line.rateCents ?? 0),
      reason: null,
    };

    // Line-level provenance alone mislabels a line that is `inherited`
    // but shadowed lower down: a member-level override or an active
    // pricing schedule means the catalog change does not reach it, so it
    // must not appear under "Will change" with a $0 delta. The money
    // total already excludes those; this fixes the label.
    let effectiveProvenance: RateProvenance = provenance;
    if (provenance === 'inherited') {
      const memberOverride = [...current.perService.values()].find(
        (member) => member.provenance !== 'inherited' && member.rateCents !== null,
      );
      if (memberOverride) {
        effectiveProvenance = memberOverride.provenance;
      } else if (current.line.source === 'pricing_schedule') {
        effectiveProvenance = 'custom';
      }
    }

    if (effectiveProvenance === 'inherited') {
      willChange.push(row);
      totalMonthlyDeltaByCurrency[bundle.currency] = (totalMonthlyDeltaByCurrency[bundle.currency] ?? 0) + row.deltaCents;
    } else if (effectiveProvenance === 'unreviewed') {
      unreviewed.push({ ...row, provenance: 'unreviewed' });
    } else {
      custom.push({ ...row, provenance: 'custom' });
    }
  }

  return { effectiveDate, period, willChange, custom, unreviewed, excluded, totalMonthlyDeltaByCurrency };
}
