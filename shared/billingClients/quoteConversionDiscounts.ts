/**
 * Quote-conversion discount carry-over: the ONE implementation shared by
 * `packages/billing` `quoteConversionService` and the workflow runtime's
 * `crmWorkerDal`.
 *
 * What a quote discount becomes on conversion
 * -------------------------------------------
 * Every quote discount is first resolved by the quote's own allocator
 * (`allocateIncludedQuoteDiscounts`, the same allocation the quote document and
 * totals use) into per-base-row reductions, each tagged recurring or one-time.
 *
 * - The ONE-TIME share stays with the one-time invoice / sales order.
 * - The RECURRING share is carried onto the converted contract as
 *   `discounts` + `contract_line_discounts` rows (the same tables and columns
 *   `createContractDiscount` writes), one discount per affected contract line.
 *   Contract line rates (`custom_rate` / `base_rate`) are NOT lowered, so the
 *   discount stays visible and auditable on the contract.
 *
 * Each share is applied exactly once: invoice conversion uses only
 * `onetimeByBase`; contract conversion uses only `recurringByBase`.
 *
 * Why `scope = 'line'` and `client_contract_id`
 * ---------------------------------------------
 * The invoice compute pipeline evaluates every discount as invoice-wide, but the
 * settlement path (`invoiceAutomaticAdjustments`) honors `discounts.scope`:
 * `scope = 'line'` narrows a discount to `contract_line_discounts.contract_line_id`,
 * and `loadApplicableDiscountRows` only sees the row when
 * `contract_line_discounts.client_contract_id` is set. Both are therefore written.
 *
 * Amount representation
 * ---------------------
 * Quote money is integer minor units. `discounts.value` stores a fixed amount as
 * decimal currency (cents / 100) and a percentage as a fraction (pct / 100).
 *
 * Normalization rule (billing frequencies)
 * ----------------------------------------
 * The quote does NOT frequency-normalize: its recurring total is the raw sum of
 * `quantity * unit_price` across recurring rows, whatever their cadence, and the
 * allocator reduces each base row in that row's own units. A contract line bills
 * in its own period, so each line's fixed discount is the allocator's amount for
 * that line, expressed in that line's own period (no conversion). Only the
 * preview's "monthly total" converts cadences, through the contract-overview
 * helper `normalizeToMonthlyCents`.
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { randomUUID } from 'crypto';
import { isQuoteItemIncluded } from '@alga-psa/core';
import {
  allocateIncludedQuoteDiscounts,
  rowGrossAmount,
  type QuoteTotalsRowInput,
} from './quoteDiscountAllocation';
import { normalizeToMonthlyCents } from './contractMonthlyValue';

/** The quote item fields conversion reads (satisfied by IQuoteItem). */
export type ConversionQuoteItem = QuoteTotalsRowInput & {
  quote_item_id: string;
  description?: string | null;
  service_name?: string | null;
  billing_frequency?: string | null;
};

export interface QuoteDiscountConversionShare {
  recurringAmount: number;
  onetimeAmount: number;
  /** Allocations landing on recurring base rows (baseItemId -> amount, minor units). */
  recurringByBase: Map<string, number>;
  /** Allocations landing on one-time base rows (baseItemId -> amount, minor units). */
  onetimeByBase: Map<string, number>;
}

/**
 * Resolve every quote discount to the share of its reduction that lands on
 * recurring versus one-time base rows. Included rows only — required rows and
 * optional rows the customer selected — so what converts is exactly what was
 * quoted and accepted.
 */
export function resolveQuoteDiscountConversionShares<T extends ConversionQuoteItem>(
  items: T[],
): Map<string, QuoteDiscountConversionShare> {
  const allocation = allocateIncludedQuoteDiscounts(items, (item) => item.quote_item_id);
  const shares = new Map<string, QuoteDiscountConversionShare>();
  for (const result of allocation.discounts) {
    const recurringByBase = new Map<string, number>();
    const onetimeByBase = new Map<string, number>();
    let onetimeAmount = 0;
    let recurringAmount = 0;
    for (const itemAllocation of result.allocations) {
      if (itemAllocation.isRecurring) {
        recurringByBase.set(itemAllocation.baseItemId, itemAllocation.amount);
        recurringAmount += itemAllocation.amount;
      } else {
        onetimeByBase.set(itemAllocation.baseItemId, itemAllocation.amount);
        onetimeAmount += itemAllocation.amount;
      }
    }
    shares.set(result.discountId, { recurringAmount, onetimeAmount, recurringByBase, onetimeByBase });
  }
  return shares;
}

/** Included recurring base rows: what a contract conversion turns into contract lines. */
export function getSelectedRecurringItems<T extends ConversionQuoteItem>(items: T[] = []): T[] {
  return items.filter((item) => item.is_recurring && !item.is_discount && isQuoteItemIncluded(item));
}

/**
 * Included one-time rows an invoice would bill: base rows, plus discounts that
 * have a one-time share.
 */
export function getSelectedOneTimeItems<T extends ConversionQuoteItem>(items: T[] = []): T[] {
  const shares = resolveQuoteDiscountConversionShares(items);
  return items
    .filter((item) => !item.is_recurring && isQuoteItemIncluded(item))
    .filter((item) => !item.is_discount || (shares.get(item.quote_item_id)?.onetimeAmount ?? 0) > 0);
}

/**
 * Sum a discount's allocated one-time reduction over the given base rows.
 * Sizes invoice/sales-order discount entries from allocation shares instead of
 * whole persisted amounts.
 */
export function allocatedOneTimeAmountFor(
  shares: Map<string, QuoteDiscountConversionShare>,
  discountItemId: string,
  baseItemIds: Set<string>,
): number {
  const share = shares.get(discountItemId);
  if (!share) return 0;
  let total = 0;
  for (const [baseItemId, amount] of share.onetimeByBase) {
    if (baseItemIds.has(baseItemId)) total += amount;
  }
  return total;
}

/** Total one-time discount reduction allocated to one base row across every discount. */
export function allocatedReductionForBase(
  shares: Map<string, QuoteDiscountConversionShare>,
  baseItemId: string,
): number {
  let total = 0;
  for (const share of shares.values()) total += share.onetimeByBase.get(baseItemId) ?? 0;
  return total;
}

// ---------------------------------------------------------------------------
// Contract-side carry-over
// ---------------------------------------------------------------------------

/** One discount on one contract line, derived from one recurring base row. */
export interface PlannedContractLineDiscount {
  /** quote_item_id of the discount row on the quote. */
  quoteDiscountItemId: string;
  /** quote_item_id of the recurring base row (= the contract line's source row). */
  baseQuoteItemId: string;
  discountName: string;
  discountType: 'percentage' | 'fixed';
  /** `discounts.value`: fraction for percentage, decimal currency for fixed. */
  storedValue: number;
  /** Percent units (e.g. 10) when `discountType` is percentage, else null. */
  percentage: number | null;
  /** The exact reduction this discount makes to one billing period of the line, minor units. */
  reductionCents: number;
  /** Gross line amount before discounts, in the line's own period, minor units. */
  lineAmountCents: number;
  billingFrequency: string | null;
}

/**
 * Plan the contract-line discounts for a quote's recurring discount shares.
 *
 * One discount per (quote discount, affected recurring line):
 * - A percentage discount stays a percentage on every targeted line when the
 *   percentage reproduces the quote's allocation to that line exactly
 *   (`round(line * pct / 100)`); where capping or rounding makes the percentage
 *   inexact, that line gets a fixed amount instead so cents always reconcile.
 * - A fixed discount is split across its targeted lines exactly as the quote
 *   allocator split it (largest remainder, integer cents summing exactly to the
 *   recurring share), each in that line's own billing period.
 */
export function planContractLineDiscounts<T extends ConversionQuoteItem>(
  items: T[],
  fallbackBillingFrequency?: string | null,
): PlannedContractLineDiscount[] {
  const shares = resolveQuoteDiscountConversionShares(items);
  const baseById = new Map(
    getSelectedRecurringItems(items).map((item) => [item.quote_item_id, item] as const),
  );
  const planned: PlannedContractLineDiscount[] = [];

  for (const discountItem of items) {
    if (!discountItem.is_discount) continue;
    const share = shares.get(discountItem.quote_item_id);
    if (!share || share.recurringAmount <= 0) continue;

    const isPercentage = discountItem.discount_type === 'percentage';
    const percent = Math.round(Number(discountItem.discount_percentage ?? 0));
    const baseCount = [...share.recurringByBase.values()].filter((amount) => amount > 0).length;

    for (const [baseId, amount] of share.recurringByBase) {
      const base = baseById.get(baseId);
      if (!base || amount <= 0) continue;
      const lineAmountCents = Math.round(rowGrossAmount(base));
      const percentageIsExact = isPercentage
        && percent > 0
        && percent <= 100
        && Math.round((lineAmountCents * percent) / 100) === amount;
      const baseName = base.service_name || base.description || '';
      const discountName = baseCount > 1 && baseName
        ? `${discountItem.description ?? 'Discount'} - ${baseName}`
        : (discountItem.description || 'Discount');

      planned.push({
        quoteDiscountItemId: discountItem.quote_item_id,
        baseQuoteItemId: baseId,
        discountName,
        discountType: percentageIsExact ? 'percentage' : 'fixed',
        storedValue: percentageIsExact
          ? Math.round((percent / 100) * 1e4) / 1e4
          : Math.round(amount) / 100,
        percentage: percentageIsExact ? percent : null,
        reductionCents: amount,
        lineAmountCents,
        billingFrequency: base.billing_frequency ?? fallbackBillingFrequency ?? null,
      });
    }
  }
  return planned;
}

export interface ContractSideSummary {
  /** Gross recurring, each line converted to a monthly equivalent, minor units. */
  monthlyBeforeDiscountsCents: number;
  monthlyDiscountCents: number;
  monthlyTotalCents: number;
}

/** Monthly-equivalent contract totals before/after the carried discounts. */
export function summarizeContractSide<T extends ConversionQuoteItem>(
  items: T[],
  planned: PlannedContractLineDiscount[],
  fallbackBillingFrequency?: string | null,
): ContractSideSummary {
  let before = 0;
  for (const base of getSelectedRecurringItems(items)) {
    before += normalizeToMonthlyCents(
      Math.round(rowGrossAmount(base)),
      base.billing_frequency ?? fallbackBillingFrequency,
    );
  }
  let discount = 0;
  for (const entry of planned) {
    discount += normalizeToMonthlyCents(entry.reductionCents, entry.billingFrequency);
  }
  return {
    monthlyBeforeDiscountsCents: before,
    monthlyDiscountCents: discount,
    monthlyTotalCents: Math.max(0, before - discount),
  };
}

/**
 * Persist the planned discounts: one `discounts` row (scope 'line') and one
 * `contract_line_discounts` row (with `client_contract_id`) per entry, with the
 * same column set `createContractDiscount` writes. Tenant-scoped throughout.
 */
// LEVERAGE: pattern contract-discount-insert — same discounts + contract_line_discounts insert as packages/billing discountActions.createContractDiscount; a shared insert layer below both would remove this copy
// LEVERAGE: friction line-scope-discount — the compute pipeline forces scope 'invoice', so line-narrowed discounts only take effect in the settlement path (invoiceAutomaticAdjustments)
export async function insertContractLineDiscounts(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  params: {
    clientContractId: string;
    /** `YYYY-MM-DD` the discounts take effect (the client contract start). */
    startDate: string;
    contractLineIdByBaseQuoteItemId: Map<string, string>;
    planned: PlannedContractLineDiscount[];
    nowIso: string;
  },
): Promise<number> {
  const db = tenantDb(knexOrTrx, tenant);
  let inserted = 0;
  for (const entry of params.planned) {
    const contractLineId = params.contractLineIdByBaseQuoteItemId.get(entry.baseQuoteItemId);
    if (!contractLineId) {
      throw new Error(`No contract line was created for recurring quote item ${entry.baseQuoteItemId}`);
    }
    const discountId = randomUUID();
    await db.table('discounts').insert({
      discount_id: discountId,
      tenant,
      discount_name: entry.discountName.trim(),
      discount_type: entry.discountType,
      value: entry.storedValue,
      start_date: `${params.startDate}T00:00:00.000Z`,
      end_date: null,
      is_active: true,
      scope: 'line',
      scope_service_id: null,
      applies_to_item_id: null,
      priority: null,
      created_at: params.nowIso,
      updated_at: params.nowIso,
    });
    await db.table('contract_line_discounts').insert({
      discount_id: discountId,
      tenant,
      contract_line_id: contractLineId,
      client_contract_id: params.clientContractId,
    });
    inserted += 1;
  }
  return inserted;
}
