import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IFixedPriceCharge, IInvoiceBundleComponentAmount, InvoiceBundlePresentation } from '@alga-psa/types';
import { buildBundleSnapshot, type BundleSnapshotDetailInput } from './snapshot';
import { loadPreviousBundlePeriods, type PreviousPeriodRequest } from './previousPeriod';

/** One Fixed line's draft charges, consolidated the way generation persists them. */
export interface PreviewFixedBundle {
  contractLineId: string;
  title: string;
  total: number;
  snapshot: InvoiceBundlePresentation;
  /** Draft money keyed by the synthetic detail id used in `snapshot` (the draft is MSP-only). */
  amounts: Record<string, IInvoiceBundleComponentAmount>;
  /** Charges folded into the bundle, so callers can drop them from the per-service list. */
  charges: IFixedPriceCharge[];
}

const isBundleable = (charge: any): charge is IFixedPriceCharge & { client_contract_line_id: string } =>
  charge?.type === 'fixed' && Boolean(charge.serviceId) && Boolean(charge.config_id) && Boolean(charge.client_contract_line_id);

/**
 * Group a draft's Fixed charges by their contract line and build the same
 * snapshot generation writes (`persistFixedInvoiceCharges`), so the draft
 * preview and the persisted invoice render through the same template path.
 * Billing math is untouched: totals are the sums of the charges' own totals.
 */
export async function buildPreviewFixedBundles(
  knex: Knex | Knex.Transaction,
  tenant: string,
  charges: ReadonlyArray<unknown>,
): Promise<PreviewFixedBundle[]> {
  const byLine = new Map<string, IFixedPriceCharge[]>();
  for (const charge of charges) {
    if (!isBundleable(charge)) continue;
    const key = (charge as any).client_contract_line_id as string;
    byLine.set(key, [...(byLine.get(key) ?? []), charge]);
  }
  if (byLine.size === 0) return [];

  const db = tenantDb(knex, tenant);
  const lineIds = [...byLine.keys()];
  const lineRows = await db.table('contract_lines')
    .whereIn('contract_line_id', lineIds)
    .select('contract_line_id', 'contract_line_name', 'invoice_line_description', 'invoice_line_subtitle');
  const lines = new Map<string, any>(lineRows.map((row: any) => [row.contract_line_id, row]));
  const configIds = [...new Set([...byLine.values()].flat().map((charge) => charge.config_id as string))];
  const configRows = await db.table('contract_line_service_configuration')
    .whereIn('config_id', configIds)
    .select('config_id', 'created_at');
  const createdAt = new Map<string, any>(configRows.map((row: any) => [row.config_id, row.created_at]));

  const requests: PreviousPeriodRequest[] = [];
  for (const [lineId, lineCharges] of byLine) {
    const starts = lineCharges
      .flatMap((charge) => charge.recurringDetailPeriods?.map((p) => p.servicePeriodStart) ?? [charge.servicePeriodStart])
      .filter((value): value is string => Boolean(value))
      .sort();
    if (starts.length > 0) requests.push({ contractLineId: lineId, earliestPeriodStart: starts[0] });
  }
  const previous = await loadPreviousBundlePeriods(knex, tenant, 'preview', requests);

  return [...byLine.entries()].map(([lineId, lineCharges]) => {
    const line = lines.get(lineId);
    const amounts: Record<string, IInvoiceBundleComponentAmount> = {};
    const details: BundleSnapshotDetailInput[] = [];
    lineCharges.forEach((charge, index) => {
      const periods = charge.recurringDetailPeriods?.length
        ? charge.recurringDetailPeriods
        : [{ servicePeriodStart: charge.servicePeriodStart ?? null, servicePeriodEnd: charge.servicePeriodEnd ?? null }];
      periods.forEach((period, periodIndex) => {
        const detailItemId = `preview-detail-${lineId}-${index}-${periodIndex}`;
        // Per-period money is not split in a draft: the charge total rides on its first period.
        amounts[detailItemId] = {
          allocated_amount: periodIndex === 0 ? Number(charge.allocated_amount ?? charge.total) || 0 : 0,
          rate: Number(charge.rate) || 0,
        };
        details.push({
          detailItemId,
          serviceId: charge.serviceId as string,
          serviceName: charge.serviceName,
          rawQuantity: charge.raw_quantity !== undefined ? charge.raw_quantity : (Number(charge.quantity) || null),
          pricingBasis: charge.pricing_basis ?? 'bundle',
          configCreatedAt: createdAt.get(charge.config_id as string) ?? null,
          servicePeriodStart: period.servicePeriodStart ?? null,
          servicePeriodEnd: period.servicePeriodEnd ?? null,
        });
      });
    });
    return {
      contractLineId: lineId,
      title: line?.invoice_line_description || (line?.contract_line_name ? `Fixed Plan: ${line.contract_line_name}` : 'Fixed Plan Charge'),
      total: lineCharges.reduce((sum, charge) => sum + (Number(charge.allocated_amount ?? charge.total) || 0), 0),
      snapshot: buildBundleSnapshot({
        subtitle: line?.invoice_line_subtitle ?? null,
        previousPeriod: previous.get(lineId) ?? null,
        details,
      }),
      amounts,
      charges: lineCharges,
    };
  });
}
