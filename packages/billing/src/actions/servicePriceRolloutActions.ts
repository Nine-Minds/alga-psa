'use server';

/**
 * Price-change rollout (plan §3.1–3.4).
 *
 * Saving a catalog price is a single catalog write; inherited contract lines
 * follow it by not storing a rate. The rollout preview is split out of the save
 * path (`getServiceContractUsage` is the cheap inline aggregate) and shows the
 * operator exactly who changes, who is custom, who is still unreviewed, and who
 * is already invoiced for the period.
 */

import { revalidatePath } from 'next/cache';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { IService } from '@alga-psa/types';
import { withAuth } from '@alga-psa/auth';
import Service from '../models/service';
import { hasPermission } from '@alga-psa/auth/rbac';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { lockTenantBilling } from '../lib/billing/billingMutationLock';
import {
  loadFixedLineRateInputs,
  toResolverInput,
  type FixedLineRateInputBundle,
} from '../lib/billing/pricing/loadFixedLineRateInputs';
import {
  normalizeProvenance,
  resolveFixedLineRate,
  type RateProvenance,
} from '../lib/billing/pricing/resolveFixedLineRate';
import {
  isPeriodAlreadyInvoiced,
  type InvoicedPeriod,
} from '../lib/billing/pricing/isPeriodAlreadyInvoiced';

export type ServicePriceRolloutActionError =
  | ActionMessageError
  | ActionPermissionError;

export interface ServiceContractUsage {
  contractCount: number;
  lineCount: number;
  byProvenance: Record<RateProvenance, number>;
}

export interface ServicePriceChangePreviewRow {
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
}

export interface ServicePriceChangePreview {
  serviceId: string;
  currency: string;
  oldRateCents: number | null;
  newRateCents: number;
  effectiveDate: string;
  period: InvoicedPeriod;
  willChange: ServicePriceChangePreviewRow[];
  custom: ServicePriceChangePreviewRow[];
  unreviewed: ServicePriceChangePreviewRow[];
  excluded: ServicePriceChangePreviewRow[];
  totalMonthlyDeltaCents: number;
}

export interface ApplyServicePriceChangeInput {
  serviceId: string;
  servicePatch?: Record<string, unknown>;
  /** Primary rows to persist; index 0 drives service_catalog.default_rate. */
  prices: Array<{ currency_code: string; rate: number }>;
  /** When supplied, the new price is written effective at this date. */
  effectiveDate?: string;
}

function calendarDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addOneMonth(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return calendarDate(date);
}

function nextMonthBoundary(): string {
  const now = new Date();
  return calendarDate(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  );
}

function toCents(value: number | string | null | undefined): number | null {
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
  const retained = prices.filter(
    (price) =>
      !(
        price.service_id === serviceId &&
        price.currency_code === currency &&
        (price.effective_date
          ? String(price.effective_date).slice(0, 10)
          : '1970-01-01') === effectiveDate
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

async function loadLineIdsForService(
  trx: Knex | Knex.Transaction,
  tenant: string,
  serviceId: string,
): Promise<string[]> {
  const rows = await tenantDb(trx, tenant)
    .table('contract_line_services')
    .where({ service_id: serviceId })
    .distinct('contract_line_id');
  return rows
    .map((row: { contract_line_id: string | null }) => row.contract_line_id)
    .filter((id): id is string => Boolean(id));
}

export const getServiceContractUsage = withAuth(
  async (
    user,
    { tenant },
    serviceId: string,
  ): Promise<ServiceContractUsage | ServicePriceRolloutActionError> => {
    if (!(await hasPermission(user, 'billing', 'read'))) {
      return permissionError(
        'Permission denied: Cannot inspect service usage',
        'msp/billing:errors.permissions.billingRead',
      );
    }

    const { knex } = await createTenantKnex();
    try {
      return await withTransaction(knex, async (trx: Knex.Transaction) => {
        const lineIds = await loadLineIdsForService(trx, tenant, serviceId);
        if (lineIds.length === 0) {
          return {
            contractCount: 0,
            lineCount: 0,
            byProvenance: { inherited: 0, custom: 0, unreviewed: 0 },
          };
        }

        const lines = await tenantDb(trx, tenant)
          .table('contract_lines')
          .whereIn('contract_line_id', lineIds)
          .select('contract_id', 'custom_rate', 'rate_provenance');

        const contractIds = new Set<string>();
        const byProvenance: Record<RateProvenance, number> = {
          inherited: 0,
          custom: 0,
          unreviewed: 0,
        };
        for (const line of lines as Array<{
          contract_id: string | null;
          custom_rate: number | string | null;
          rate_provenance: string | null;
        }>) {
          if (line.contract_id) contractIds.add(String(line.contract_id));
          const provenance = normalizeProvenance(
            line.rate_provenance as RateProvenance | null,
            toCents(line.custom_rate),
          );
          byProvenance[provenance] += 1;
        }

        return {
          contractCount: contractIds.size,
          lineCount: lines.length,
          byProvenance,
        };
      });
    } catch (error) {
      console.error('[servicePriceRolloutActions] getServiceContractUsage failed:', error);
      return actionError(
        'Could not load service usage. Please try again.',
        'msp/billing:errors.rollout.usageFailed',
      );
    }
  },
);

export const previewServicePriceChange = withAuth(
  async (
    user,
    { tenant },
    serviceId: string,
    newRate: number,
    effectiveDate?: string,
    currency?: string,
  ): Promise<ServicePriceChangePreview | ServicePriceRolloutActionError> => {
    if (!(await hasPermission(user, 'billing', 'read'))) {
      return permissionError(
        'Permission denied: Cannot preview price changes',
        'msp/billing:errors.permissions.billingRead',
      );
    }

    const newRateCents = Math.round(Number(newRate));
    if (!Number.isFinite(newRateCents) || newRateCents < 0) {
      return actionError(
        'The new rate must be a non-negative amount.',
        'msp/billing:errors.rollout.invalidRate',
      );
    }

    const effective = effectiveDate || nextMonthBoundary();
    const period: InvoicedPeriod = {
      start: effective,
      end: addOneMonth(effective),
    };

    const { knex } = await createTenantKnex();
    try {
      return await withTransaction(knex, async (trx: Knex.Transaction) => {
        const db = tenantDb(trx, tenant);
        const serviceRow = await db
          .table('service_catalog')
          .where({ service_id: serviceId })
          .first('service_name');
        if (!serviceRow) {
          return actionError(
            'Service not found.',
            'msp/billing:errors.rollout.serviceNotFound',
          );
        }

        const priceCurrency =
          currency ||
          (
            await db
              .table('service_prices')
              .where({ service_id: serviceId })
              .first('currency_code')
          )?.currency_code ||
          'USD';

        const currentPrice = await db
          .table('service_prices')
          .where({ service_id: serviceId, currency_code: priceCurrency })
          // The dialog header shows this as the "old" rate. Without the date
          // filter a scheduled future row would be reported as the current
          // price. Same fix as `quoteItem.ts` and `Service.setPrice`.
          .where('effective_date', '<=', calendarDate(new Date()))
          .orderBy('effective_date', 'desc')
          .first('rate');

        const lineIds = await loadLineIdsForService(trx, tenant, serviceId);
        const bundles = await loadFixedLineRateInputs(trx, tenant, lineIds);

        const clientIds = [
          ...new Set(
            [...bundles.values()]
              .map((bundle) => bundle.clientId)
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        const clientRows =
          clientIds.length > 0
            ? await db
                .table('clients')
                .whereIn('client_id', clientIds)
                .select('client_id', 'client_name')
            : [];
        const clientNameById = new Map(
          (clientRows as Array<{ client_id: string; client_name: string }>).map(
            (row) => [String(row.client_id), row.client_name],
          ),
        );

        const willChange: ServicePriceChangePreviewRow[] = [];
        const custom: ServicePriceChangePreviewRow[] = [];
        const unreviewed: ServicePriceChangePreviewRow[] = [];
        const excluded: ServicePriceChangePreviewRow[] = [];
        let totalMonthlyDeltaCents = 0;

        for (const bundle of bundles.values()) {
          const stored = toCents(bundle.line.custom_rate);
          const provenance = normalizeProvenance(
            bundle.line.rate_provenance,
            stored,
          );
          const baseRow: Omit<
            ServicePriceChangePreviewRow,
            'currentRateCents' | 'newRateCents' | 'deltaCents' | 'reason'
          > = {
            contractLineId: bundle.contractLineId,
            contractLineName: bundle.contractLineName,
            contractId: bundle.contractId,
            contractName: bundle.contractName,
            clientId: bundle.clientId,
            clientName: bundle.clientId
              ? clientNameById.get(bundle.clientId) ?? null
              : null,
            currency: bundle.currency,
            provenance,
          };

          const alreadyInvoiced = await isPeriodAlreadyInvoiced(
            trx,
            tenant,
            bundle.contractLineId,
            period,
          );
          if (alreadyInvoiced) {
            excluded.push({
              ...baseRow,
              currentRateCents: null,
              newRateCents: null,
              deltaCents: 0,
              reason: 'This period is already invoiced.',
            });
            continue;
          }

          if (!bundle.contractIsActive || bundle.contractHasEnded) {
            excluded.push({
              ...baseRow,
              currentRateCents: null,
              newRateCents: null,
              deltaCents: 0,
              reason: 'Contract is inactive or has ended.',
            });
            continue;
          }

          if (bundle.currency !== priceCurrency) {
            excluded.push({
              ...baseRow,
              currentRateCents: null,
              newRateCents: null,
              deltaCents: 0,
              reason: `Contract bills in ${bundle.currency}.`,
            });
            continue;
          }

          const current = resolveFixedLineRate(toResolverInput(bundle, period));
          const next = resolveFixedLineRate(
            toResolverInput(
              {
                ...bundle,
                catalogPrices: withNewPrice(
                  bundle.catalogPrices,
                  serviceId,
                  bundle.currency,
                  newRateCents,
                  effective,
                ),
              },
              period,
            ),
          );

          const row: ServicePriceChangePreviewRow = {
            ...baseRow,
            currentRateCents: current.line.rateCents,
            newRateCents: next.line.rateCents,
            deltaCents:
              (next.line.rateCents ?? 0) - (current.line.rateCents ?? 0),
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
            totalMonthlyDeltaCents += row.deltaCents;
          } else if (effectiveProvenance === 'unreviewed') {
            unreviewed.push({ ...row, provenance: 'unreviewed' });
          } else {
            custom.push({ ...row, provenance: 'custom' });
          }
        }

        return {
          serviceId,
          currency: priceCurrency,
          oldRateCents: toCents(currentPrice?.rate),
          newRateCents,
          effectiveDate: effective,
          period,
          willChange,
          custom,
          unreviewed,
          excluded,
          totalMonthlyDeltaCents,
        };
      });
    } catch (error) {
      console.error('[servicePriceRolloutActions] previewServicePriceChange failed:', error);
      return actionError(
        'Could not preview the price change. Please try again.',
        'msp/billing:errors.rollout.previewFailed',
      );
    }
  },
);

/**
 * Persist a service edit and its prices. With an `effectiveDate` the new price
 * is written as a new effective-dated `service_prices` row (history preserved);
 * without one the current row is replaced, matching the existing save path.
 */
export const applyServicePriceChange = withAuth(
  async (
    user,
    { tenant },
    input: ApplyServicePriceChangeInput,
  ): Promise<{ success: true } | ServicePriceRolloutActionError> => {
    // This is the effective-dated variant of the ordinary service-price save
    // (`updateServicePricing`), which gates on `service:update`. Gating it on
    // `billing:update` would authorize two paths to the same write differently.
    if (!(await hasPermission(user, 'service', 'update'))) {
      return permissionError(
        'Permission denied: Cannot change service pricing',
        'msp/service-catalog:errors.permissions.updateServices',
      );
    }

    const normalizedPrices = (input.prices ?? []).map((price) => ({
      currency_code: price.currency_code,
      rate: Math.max(0, Math.round(Number(price.rate || 0))),
    }));

    const { knex } = await createTenantKnex();
    try {
      return await withTransaction(knex, async (trx: Knex.Transaction) => {
        await lockTenantBilling(trx, tenant);
        const db = tenantDb(trx, tenant);

        const primaryRate =
          normalizedPrices.length > 0 ? normalizedPrices[0].rate : null;
        const today = new Date().toISOString().slice(0, 10);
        // A scheduled write must not move `default_rate` (the catalog's display
        // and comparison price) to the future rate. Keep it at the
        // currently-effective price so the list and the edit dialog still show
        // what bills today and a later price change still re-opens the rollout
        // dialog. Only an immediate write mirrors the submitted rate.
        const isFutureEffective =
          Boolean(input.effectiveDate) && input.effectiveDate! > today;
        // Route service fields through Service.update: it strips virtual fields
        // (service_type_name, prices, scheduled_prices), ignores undefined, and
        // normalizes `default_rate`. The previous raw update wrote an
        // `updated_at` column `service_catalog` does not have, so every apply
        // failed — a defect the missing coverage hid.
        const servicePatch: Partial<IService> = {
          ...(input.servicePatch as Partial<IService> | undefined),
        };
        delete servicePatch.default_rate;
        if (!isFutureEffective && primaryRate !== null) {
          servicePatch.default_rate = primaryRate;
        }
        // An empty patch (future write with no servicePatch) would make knex
        // reject an empty .update(); skip it rather than throw.
        if (Object.values(servicePatch).some((value) => value !== undefined)) {
          await Service.update(trx, input.serviceId, servicePatch);
        }

        for (const price of normalizedPrices) {
          if (input.effectiveDate) {
            await db
              .table('service_prices')
              .insert({
                tenant,
                service_id: input.serviceId,
                currency_code: price.currency_code,
                rate: price.rate,
                effective_date: input.effectiveDate,
              })
              .onConflict([
                'tenant',
                'service_id',
                'currency_code',
                'effective_date',
              ])
              .merge({ rate: price.rate });
          } else {
            // Immediate write: replace only the currently-effective window and
            // leave scheduled future rows alone (same rule as Service.setPrices).
            await db
              .table('service_prices')
              .where({
                service_id: input.serviceId,
                currency_code: price.currency_code,
              })
              .where('effective_date', '<=', today)
              .del();
            await db.table('service_prices').insert({
              tenant,
              service_id: input.serviceId,
              currency_code: price.currency_code,
              rate: price.rate,
              effective_date: '1970-01-01',
            });
          }
        }

        try {
          revalidatePath('/msp/billing');
          revalidatePath('/msp/settings/billing');
        } catch (error) {
          console.warn('[servicePriceRolloutActions] revalidate failed:', error);
        }

        return { success: true as const };
      });
    } catch (error) {
      console.error('[servicePriceRolloutActions] applyServicePriceChange failed:', error);
      return actionError(
        'Could not save the price change. No changes were made.',
        'msp/billing:errors.rollout.applyFailed',
      );
    }
  },
);
