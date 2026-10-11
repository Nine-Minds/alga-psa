/**
 * The one writer for `service_prices` (alga0002016).
 *
 * Every catalog price write -- the Service form, the rollout dialog, QuickAdd,
 * the services REST API and the products REST API -- goes through
 * `writeServiceCatalogPricing`, so the window-replace rules, the `default_rate`
 * mirror, the billing lock and the primary-price order are defined once.
 *
 * Windows (see plan D2):
 *  - current window   = rows with `effective_date <= today`. `current` replaces
 *    the whole window and writes the rows at the epoch.
 *  - future window    = rows with `effective_date > today`. `scheduled` replaces
 *    the whole window; `scheduledAt` upserts one date (the rollout dialog).
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

const currencyCodeSchema = z.string().refine(
  (code) => supportedCurrencies().includes(code),
  () => ({ message: `currency_code must be one of: ${supportedCurrencies().join(', ')}` }),
);

/** Integer minor units. A numeric string is accepted so a GET response can be PUT back. */
export const minorUnitRateSchema = z.preprocess(
  (value) => (typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value),
  z.number({ invalid_type_error: 'rate must be an integer number of minor units' })
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
    effective_date: z.unknown(),
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

export interface WriteServiceCatalogPricingInput {
  /** Replaces the current window. `[]` clears it. Omit to leave it alone. */
  current?: ServicePriceInput[];
  /** Replaces the future window. `[]` cancels all scheduled changes. Omit to leave it alone. */
  scheduled?: ScheduledServicePriceInput[];
  /** Upserts the given currencies at one future date (rollout dialog). Other rows are untouched. */
  scheduledAt?: { effectiveDate: string; prices: ServicePriceInput[] };
  /**
   * The `default_rate` the caller is setting. With `current` it must equal
   * `current[0].rate`; without `current` the primary current row is rewritten to it.
   */
  defaultRate?: number;
  /** Test seam; defaults to today (UTC calendar date). */
  today?: string;
}

export interface WriteServiceCatalogPricingResult {
  /** Rows inserted/updated by this call. */
  prices: IServicePrice[];
  /** Fields the caller must apply to `service_catalog` (through `Service.update` or equivalent). */
  servicePatch: { default_rate?: number };
}

function parseOrThrow<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown, label: string): T {
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
  if (current !== undefined && defaultRateConflictsWithPrimaryPrice(input.defaultRate, current)) {
    throw new ServiceCatalogPricingError([DEFAULT_RATE_CONFLICT_MESSAGE]);
  }
  if (current === undefined && input.defaultRate !== undefined) {
    parseOrThrow(minorUnitRateSchema as z.ZodType<number, z.ZodTypeDef, unknown>, input.defaultRate, 'default_rate');
  }

  await lockTenantBilling(trx, tenant);
  const db = tenantDb(trx, tenant);
  const written: IServicePrice[] = [];
  const servicePatch: { default_rate?: number } = {};

  if (current !== undefined) {
    await db.table('service_prices')
      .where({ service_id: serviceId })
      .where('effective_date', '<=', today)
      .del();
    if (current.length > 0) {
      const inserted = await db.table<PriceRow>('service_prices')
        .insert(current.map((price, index) => ({
          price_id: uuidv4(),
          tenant,
          service_id: serviceId,
          currency_code: price.currency_code,
          rate: price.rate,
          effective_date: EPOCH_EFFECTIVE_DATE,
          display_order: index,
        })))
        .returning('*');
      written.push(...inserted);
      servicePatch.default_rate = current[0].rate;
    }
  } else if (input.defaultRate !== undefined) {
    // default_rate alone: the catalog displays the primary current row, so
    // rewrite that row rather than leave default_rate and the display apart.
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
      // The row the catalog shows for this currency: the latest one effective today.
      const displayed = rows.find((row) => row.currency_code === primary.currency_code)!;
      const [updated] = await db.table<PriceRow>('service_prices')
        .where({ price_id: displayed.price_id })
        .update({ rate: input.defaultRate, updated_at: trx.fn.now() })
        .returning('*');
      written.push(updated);
    }
  }

  if (scheduled !== undefined) {
    await db.table('service_prices')
      .where({ service_id: serviceId })
      .where('effective_date', '>', today)
      .del();
    const indexByDate = new Map<string, number>();
    const rows = scheduled.map((price) => {
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
      };
    });
    if (rows.length > 0) {
      written.push(...(await db.table<PriceRow>('service_prices').insert(rows).returning('*')));
    }
  }

  if (scheduledAt && scheduledAt.prices.length > 0) {
    const upserted = await db.table<PriceRow>('service_prices')
      .insert(scheduledAt.prices.map((price, index) => ({
        price_id: uuidv4(),
        tenant,
        service_id: serviceId,
        currency_code: price.currency_code,
        rate: price.rate,
        effective_date: scheduledAt.effectiveDate,
        display_order: index,
      })))
      .onConflict(['tenant', 'service_id', 'currency_code', 'effective_date'])
      .merge(['rate', 'display_order'])
      .returning('*');
    written.push(...upserted);
  }

  return { prices: written, servicePatch };
}
