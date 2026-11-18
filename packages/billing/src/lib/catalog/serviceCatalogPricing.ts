/**
 * The one writer for `service_prices` (alga0002016).
 *
 * Every catalog price write -- the Service form, the rollout dialog, QuickAdd,
 * the services REST API and the products REST API -- goes through
 * `writeServiceCatalogPricing`, so the window-replace rules, the `default_rate`
 * mirror, the billing lock and the primary-price order are defined once.
 *
 * Windows (see plan D2, amended by docs/plans/2026-11-18-pricebooks-csv-import.md §3.3):
 *  - current window   = rows with `effective_date <= today`. `current` upserts
 *    each submitted currency at today and keeps every earlier row, so effective-
 *    dated history (and price book rows) survive an ordinary save. A currency
 *    that is *removed* is the one destructive case: its rows at or before today
 *    are deleted.
 *  - future window    = rows with `effective_date > today`. `scheduled` replaces
 *    the rows that belong to no price book (price book rows are kept; only
 *    withdrawing the price book removes them); `scheduledAt` merges one date (the rollout dialog) and
 *    `appendAt` inserts one date for a price book (insert-only).
 *  - a window that is not supplied is left untouched, so an ordinary save never
 *    revokes a scheduled increase.
 *
 * `display_order` is the explicit primary order: the array index of the row in
 * its window. `prices[0]` is the primary price and drives `default_rate`.
 *
 * Rates are integer minor units; fractional or negative values are rejected,
 * never rounded.
 */

import { z } from 'zod';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { CURRENCY_OPTIONS } from '@alga-psa/core';
import { tenantDb } from '@alga-psa/db';
import type { IServicePrice } from '@alga-psa/types';
import { lockTenantBilling } from '../billing/billingMutationLock';

export const EPOCH_EFFECTIVE_DATE = '1970-01-01';

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ServiceCatalogPricingError extends Error {
  readonly code = 'SERVICE_CATALOG_PRICING_INVALID';
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join('; '));
    this.name = 'ServiceCatalogPricingError';
    this.issues = issues;
  }
}

export function isServiceCatalogPricingError(error: unknown): error is ServiceCatalogPricingError {
  return error instanceof ServiceCatalogPricingError
    || (typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'ServiceCatalogPricingError');
}

export function todayCalendarDate(): string {
  return new Date().toISOString().slice(0, 10);
}

const supportedCurrencies = (): string[] => CURRENCY_OPTIONS.map((option) => option.value);

export const currencyCodeSchema = z.string().refine(
  (code) => supportedCurrencies().includes(code),
  { error: () => `currency_code must be one of: ${supportedCurrencies().join(', ')}` },
);

/** Integer minor units. A numeric string is accepted so a GET response can be PUT back. */
export const minorUnitRateSchema = z.preprocess(
  (value) => (typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value),
  z.number({ error: 'rate must be an integer number of minor units' })
    .int('rate must be an integer number of minor units (no fractions)')
    .min(0, 'rate must not be negative'),
);

/** Read-only fields a GET response carries; accepted and ignored on write. */
const echoShape = {
  price_id: z.unknown().optional(),
  service_id: z.unknown().optional(),
  tenant: z.unknown().optional(),
  created_at: z.unknown().optional(),
  updated_at: z.unknown().optional(),
  display_order: z.unknown().optional(),
  price_book_id: z.unknown().optional(),
  created_by: z.unknown().optional(),
};

function calendarDateOf(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') {
    const candidate = value.slice(0, 10);
    return CALENDAR_DATE.test(candidate) ? candidate : null;
  }
  return null;
}

export const servicePriceInputSchema = z
  .object({
    currency_code: currencyCodeSchema,
    rate: minorUnitRateSchema,
    // Echo only. A future date here is a mistake: scheduled changes have their own field.
    effective_date: z.unknown().optional(),
    ...echoShape,
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.effective_date === undefined || item.effective_date === null) return;
    const date = calendarDateOf(item.effective_date);
    if (date === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['effective_date'], message: 'effective_date must be a YYYY-MM-DD date' });
    } else if (date > todayCalendarDate()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['effective_date'], message: 'prices cannot carry a future effective_date; use scheduled_prices' });
    }
  })
  .transform(({ currency_code, rate }) => ({ currency_code, rate: rate as number }));

export const scheduledServicePriceInputSchema = z
  .object({
    currency_code: currencyCodeSchema,
    rate: minorUnitRateSchema,
    effective_date: z.unknown().optional(),
    ...echoShape,
  })
  .strict()
  .transform((item, ctx) => {
    const date = typeof item.effective_date === 'string' && CALENDAR_DATE.test(item.effective_date)
      ? item.effective_date
      : calendarDateOf(item.effective_date);
    if (date === null || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['effective_date'], message: 'effective_date must be a YYYY-MM-DD date' });
      return z.NEVER;
    }
    if (date <= todayCalendarDate()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['effective_date'], message: 'scheduled_prices effective_date must be after today' });
      return z.NEVER;
    }
    return { currency_code: item.currency_code, rate: item.rate as number, effective_date: date };
  });

export const servicePricesInputSchema = z.array(servicePriceInputSchema).superRefine((prices, ctx) => {
  const seen = new Set<string>();
  prices.forEach((price, index) => {
    if (seen.has(price.currency_code)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'currency_code'], message: `duplicate currency_code ${price.currency_code} in prices` });
    }
    seen.add(price.currency_code);
  });
});

export const scheduledServicePricesInputSchema = z.array(scheduledServicePriceInputSchema).superRefine((prices, ctx) => {
  const seen = new Set<string>();
  prices.forEach((price, index) => {
    const key = `${price.currency_code}|${price.effective_date}`;
    if (seen.has(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'currency_code'], message: `duplicate currency_code ${price.currency_code} for effective_date ${price.effective_date} in scheduled_prices` });
    }
    seen.add(key);
  });
});

export type ServicePriceInput = z.output<typeof servicePriceInputSchema>;
export type ScheduledServicePriceInput = z.output<typeof scheduledServicePriceInputSchema>;

/**
 * D3 conflict rule, shared by the zod request schemas and the writer: a
 * `default_rate` that disagrees with `prices[0]` is rejected instead of one of
 * them being silently chosen.
 */
export function defaultRateConflictsWithPrimaryPrice(
  defaultRate: unknown,
  prices: ReadonlyArray<{ rate: number }> | undefined,
): boolean {
  if (defaultRate === undefined || defaultRate === null || !prices || prices.length === 0) return false;
  return Number(defaultRate) !== prices[0].rate;
}

export const DEFAULT_RATE_CONFLICT_MESSAGE =
  'default_rate conflicts with prices[0].rate; send only prices (default_rate mirrors the primary price) or make them equal';

export interface AppendServicePricesInput {
  /** `YYYY-MM-DD`, today or later. */
  effectiveDate: string;
  /** The price book the rows belong to; null for an unaffiliated dated insert. */
  priceBookId: string | null;
  prices: ServicePriceInput[];
  /**
   * The currency that is primary (`display_order` 0, mirrored to `default_rate`)
   * for an item with no price before `effectiveDate`, e.g. the job currency of an
   * import that creates the item one currency at a time. Without it the first
   * currency written becomes primary. Ignored for an item that already has
   * earlier prices: its existing order is kept.
   */
  primaryCurrency?: string | null;
}

export interface WriteServiceCatalogPricingInput {
  /**
   * Upserts each submitted currency at today and keeps earlier rows. A currency
   * missing from the list is removed (all its rows at or before today). `[]`
   * clears the current window. Omit to leave it alone.
   */
  current?: ServicePriceInput[];
  /** Replaces the future window. `[]` cancels all scheduled changes. Omit to leave it alone. */
  scheduled?: ScheduledServicePriceInput[];
  /** Merges the given currencies at one future date (rollout dialog). Other rows are untouched. */
  scheduledAt?: { effectiveDate: string; prices: ServicePriceInput[] };
  /**
   * Insert-only dated write used by price books. Same rate and same price book
   * is a no-op; any other conflicting row is an error that names it.
   */
  appendAt?: AppendServicePricesInput;
  /**
   * The `default_rate` the caller is setting. With `current` it must equal
   * `current[0].rate`; without `current` the primary current price is upserted at today.
   */
  defaultRate?: number;
  /** Who is writing; recorded on inserted rows and in audit entries. */
  actorUserId?: string | null;
  /** Test seam; defaults to today (UTC calendar date). */
  today?: string;
}

export interface WriteServiceCatalogPricingResult {
  /** Rows inserted/updated by this call, plus rows an `appendAt` found already in place. */
  prices: IServicePrice[];
  /** The subset of `prices` that `appendAt` found already present (no write happened). */
  unchangedPrices: IServicePrice[];
  /** Fields the caller must apply to `service_catalog` (through `Service.update` or equivalent). */
  servicePatch: { default_rate?: number };
}

function parseOrThrow<T>(schema: z.ZodType<T, unknown>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ServiceCatalogPricingError(
      parsed.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? `${label}[${issue.path.join('.')}]` : label;
        return `${path}: ${issue.message}`;
      }),
    );
  }
  return parsed.data;
}

type PriceRow = IServicePrice & { display_order?: number | null };

const dateOf = (value: unknown): string => calendarDateOf(value) ?? String(value);

function describeRow(row: PriceRow): string {
  return `${row.currency_code} price ${row.rate} dated ${dateOf(row.effective_date)}`
    + (row.price_book_id ? ` in price book ${row.price_book_id}` : ' (not in a price book)');
}

/**
 * Writes catalog prices inside the caller's transaction. Takes the tenant
 * billing lock first: a catalog price change reaches inherited contract lines.
 */
export async function writeServiceCatalogPricing(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  input: WriteServiceCatalogPricingInput,
): Promise<WriteServiceCatalogPricingResult> {
  const today = input.today ?? todayCalendarDate();

  // Validate before taking the lock or touching rows.
  const current = input.current === undefined
    ? undefined
    : parseOrThrow(servicePricesInputSchema, input.current, 'prices');
  const scheduled = input.scheduled === undefined
    ? undefined
    : parseOrThrow(scheduledServicePricesInputSchema, input.scheduled, 'scheduled_prices');
  const scheduledAt = input.scheduledAt === undefined
    ? undefined
    : {
        effectiveDate: input.scheduledAt.effectiveDate,
        prices: parseOrThrow(servicePricesInputSchema, input.scheduledAt.prices, 'prices'),
      };
  if (scheduledAt && !(CALENDAR_DATE.test(scheduledAt.effectiveDate) && scheduledAt.effectiveDate > today)) {
    throw new ServiceCatalogPricingError(['effective_date must be a YYYY-MM-DD date after today']);
  }
  const appendAt = input.appendAt === undefined
    ? undefined
    : {
        effectiveDate: input.appendAt.effectiveDate,
        priceBookId: input.appendAt.priceBookId,
        prices: parseOrThrow(servicePricesInputSchema, input.appendAt.prices, 'prices'),
        primaryCurrency: input.appendAt.primaryCurrency ?? null,
      };
  if (appendAt) {
    if (!CALENDAR_DATE.test(appendAt.effectiveDate) || Number.isNaN(Date.parse(`${appendAt.effectiveDate}T00:00:00Z`))) {
      throw new ServiceCatalogPricingError(['effective_date must be a YYYY-MM-DD date']);
    }
    if (appendAt.effectiveDate < today) {
      throw new ServiceCatalogPricingError([
        `effective_date ${appendAt.effectiveDate} is before today (${today}); dated catalog prices cannot be back-dated`,
      ]);
    }
  }
  if (current !== undefined && defaultRateConflictsWithPrimaryPrice(input.defaultRate, current)) {
    throw new ServiceCatalogPricingError([DEFAULT_RATE_CONFLICT_MESSAGE]);
  }
  if (current === undefined && input.defaultRate !== undefined) {
    parseOrThrow(minorUnitRateSchema as z.ZodType<number, unknown>, input.defaultRate, 'default_rate');
  }

  await lockTenantBilling(trx, tenant);
  const db = tenantDb(trx, tenant);
  const written: IServicePrice[] = [];
  const unchanged: IServicePrice[] = [];
  const servicePatch: { default_rate?: number } = {};
  const actor = input.actorUserId ?? null;

  /**
   * Upserts one currency at today. The latest row effective today decides:
   *  - dated today: merge the rate into it (a price book row is detached and
   *    the detachment audited, because the key leaves room for one row);
   *  - dated earlier with the same rate: keep it, only refresh the order;
   *  - no row at or before today for the currency (a new item or a newly added
   *    currency): insert the baseline at the epoch, as before, so the price
   *    applies to periods that started before today;
   *  - otherwise: insert a new row at today and keep the earlier one.
   */
  const upsertAtToday = async (currency: string, rate: number, displayOrder: number): Promise<void> => {
    const latest = await db.table<PriceRow>('service_prices')
      .where({ service_id: serviceId, currency_code: currency })
      .where('effective_date', '<=', today)
      .orderBy('effective_date', 'desc')
      .first();

    if (latest && dateOf(latest.effective_date) === today) {
      const rateChanged = Number(latest.rate) !== rate;
      const detach = rateChanged && Boolean(latest.price_book_id);
      if (detach) {
        // audit_logs is row-level-secured on the tenant GUC; make sure it is
        // set for this transaction (it is the caller's tenant already).
        await trx.raw("SELECT set_config('app.current_tenant', ?, true)", [tenant]);
        await db.table('audit_logs').insert({
          audit_id: uuidv4(),
          user_id: actor,
          operation: 'service_price.price_book_row_detached',
          table_name: 'service_prices',
          record_id: latest.price_id,
          changed_data: { rate: { old: Number(latest.rate), new: rate }, price_book_id: { old: latest.price_book_id, new: null } },
          details: {
            service_id: serviceId,
            currency_code: currency,
            effective_date: today,
            price_book_id: latest.price_book_id,
            note: 'Edited on the day its price book took effect; the row no longer belongs to the price book.',
          },
          timestamp: new Date().toISOString(),
        });
      }
      const [updated] = await db.table<PriceRow>('service_prices')
        .where({ price_id: latest.price_id })
        .update({
          rate,
          display_order: displayOrder,
          ...(detach ? { price_book_id: null } : {}),
          updated_at: trx.fn.now(),
        })
        .returning('*');
      written.push(updated);
      return;
    }

    if (latest && Number(latest.rate) === rate) {
      const [updated] = await db.table<PriceRow>('service_prices')
        .where({ price_id: latest.price_id })
        .update({ display_order: displayOrder, updated_at: trx.fn.now() })
        .returning('*');
      written.push(updated);
      return;
    }

    const [inserted] = await db.table<PriceRow>('service_prices')
      .insert({
        price_id: uuidv4(),
        tenant,
        service_id: serviceId,
        currency_code: currency,
        rate,
        effective_date: latest ? today : EPOCH_EFFECTIVE_DATE,
        display_order: displayOrder,
        price_book_id: null,
        created_by: actor,
      })
      .returning('*');
    written.push(inserted);
  };

  if (current !== undefined) {
    const keep = current.map((price) => price.currency_code);
    // The one destructive case: a removed currency loses its rows at or before today.
    const removal = db.table('service_prices')
      .where({ service_id: serviceId })
      .where('effective_date', '<=', today);
    await (keep.length > 0 ? removal.whereNotIn('currency_code', keep) : removal).del();
    for (const [index, price] of current.entries()) {
      await upsertAtToday(price.currency_code, price.rate, index);
    }
    if (current.length > 0) servicePatch.default_rate = current[0].rate;
  } else if (input.defaultRate !== undefined) {
    // default_rate alone: the catalog displays the primary current row, so
    // upsert that currency's price at today rather than leave default_rate and
    // the display apart.
    servicePatch.default_rate = input.defaultRate;
    const rows = await db.table<PriceRow>('service_prices')
      .where({ service_id: serviceId })
      .where('effective_date', '<=', today)
      .orderBy([
        { column: 'display_order', order: 'asc' },
        { column: 'currency_code', order: 'asc' },
        { column: 'effective_date', order: 'desc' },
      ]);
    const primary = rows[0];
    if (primary) {
      await upsertAtToday(primary.currency_code, input.defaultRate, primary.display_order ?? 0);
    }
  }

  if (scheduled !== undefined) {
    // `scheduled` owns the unaffiliated future window only. Price book rows are
    // removed solely by withdrawing their price book (plan §3.2, §6), so a
    // scheduled-prices write must never delete them, even though they are
    // future-dated and a GET returns them among `scheduled_prices`.
    await db.table('service_prices')
      .where({ service_id: serviceId })
      .where('effective_date', '>', today)
      .whereNull('price_book_id')
      .del();
    const bookRows = await db.table<PriceRow>('service_prices')
      .where({ service_id: serviceId })
      .where('effective_date', '>', today)
      .whereNotNull('price_book_id');
    const bookRowAt = (currency: string, date: string) =>
      bookRows.find((row) => row.currency_code === currency && dateOf(row.effective_date) === date);
    const conflicts: string[] = [];
    // A client that round-trips GET → PUT sends the price book rows back
    // unchanged; those are already in place. A different rate at a price book
    // row's key would revise the price book behind its back, so it is refused.
    const toWrite = scheduled.filter((price) => {
      const bookRow = bookRowAt(price.currency_code, price.effective_date);
      if (!bookRow) return true;
      if (Number(bookRow.rate) === price.rate) {
        unchanged.push(bookRow);
      } else {
        conflicts.push(
          `cannot schedule ${price.currency_code} price ${price.rate} at ${price.effective_date}: the catalog already has ${describeRow(bookRow)}; revise or withdraw the price book instead`,
        );
      }
      return false;
    });
    if (conflicts.length > 0) throw new ServiceCatalogPricingError(conflicts);
    const indexByDate = new Map<string, number>();
    const rows = toWrite.map((price) => {
      const index = indexByDate.get(price.effective_date) ?? 0;
      indexByDate.set(price.effective_date, index + 1);
      return {
        price_id: uuidv4(),
        tenant,
        service_id: serviceId,
        currency_code: price.currency_code,
        rate: price.rate,
        effective_date: price.effective_date,
        display_order: index,
        created_by: actor,
      };
    });
    if (rows.length > 0) {
      written.push(...(await db.table<PriceRow>('service_prices').insert(rows).returning('*')));
    }
  }

  /**
   * Insert-only dated write. Rows already in place with the same rate and the
   * same price book are no-ops; any other row at the same key is an error.
   * Rows dated today also refresh the `default_rate` mirror.
   */
  const appendRows = async (
    effectiveDate: string,
    priceBookId: string | null,
    prices: ServicePriceInput[],
    order: 'submitted' | 'catalog',
    primaryCurrency: string | null = null,
  ): Promise<void> => {
    if (prices.length === 0) return;
    const existing = await db.table<PriceRow>('service_prices')
      .where({ service_id: serviceId })
      .orderBy('display_order', 'asc');
    const orderOf = new Map<string, number>();
    for (const row of existing) {
      if (!orderOf.has(row.currency_code)) orderOf.set(row.currency_code, row.display_order ?? 0);
    }
    let nextOrder = existing.length === 0 ? 0 : Math.max(...existing.map((row) => row.display_order ?? 0)) + 1;

    const toInsert: Array<Record<string, unknown>> = [];
    for (const [index, price] of prices.entries()) {
      const clash = existing.find((row) => row.currency_code === price.currency_code && dateOf(row.effective_date) === effectiveDate);
      if (clash) {
        if (Number(clash.rate) === price.rate && (clash.price_book_id ?? null) === priceBookId) {
          unchanged.push(clash);
          continue;
        }
        throw new ServiceCatalogPricingError([
          `cannot add ${price.currency_code} price ${price.rate} at ${effectiveDate}: the catalog already has ${describeRow(clash)}`,
        ]);
      }
      let displayOrder = order === 'submitted' ? index : orderOf.get(price.currency_code);
      if (displayOrder === undefined) {
        displayOrder = existing.length === 0 ? index : nextOrder++;
        orderOf.set(price.currency_code, displayOrder);
      }
      toInsert.push({
        price_id: uuidv4(),
        tenant,
        service_id: serviceId,
        currency_code: price.currency_code,
        rate: price.rate,
        effective_date: effectiveDate,
        display_order: displayOrder,
        price_book_id: priceBookId,
        created_by: actor,
      });
    }
    // An item with no price before this date takes `primaryCurrency` as its primary
    // price, whatever order its currencies arrive in; rows already at this date move
    // down one place to make room.
    const primaryRow = primaryCurrency ? toInsert.find((row) => row.currency_code === primaryCurrency) : undefined;
    const primaryOrder = primaryRow ? Number(primaryRow.display_order) : 0;
    if (primaryRow && primaryOrder !== 0 && !existing.some((row) => dateOf(row.effective_date) < effectiveDate)) {
      const shifted = existing.filter((row) => dateOf(row.effective_date) === effectiveDate && (row.display_order ?? 0) < primaryOrder);
      if (shifted.length > 0) {
        await db.table<PriceRow>('service_prices')
          .whereIn('price_id', shifted.map((row) => row.price_id))
          .update({ display_order: trx.raw('display_order + 1'), updated_at: trx.fn.now() });
      }
      for (const row of shifted) orderOf.set(row.currency_code, (row.display_order ?? 0) + 1);
      for (const row of toInsert) {
        if (row !== primaryRow && Number(row.display_order) < primaryOrder) row.display_order = Number(row.display_order) + 1;
      }
      primaryRow.display_order = 0;
      orderOf.set(String(primaryCurrency), 0);
    }
    if (toInsert.length > 0) {
      written.push(...(await db.table<PriceRow>('service_prices').insert(toInsert).returning('*')));
    }
    if (effectiveDate === today) {
      // default_rate follows the primary price effective today.
      const all = [...written, ...unchanged].filter((row) => dateOf(row.effective_date) === today);
      const primary = all.find((row) => (row.display_order ?? 0) === 0 || orderOf.get(row.currency_code) === 0);
      if (primary) servicePatch.default_rate = Number(primary.rate);
    }
  };

  if (scheduledAt && scheduledAt.prices.length > 0) {
    // The rollout dialog re-submits its own date: merge into its previous
    // unaffiliated row, then let the insert-only path add whatever is new.
    // A row that belongs to a price book stays a conflict and is refused.
    for (const [index, price] of scheduledAt.prices.entries()) {
      const [merged] = await db.table<PriceRow>('service_prices')
        .where({ service_id: serviceId, currency_code: price.currency_code, effective_date: scheduledAt.effectiveDate })
        .whereNull('price_book_id')
        .update({ rate: price.rate, display_order: index, updated_at: trx.fn.now() })
        .returning('*');
      if (merged) written.push(merged);
    }
    const mergedCurrencies = new Set(
      written.filter((row) => dateOf(row.effective_date) === scheduledAt.effectiveDate).map((row) => row.currency_code),
    );
    await appendRows(
      scheduledAt.effectiveDate,
      null,
      scheduledAt.prices.filter((price) => !mergedCurrencies.has(price.currency_code)),
      'submitted',
    );
  }

  if (appendAt) {
    await appendRows(appendAt.effectiveDate, appendAt.priceBookId, appendAt.prices, 'catalog', appendAt.primaryCurrency);
  }

  return { prices: [...written, ...unchanged], unchangedPrices: unchanged, servicePatch };
}

/**
 * Corrects one row of a price book that has not taken effect yet. This is the
 * only update the pricebook import makes to an existing row: a different file
 * for the same price book date may revise a rate nobody has been billed at, and
 * only while the row's date is still in the future. It goes through the billing
 * lock like every other catalog price write.
 */
export async function reviseScheduledPriceBookRate(
  trx: Knex.Transaction,
  tenant: string,
  serviceId: string,
  input: { priceBookId: string; currency: string; effectiveDate: string; rate: number; today?: string },
): Promise<IServicePrice> {
  const today = input.today ?? todayCalendarDate();
  const rate = parseOrThrow(
    minorUnitRateSchema as z.ZodType<number, unknown>, input.rate, 'rate',
  );
  if (!(input.effectiveDate > today)) {
    throw new ServiceCatalogPricingError([
      `the ${input.currency} price dated ${input.effectiveDate} is already in effect and cannot be revised; use a new price book with a later date`,
    ]);
  }
  await lockTenantBilling(trx, tenant);
  const [updated] = await tenantDb(trx, tenant)
    .table<PriceRow>('service_prices')
    .where({
      service_id: serviceId,
      currency_code: input.currency,
      effective_date: input.effectiveDate,
      price_book_id: input.priceBookId,
    })
    .update({ rate, updated_at: trx.fn.now() })
    .returning('*');
  if (!updated) {
    throw new ServiceCatalogPricingError([
      `no ${input.currency} price dated ${input.effectiveDate} belongs to price book ${input.priceBookId}`,
    ]);
  }
  return updated;
}

export interface RemovedPricesPreview {
  /** Rows at or before today that a `current` write would delete. */
  removedCount: number;
  /** The currencies being removed. */
  currencies: string[];
  /** Price books whose rows would be deleted, by name. */
  priceBookNames: string[];
}

/**
 * Read-only: what a `current` write with these currencies would delete. A
 * currency missing from the list loses every row at or before today (the one
 * destructive case of the writer), including price book rows.
 */
export async function previewRemovedCurrentPrices(
  trx: Knex | Knex.Transaction,
  tenant: string,
  serviceId: string,
  keptCurrencies: readonly string[],
  today: string = todayCalendarDate(),
): Promise<RemovedPricesPreview> {
  const db = tenantDb(trx, tenant);
  const query = db.table<PriceRow>('service_prices').where({ service_id: serviceId }).where('effective_date', '<=', today);
  const rows = await (keptCurrencies.length > 0 ? query.whereNotIn('currency_code', [...keptCurrencies]) : query);
  const bookIds = [...new Set(rows.map((row) => row.price_book_id).filter((id): id is string => Boolean(id)))];
  const books = bookIds.length > 0
    ? await db.table('catalog_price_books').whereIn('price_book_id', bookIds).select('name').orderBy('name')
    : [];
  return {
    removedCount: rows.length,
    currencies: [...new Set(rows.map((row) => row.currency_code))].sort(),
    priceBookNames: books.map((book: { name: string }) => book.name),
  };
}
