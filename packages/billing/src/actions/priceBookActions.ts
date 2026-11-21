'use server';

import { revalidatePath } from 'next/cache';
import type { Knex } from 'knex';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { featureFlags } from '@alga-psa/core/server';
import { minorUnitsToDecimalText } from '@alga-psa/core/formatters';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import type { IUserWithRoles } from '@alga-psa/types';
import {
  createDraftPriceBook,
  discardDraftPriceBook,
  getPriceBook,
  listPriceBooks,
  loadCatalogAsOf,
  markPriceBookApplied,
  refreshSupersededPriceBooks,
  withdrawScheduledPriceBook,
  type PriceBookSummary,
} from '../lib/catalog/priceBooks';
import { PRICE_BOOK_FEATURE_FLAG } from '../lib/catalog/priceBookFlag';
import {
  isServiceCatalogPricingError,
  todayCalendarDate,
  writeServiceCatalogPricing,
} from '../lib/catalog/serviceCatalogPricing';
import {
  previewCatalogPriceChanges,
  type CatalogPriceChangesPreview,
} from '../lib/catalog/previewCatalogPriceChanges';

export type PriceBookActionError = ActionMessageError | ActionPermissionError;

async function gate(
  user: IUserWithRoles,
  tenant: string,
  requirements: Array<[string, string]>,
): Promise<PriceBookActionError | null> {
  if (!(await featureFlags.isEnabled(PRICE_BOOK_FEATURE_FLAG, { userId: user.user_id, tenantId: tenant }))) {
    return actionError('Price books are not enabled for this account.', 'msp/billing-settings:priceBooks.errors.notEnabled');
  }
  for (const [resource, action] of requirements) {
    if (!(await hasPermission(user, resource, action))) {
      return permissionError(
        `Permission denied: ${resource}:${action} is required.`,
        'msp/billing-settings:priceBooks.errors.permissionDenied',
      );
    }
  }
  return null;
}

const failure = (error: unknown, fallbackKey: string): PriceBookActionError => {
  if (isServiceCatalogPricingError(error)) return actionError(error.message, fallbackKey);
  console.error('[priceBookActions]', error);
  return actionError('The price book action failed. No changes were made.', fallbackKey);
};

export const listPriceBooksAction = withAuth(async (user, { tenant }): Promise<PriceBookSummary[] | PriceBookActionError> => {
  const denied = await gate(user, tenant, [['billing', 'read']]);
  if (denied) return denied;
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    // Lazy refresh: scheduled books that are no longer the latest become superseded.
    await refreshSupersededPriceBooks(trx, tenant);
    return listPriceBooks(trx, tenant);
  });
});

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * The catalog as of the price book's date, as CSV: one row per item and
 * currency, with the carried-forward marker and the *Item ref* column that makes
 * the file a lossless round trip (the ref exists only in this file, never in a table).
 */
export const downloadPriceBookCsvAction = withAuth(async (
  user,
  { tenant },
  priceBookId: string,
): Promise<{ fileName: string; csv: string } | PriceBookActionError> => {
  const denied = await gate(user, tenant, [['billing', 'read']]);
  if (denied) return denied;
  const { knex } = await createTenantKnex();
  const book = await getPriceBook(knex, tenant, priceBookId);
  if (!book) return actionError('Price book not found.', 'msp/billing-settings:priceBooks.errors.notFound');
  const rows = await loadCatalogAsOf(knex, tenant, book.effective_date, book.price_book_id);
  const byItem = new Map<string, typeof rows>();
  for (const row of rows) byItem.set(row.serviceId, [...(byItem.get(row.serviceId) ?? []), row]);
  const currencies = [...new Set(rows.map((row) => row.currency))].sort();
  const header = ['Item ref', 'Type', 'SKU', 'Name', ...currencies.map((c) => `Price ${c}`), 'Source'];
  const lines = [...byItem.values()].map((itemRows) => {
    const first = itemRows[0];
    const byCurrency = new Map(itemRows.map((row) => [row.currency, row]));
    const fromBook = itemRows.some((row) => row.fromThisPriceBook);
    return [
      first.serviceId,
      first.itemKind === 'product' ? 'product' : 'service',
      first.sku,
      first.name,
      ...currencies.map((c) => { const row = byCurrency.get(c); return row ? minorUnitsToDecimalText(row.rateMinor, c) : ''; }),
      fromBook ? 'this price book' : 'carried forward',
    ].map(csvCell).join(',');
  });
  const safeName = book.name.replace(/[^\w.-]+/g, '-');
  return { fileName: `price-book-${safeName}.csv`, csv: [header.map(csvCell).join(','), ...lines].join('\n') };
});

export interface MakeActiveAgainPreview {
  sourceName: string;
  suggestedName: string;
  itemCount: number;
  impact: Pick<CatalogPriceChangesPreview, 'willChange' | 'custom' | 'unreviewed' | 'excluded' | 'totalMonthlyDeltaByCurrency'>;
}

async function reactivationRates(trx: Knex.Transaction, tenant: string, sourceId: string) {
  const source = await getPriceBook(trx, tenant, sourceId);
  if (!source || (source.status !== 'scheduled' && source.status !== 'superseded')) return null;
  const asOf = await loadCatalogAsOf(trx, tenant, source.effective_date, source.price_book_id);
  return { source, asOf };
}

/** What making a price book active again would do to running contracts. Writes nothing. */
export const previewMakePriceBookActiveAgainAction = withAuth(async (
  user,
  { tenant },
  sourcePriceBookId: string,
  effectiveDate: string,
): Promise<MakeActiveAgainPreview | PriceBookActionError> => {
  const denied = await gate(user, tenant, [['billing', 'read'], ['service', 'update']]);
  if (denied) return denied;
  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const found = await reactivationRates(trx, tenant, sourcePriceBookId);
    if (!found) return actionError('Only an applied price book can be made active again.', 'msp/billing-settings:priceBooks.errors.notApplied');
    // Only prices that differ from what will be in effect on that date reach contracts,
    // the same rule the import preview uses; an unchanged price is not a contract change.
    const inEffect = await loadCatalogAsOf(trx, tenant, effectiveDate, null);
    const rateOnDate = new Map(inEffect.map((row) => [`${row.serviceId}|${row.currency}`, row.rateMinor]));
    const impact = await previewCatalogPriceChanges(
      trx, tenant,
      found.asOf
        .filter((row) => rateOnDate.get(`${row.serviceId}|${row.currency}`) !== row.rateMinor)
        .map((row) => ({ serviceId: row.serviceId, currency: row.currency, newRateCents: row.rateMinor })),
      effectiveDate,
    );
    return {
      sourceName: found.source.name,
      suggestedName: `${found.source.name} (re-activated ${effectiveDate})`,
      itemCount: new Set(found.asOf.map((row) => row.serviceId)).size,
      impact,
    };
  });
});

/**
 * "Make active again": never moves the old price book. It creates a new one with
 * `copied_from_price_book_id` set, whose rows are the source's rates as of its
 * date, effective on a date the operator picks (today or later).
 */
export const makePriceBookActiveAgainAction = withAuth(async (
  user,
  { tenant },
  sourcePriceBookId: string,
  input: { name?: string; effectiveDate: string },
): Promise<{ priceBookId: string } | PriceBookActionError> => {
  const denied = await gate(user, tenant, [['service', 'update']]);
  if (denied) return denied;
  const { knex } = await createTenantKnex();
  try {
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const found = await reactivationRates(trx, tenant, sourcePriceBookId);
      if (!found) throw new Error('NOT_APPLIED');
      const name = input.name?.trim() || `${found.source.name} (re-activated ${input.effectiveDate})`;
      const book = await createDraftPriceBook(trx, tenant, {
        name, effectiveDate: input.effectiveDate, createdBy: user.user_id,
        copiedFromPriceBookId: found.source.price_book_id,
        description: `Copy of ${found.source.name} as of ${found.source.effective_date}`,
      });
      const byItem = new Map<string, Array<{ currency_code: string; rate: number }>>();
      for (const row of found.asOf) {
        byItem.set(row.serviceId, [...(byItem.get(row.serviceId) ?? []), { currency_code: row.currency, rate: row.rateMinor }]);
      }
      for (const [serviceId, prices] of byItem) {
        const written = await writeServiceCatalogPricing(trx, tenant, serviceId, {
          appendAt: { effectiveDate: input.effectiveDate, priceBookId: book.price_book_id, prices },
          actorUserId: user.user_id,
        });
        if (written.servicePatch.default_rate !== undefined) {
          await tenantDb(trx, tenant).table('service_catalog').where({ service_id: serviceId }).update(written.servicePatch);
        }
      }
      await markPriceBookApplied(trx, tenant, book.price_book_id, user.user_id);
      return { priceBookId: book.price_book_id };
    });
    revalidatePath('/msp/settings/billing');
    return result;
  } catch (error) {
    if (error instanceof Error && error.message === 'NOT_APPLIED') {
      return actionError('Only an applied price book can be made active again.', 'msp/billing-settings:priceBooks.errors.notApplied');
    }
    return failure(error, 'msp/billing-settings:priceBooks.errors.makeActiveFailed');
  }
});

/** Withdraws a scheduled price book before its date: deletes its future rows and marks it discarded. */
export const withdrawPriceBookAction = withAuth(async (
  user,
  { tenant },
  priceBookId: string,
): Promise<{ removedPrices: number } | PriceBookActionError> => {
  const denied = await gate(user, tenant, [['service', 'update']]);
  if (denied) return denied;
  const { knex } = await createTenantKnex();
  try {
    const result = await withTransaction(knex, (trx: Knex.Transaction) =>
      withdrawScheduledPriceBook(trx, tenant, priceBookId, user.user_id, todayCalendarDate()));
    revalidatePath('/msp/settings/billing');
    return result;
  } catch (error) {
    return failure(error, 'msp/billing-settings:priceBooks.errors.withdrawFailed');
  }
});

/** Discards a draft price book. A draft has no catalog rows, so nothing else changes. */
export const discardPriceBookAction = withAuth(async (
  user,
  { tenant },
  priceBookId: string,
): Promise<{ success: true } | PriceBookActionError> => {
  const denied = await gate(user, tenant, [['service', 'update']]);
  if (denied) return denied;
  const { knex } = await createTenantKnex();
  try {
    await withTransaction(knex, (trx: Knex.Transaction) => discardDraftPriceBook(trx, tenant, priceBookId, user.user_id));
    revalidatePath('/msp/settings/billing');
    return { success: true as const };
  } catch (error) {
    return failure(error, 'msp/billing-settings:priceBooks.errors.discardFailed');
  }
});
