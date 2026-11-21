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
import { writeServiceCatalogPricing } from '../lib/catalog/serviceCatalogPricing';
import { getTenantDefaultCurrency } from '../lib/catalog/tenantDefaultCurrency';
import {
  normalizeProvenance,
  type RateProvenance,
} from '../lib/billing/pricing/resolveFixedLineRate';
import type { InvoicedPeriod } from '../lib/billing/pricing/isPeriodAlreadyInvoiced';
import {
  calendarDate,
  loadLineIdsForServices,
  previewCatalogPriceChanges,
  toCents,
} from '../lib/catalog/previewCatalogPriceChanges';

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

function nextMonthBoundary(): string {
  const now = new Date();
  return calendarDate(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  );
}

async function loadLineIdsForService(
  trx: Knex | Knex.Transaction,
  tenant: string,
  serviceId: string,
): Promise<string[]> {
  return loadLineIdsForServices(trx, tenant, [serviceId]);
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

        // The service's own price row names its currency; failing that, the
        // tenant default. Never a literal currency code.
        const priceCurrency =
          currency ||
          (
            await db
              .table('service_prices')
              .where({ service_id: serviceId })
              .first('currency_code')
          )?.currency_code ||
          (await getTenantDefaultCurrency(trx, tenant));
        if (!priceCurrency) {
          return actionError(
            'This service has no price and the tenant has no default currency. Set a default currency in billing settings.',
            'msp/billing:errors.rollout.currencyMissing',
          );
        }

        const currentPrice = await db
          .table('service_prices')
          .where({ service_id: serviceId, currency_code: priceCurrency })
          // The dialog header shows this as the "old" rate. Without the date
          // filter a scheduled future row would be reported as the current
          // price. Same fix as `quoteItem.ts` and `Service.setPrice`.
          .where('effective_date', '<=', calendarDate(new Date()))
          .orderBy('effective_date', 'desc')
          .first('rate');

        const preview = await previewCatalogPriceChanges(
          trx,
          tenant,
          [{ serviceId, currency: priceCurrency, newRateCents }],
          effective,
          // The rollout dialog keeps its own wording for a contract in another currency.
          { currencyMismatchReason: (billsIn) => `Contract bills in ${billsIn}.` },
        );
        const withoutServiceIds = ({ serviceIds: _serviceIds, ...row }: (typeof preview.willChange)[number]) => row;

        return {
          serviceId,
          currency: priceCurrency,
          oldRateCents: toCents(currentPrice?.rate),
          newRateCents,
          effectiveDate: effective,
          period: preview.period,
          willChange: preview.willChange.map(withoutServiceIds),
          custom: preview.custom.map(withoutServiceIds),
          unreviewed: preview.unreviewed.map(withoutServiceIds),
          excluded: preview.excluded.map(withoutServiceIds),
          totalMonthlyDeltaCents: preview.totalMonthlyDeltaByCurrency[priceCurrency] ?? 0,
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
        const today = new Date().toISOString().slice(0, 10);
        // A scheduled write must not move `default_rate` (the catalog's display
        // and comparison price) to the future rate: the writer only mirrors the
        // primary price for an immediate write, so the list and the edit dialog
        // still show what bills today and a later price change still re-opens
        // the rollout dialog.
        const isFutureEffective =
          Boolean(input.effectiveDate) && input.effectiveDate! > today;

        // One writer for both branches. Immediate (no date, or a date that is
        // not in the future) replaces the whole current window; a future date
        // upserts the submitted currencies at that date. It takes the tenant
        // billing lock before any row is touched.
        // An apply with no prices is a service-field-only save: it must not
        // clear the price window.
        const { servicePatch: pricingPatch } = normalizedPrices.length === 0
          ? { servicePatch: {} }
          : await writeServiceCatalogPricing(
              trx,
              tenant,
              input.serviceId,
              isFutureEffective
                ? {
                    scheduledAt: {
                      effectiveDate: input.effectiveDate!,
                      prices: normalizedPrices,
                    },
                    actorUserId: user.user_id,
                  }
                : { current: normalizedPrices, actorUserId: user.user_id },
            );

        // Route service fields through Service.update: it strips virtual fields
        // (service_type_name, prices, scheduled_prices), ignores undefined, and
        // normalizes `default_rate`. The previous raw update wrote an
        // `updated_at` column `service_catalog` does not have, so every apply
        // failed — a defect the missing coverage hid.
        const servicePatch: Partial<IService> = {
          ...(input.servicePatch as Partial<IService> | undefined),
        };
        delete servicePatch.default_rate;
        Object.assign(servicePatch, pricingPatch);
        // An empty patch (future write with no servicePatch) would make knex
        // reject an empty .update(); skip it rather than throw.
        if (Object.values(servicePatch).some((value) => value !== undefined)) {
          await Service.update(trx, input.serviceId, servicePatch);
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
