/**
 * Price book lifecycle on top of effective-dated `service_prices` rows
 * (docs/plans/2026-11-18-pricebooks-csv-import.md §3, §5.4).
 *
 * A price book is a label and a lifecycle, never a rate source: billing keeps
 * reading `service_prices`. "Active" is derived and never stored: it is the
 * `scheduled`/`superseded` price book with the greatest `effective_date <= today`.
 * The stored `superseded` status is a lazy refresh and never relied on.
 */
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { lockTenantBilling } from '../billing/billingMutationLock';
import { ServiceCatalogPricingError, todayCalendarDate } from './serviceCatalogPricing';

export type PriceBookStatus = 'draft' | 'scheduled' | 'superseded' | 'discarded';
export type PriceBookDisplayStatus = 'active' | 'scheduled' | 'superseded' | 'draft';

export interface PriceBookRow {
  tenant: string;
  price_book_id: string;
  name: string;
  effective_date: string;
  status: PriceBookStatus;
  description: string | null;
  source_migration_job_id: string | null;
  copied_from_price_book_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  applied_by: string | null;
  created_at: string;
  updated_at: string;
  applied_at: string | null;
}

export interface PriceBookSummary extends PriceBookRow {
  displayStatus: PriceBookDisplayStatus;
  itemCount: number;
  currencyCount: number;
  appliedByName: string | null;
}

const dateOf = (value: unknown): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

function normalize(row: Record<string, any>): PriceBookRow {
  return { ...(row as PriceBookRow), effective_date: dateOf(row.effective_date) };
}

/** The derived active price book: the applied one with the greatest effective date on or before today. */
export function deriveActivePriceBookId(
  books: ReadonlyArray<Pick<PriceBookRow, 'price_book_id' | 'effective_date' | 'status'>>,
  today: string = todayCalendarDate(),
): string | null {
  let active: { id: string; date: string } | null = null;
  for (const book of books) {
    if (book.status !== 'scheduled' && book.status !== 'superseded') continue;
    const date = dateOf(book.effective_date);
    if (date > today) continue;
    if (!active || date > active.date) active = { id: book.price_book_id, date };
  }
  return active?.id ?? null;
}

export function priceBookDisplayStatus(
  book: Pick<PriceBookRow, 'price_book_id' | 'effective_date' | 'status'>,
  activeId: string | null,
  today: string = todayCalendarDate(),
): PriceBookDisplayStatus {
  if (book.status === 'draft') return 'draft';
  if (book.price_book_id === activeId) return 'active';
  return dateOf(book.effective_date) > today ? 'scheduled' : 'superseded';
}

export async function getActivePriceBook(
  trx: Knex | Knex.Transaction,
  tenant: string,
  today: string = todayCalendarDate(),
): Promise<PriceBookRow | null> {
  const row = await tenantDb(trx, tenant)
    .table('catalog_price_books')
    .whereIn('status', ['scheduled', 'superseded'])
    .where('effective_date', '<=', today)
    .orderBy('effective_date', 'desc')
    .first();
  return row ? normalize(row) : null;
}

export async function getPriceBook(
  trx: Knex | Knex.Transaction,
  tenant: string,
  priceBookId: string,
): Promise<PriceBookRow | null> {
  const row = await tenantDb(trx, tenant).table('catalog_price_books').where({ price_book_id: priceBookId }).first();
  return row ? normalize(row) : null;
}

/** Every non-discarded price book with its derived status and content counts. */
export async function listPriceBooks(
  trx: Knex | Knex.Transaction,
  tenant: string,
  today: string = todayCalendarDate(),
): Promise<PriceBookSummary[]> {
  const db = tenantDb(trx, tenant);
  const books = (await db.table('catalog_price_books').whereNot('status', 'discarded').orderBy('effective_date', 'desc')).map(normalize);
  if (books.length === 0) return [];
  const counts = await db
    .table('service_prices')
    .whereIn('price_book_id', books.map((book) => book.price_book_id))
    .groupBy('price_book_id')
    .select('price_book_id')
    .select(trx.raw('COUNT(DISTINCT service_id) AS items'))
    .select(trx.raw('COUNT(DISTINCT currency_code) AS currencies'));
  const countById = new Map<string, { items: number; currencies: number }>(
    counts.map((row: any) => [String(row.price_book_id), { items: Number(row.items), currencies: Number(row.currencies) }]),
  );
  const userIds = [...new Set(books.map((book) => book.applied_by).filter((id): id is string => Boolean(id)))];
  const users = userIds.length > 0
    ? await db.table('users').whereIn('user_id', userIds).select('user_id', 'first_name', 'last_name')
    : [];
  const nameById = new Map<string, string>(
    users.map((user: any) => [String(user.user_id), `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()]),
  );
  const activeId = deriveActivePriceBookId(books, today);
  return books.map((book) => ({
    ...book,
    displayStatus: priceBookDisplayStatus(book, activeId, today),
    itemCount: countById.get(book.price_book_id)?.items ?? 0,
    currencyCount: countById.get(book.price_book_id)?.currencies ?? 0,
    appliedByName: book.applied_by ? nameById.get(book.applied_by) ?? null : null,
  }));
}

/** Lazy refresh: applied books that are no longer the latest on or before today become `superseded`. */
export async function refreshSupersededPriceBooks(
  trx: Knex.Transaction,
  tenant: string,
  today: string = todayCalendarDate(),
): Promise<void> {
  const db = tenantDb(trx, tenant);
  const applied = (await db.table('catalog_price_books').whereIn('status', ['scheduled', 'superseded'])).map(normalize);
  const activeId = deriveActivePriceBookId(applied, today);
  for (const book of applied) {
    const due = dateOf(book.effective_date) <= today && book.price_book_id !== activeId;
    const wanted: PriceBookStatus = due ? 'superseded' : 'scheduled';
    if (book.status !== wanted) {
      await db.table('catalog_price_books').where({ price_book_id: book.price_book_id }).update({ status: wanted, updated_at: trx.fn.now() });
    }
  }
}

export interface CreateDraftPriceBookInput {
  name: string;
  effectiveDate: string;
  description?: string | null;
  createdBy?: string | null;
  sourceMigrationJobId?: string | null;
  copiedFromPriceBookId?: string | null;
}

/** Date and name rules shared by creating a draft and making a book active again. */
async function assertPriceBookFree(
  trx: Knex.Transaction,
  tenant: string,
  name: string,
  effectiveDate: string,
  today: string,
): Promise<void> {
  if (!name.trim()) throw new ServiceCatalogPricingError(['A price book needs a name.']);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || Number.isNaN(Date.parse(`${effectiveDate}T00:00:00Z`))) {
    throw new ServiceCatalogPricingError(['The effective date must be a YYYY-MM-DD date.']);
  }
  if (effectiveDate < today) {
    throw new ServiceCatalogPricingError([
      `The effective date ${effectiveDate} is in the past. A price book cannot be back-dated because periods may already be billed.`,
    ]);
  }
  const db = tenantDb(trx, tenant);
  const sameName = await db.table('catalog_price_books').whereNot('status', 'discarded').whereRaw('lower(name) = ?', [name.trim().toLowerCase()]).first();
  if (sameName) throw new ServiceCatalogPricingError([`A price book named "${sameName.name}" already exists.`]);
  const sameDate = await db.table('catalog_price_books').whereIn('status', ['scheduled', 'superseded']).where({ effective_date: effectiveDate }).first();
  if (sameDate) {
    throw new ServiceCatalogPricingError([`Price book "${sameDate.name}" already takes effect on ${effectiveDate}. Pick another date.`]);
  }
}

export async function createDraftPriceBook(
  trx: Knex.Transaction,
  tenant: string,
  input: CreateDraftPriceBookInput,
  today: string = todayCalendarDate(),
): Promise<PriceBookRow> {
  const name = input.name.trim();
  await assertPriceBookFree(trx, tenant, name, input.effectiveDate, today);
  const [row] = await tenantDb(trx, tenant)
    .table('catalog_price_books')
    .insert({
      tenant,
      name,
      effective_date: input.effectiveDate,
      status: 'draft',
      description: input.description ?? null,
      source_migration_job_id: input.sourceMigrationJobId ?? null,
      copied_from_price_book_id: input.copiedFromPriceBookId ?? null,
      created_by: input.createdBy ?? null,
      updated_by: input.createdBy ?? null,
    })
    .returning('*');
  return normalize(row);
}

/**
 * Uploading the same file again must land in the same price book: an open book
 * with this name and date is reused (that is what makes the re-upload idempotent),
 * while the same name on another date is refused rather than silently moved.
 */
export async function findOrCreateDraftPriceBook(
  trx: Knex.Transaction,
  tenant: string,
  input: CreateDraftPriceBookInput,
  today: string = todayCalendarDate(),
): Promise<{ priceBook: PriceBookRow; reused: boolean }> {
  const name = input.name.trim();
  const existing = await tenantDb(trx, tenant)
    .table('catalog_price_books')
    .whereNot('status', 'discarded')
    .whereRaw('lower(name) = ?', [name.toLowerCase()])
    .first();
  if (existing) {
    const book = normalize(existing);
    if (book.effective_date === input.effectiveDate) return { priceBook: book, reused: true };
    throw new ServiceCatalogPricingError([
      `A price book named "${book.name}" already exists with the effective date ${book.effective_date}. Use another name, or the same date to add to it.`,
    ]);
  }
  return { priceBook: await createDraftPriceBook(trx, tenant, input, today), reused: false };
}

/** `draft` → `scheduled` once every row has been processed. */
export async function markPriceBookApplied(
  trx: Knex.Transaction,
  tenant: string,
  priceBookId: string,
  appliedBy: string | null,
  today: string = todayCalendarDate(),
): Promise<PriceBookRow> {
  await lockTenantBilling(trx, tenant);
  const db = tenantDb(trx, tenant);
  const book = await getPriceBook(trx, tenant, priceBookId);
  if (!book) throw new ServiceCatalogPricingError(['Price book not found.']);
  if (book.status === 'discarded') throw new ServiceCatalogPricingError(['This price book was discarded.']);
  if (book.status === 'draft') {
    const sameDate = await db.table('catalog_price_books').whereIn('status', ['scheduled', 'superseded']).where({ effective_date: book.effective_date }).first();
    if (sameDate) throw new ServiceCatalogPricingError([`Price book "${sameDate.name}" already takes effect on ${book.effective_date}.`]);
    await db.table('catalog_price_books').where({ price_book_id: priceBookId }).update({
      status: 'scheduled', applied_by: appliedBy, applied_at: trx.fn.now(), updated_by: appliedBy, updated_at: trx.fn.now(),
    });
  }
  await refreshSupersededPriceBooks(trx, tenant, today);
  return (await getPriceBook(trx, tenant, priceBookId))!;
}

/** Drafts only. A draft has no `service_prices` rows, so nothing else changes. */
export async function discardDraftPriceBook(
  trx: Knex.Transaction,
  tenant: string,
  priceBookId: string,
  actor: string | null,
): Promise<void> {
  const book = await getPriceBook(trx, tenant, priceBookId);
  if (!book) throw new ServiceCatalogPricingError(['Price book not found.']);
  if (book.status !== 'draft') {
    throw new ServiceCatalogPricingError(['Only a draft price book can be discarded. Withdraw a scheduled one instead.']);
  }
  await tenantDb(trx, tenant).table('catalog_price_books').where({ price_book_id: priceBookId })
    .update({ status: 'discarded', updated_by: actor, updated_at: trx.fn.now() });
}

/**
 * Withdraws a scheduled price book before its date: deletes its (future) rows and
 * marks it discarded. Once the date has arrived the rows are history; use "make
 * active again" on the previous price book instead.
 */
export async function withdrawScheduledPriceBook(
  trx: Knex.Transaction,
  tenant: string,
  priceBookId: string,
  actor: string | null,
  today: string = todayCalendarDate(),
): Promise<{ removedPrices: number }> {
  await lockTenantBilling(trx, tenant);
  const book = await getPriceBook(trx, tenant, priceBookId);
  if (!book) throw new ServiceCatalogPricingError(['Price book not found.']);
  if (book.status !== 'scheduled' && book.status !== 'superseded') {
    throw new ServiceCatalogPricingError(['Only a scheduled price book can be withdrawn.']);
  }
  if (book.effective_date <= today) {
    throw new ServiceCatalogPricingError([
      `Price book "${book.name}" took effect on ${book.effective_date}; its prices are history. Use "Make active again" on the previous price book instead.`,
    ]);
  }
  const db = tenantDb(trx, tenant);
  const removedPrices = Number(
    await db.table('service_prices').where({ price_book_id: priceBookId }).where('effective_date', '>', today).del(),
  );
  await db.table('catalog_price_books').where({ price_book_id: priceBookId })
    .update({ status: 'discarded', updated_by: actor, updated_at: trx.fn.now() });
  await refreshSupersededPriceBooks(trx, tenant, today);
  return { removedPrices };
}

export interface CatalogAsOfRow {
  serviceId: string;
  itemKind: string;
  name: string;
  sku: string | null;
  currency: string;
  rateMinor: number;
  priceBookId: string | null;
  /** True when this price book's own row supplies the rate; false when carried forward from earlier. */
  fromThisPriceBook: boolean;
}

/** The catalog as it stands on `asOf`: the latest row per (item, currency) dated on or before it. */
export async function loadCatalogAsOf(
  trx: Knex | Knex.Transaction,
  tenant: string,
  asOf: string,
  priceBookId: string | null,
): Promise<CatalogAsOfRow[]> {
  const db = tenantDb(trx, tenant);
  const rows = await db
    .tenantJoin(db.table('service_prices as sp'), 'service_catalog as sc', 'sp.service_id', 'sc.service_id')
    .where('sp.effective_date', '<=', asOf)
    .select('sp.service_id', 'sp.currency_code', 'sp.rate', 'sp.effective_date', 'sp.price_book_id', 'sp.display_order', 'sc.service_name', 'sc.sku', 'sc.item_kind')
    .orderBy([{ column: 'sc.service_name' }, { column: 'sp.display_order' }, { column: 'sp.currency_code' }, { column: 'sp.effective_date', order: 'desc' }]);
  const seen = new Set<string>();
  const result: CatalogAsOfRow[] = [];
  for (const row of rows as any[]) {
    const key = `${row.service_id}|${row.currency_code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      serviceId: String(row.service_id),
      itemKind: row.item_kind,
      name: row.service_name,
      sku: row.sku ?? null,
      currency: row.currency_code,
      rateMinor: Number(row.rate),
      priceBookId: row.price_book_id ?? null,
      fromThisPriceBook: Boolean(priceBookId) && row.price_book_id === priceBookId,
    });
  }
  return result;
}
