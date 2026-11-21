import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isSupportedCurrency } from '@alga-psa/core/formatters';
import {
  AMP_PRICE_ERROR_EXTENSION_KEY,
  AMP_PRICE_TEXT_EXTENSION_KEY,
  type AmpCatalogPriceRecord,
  type AmpProductRecord,
  type AmpServiceRecord,
} from '@alga-psa/migration-spec';
import {
  catalogPriceRowKey,
  describeCatalogCandidate,
  resolveCatalogItemKey,
  type CatalogIndex,
  type CatalogItemKeyRow,
  type CatalogItemResolution,
} from '@alga-psa/billing/lib/catalog/catalogItemKey';
import { loadCatalogIndex } from '@alga-psa/billing/lib/catalog/catalogItemIndex';
import { getPriceBook } from '@alga-psa/billing/lib/catalog/priceBooks';
import { todayCalendarDate } from '@alga-psa/billing/lib/catalog/serviceCatalogPricing';
import { getTenantDefaultCurrency } from '@alga-psa/billing/lib/catalog/tenantDefaultCurrency';
import {
  CATALOG_PRICE_ALREADY_EFFECTIVE,
  CATALOG_PRICE_OUTCOMES,
  type CatalogPriceOutcome,
  type CatalogPricePlan,
  type CatalogPricePlanRow,
  type MigrationJobConfiguration,
  type PreflightIssue,
} from './types';

/** A staged record the planner marks blocked, with the reason the operator sees. */
export interface CatalogPriceBlock {
  entityType: 'catalog_prices' | 'products' | 'services';
  packageRecordId: string;
  code: string;
  message: string;
}

export interface CatalogPricePlanResult {
  plan: CatalogPricePlan;
  blocks: CatalogPriceBlock[];
  issues: PreflightIssue[];
  /** Services records that will be created (they need a service type and billing method). */
  servicesToCreate: number;
  /** Services records that match an existing service (mapped and left unchanged). */
  servicesMatched: number;
}

interface StagedRow<T> {
  packageRecordId: string;
  sourceRecordId: string;
  payload: T;
  alreadyMapped: boolean;
}

const SAMPLE_LIMIT = 20;
const ROW_ID = /^row-(\d+)(?:-(.+))?$/;

export function sourceRowOf(sourceRecordId: string): number {
  const match = ROW_ID.exec(sourceRecordId);
  return match ? Number(match[1]) : 0;
}

function parsePayload<T>(raw: unknown): T {
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
}

function readPriceExtension(extensionJson: string | null | undefined): { text: string | null; error: string | null } {
  if (!extensionJson) return { text: null, error: null };
  try {
    const parsed = JSON.parse(extensionJson) as Record<string, unknown>;
    const text = parsed?.[AMP_PRICE_TEXT_EXTENSION_KEY];
    const error = parsed?.[AMP_PRICE_ERROR_EXTENSION_KEY];
    return { text: typeof text === 'string' ? text : null, error: typeof error === 'string' ? error : null };
  } catch {
    return { text: null, error: null };
  }
}

const PRICE_ERROR_MESSAGES: Record<string, string> = {
  currency_unresolved: 'The price has no currency and neither the job nor the tenant has a default currency.',
  currency_unsupported: 'The currency is not a supported ISO 4217 code.',
  negative: 'Negative prices are not allowed.',
  precision: 'The price has more decimal places than its currency allows.',
  invalid: 'The price is not a plain decimal amount.',
  overflow: 'The price is too large.',
};

async function loadStaged<T>(
  db: ReturnType<typeof tenantDb>,
  migrationJobId: string,
  entityType: string,
): Promise<Array<StagedRow<T>>> {
  const rows = await db
    .table('migration_staged_records as s')
    .leftJoin('migration_identity_mappings as m', function join() {
      this.on('m.tenant', 's.tenant')
        .andOn('m.namespace', 's.namespace')
        .andOn('m.entity_type', 's.entity_type')
        .andOn('m.source_record_id', 's.source_record_id');
    })
    .where({ 's.migration_job_id': migrationJobId, 's.entity_type': entityType })
    .orderBy('s.package_record_id')
    .select('s.package_record_id', 's.source_record_id', 's.payload', 'm.source_record_id as mapped_source_record_id');
  return rows.map((row: any) => ({
    packageRecordId: row.package_record_id,
    sourceRecordId: row.source_record_id,
    payload: parsePayload<T>(row.payload),
    alreadyMapped: row.mapped_source_record_id !== null && row.mapped_source_record_id !== undefined,
  }));
}

function keyOf(record: AmpCatalogPriceRecord, linked: AmpProductRecord | AmpServiceRecord | undefined, kind: 'product' | 'service' | null): CatalogItemKeyRow {
  return {
    itemRef: record.item_ref,
    itemKind: kind,
    sku: record.sku ?? linked?.sku ?? null,
    name: record.name ?? linked?.name ?? null,
    serviceTypeName: record.service_type_name ?? (linked as AmpServiceRecord | undefined)?.service_type_name ?? null,
  };
}

const emptyCounts = (): Record<CatalogPriceOutcome, number> =>
  Object.fromEntries(CATALOG_PRICE_OUTCOMES.map((outcome) => [outcome, 0])) as Record<CatalogPriceOutcome, number>;

/**
 * Resolves every staged price row to one outcome (create / update / unchanged /
 * unmatched / ambiguous / conflict / invalid), using the same
 * `resolveCatalogItemKey` the applier calls. Reads only; the caller applies the
 * returned blocks to staging. Blocked rows never run at apply time, and do not
 * stop the rest of the job.
 */
export async function planCatalogPrices(
  knex: Knex,
  tenant: string,
  migrationJobId: string,
  configuration: MigrationJobConfiguration,
): Promise<CatalogPricePlanResult> {
  const db = tenantDb(knex, tenant);
  const issues: PreflightIssue[] = [];
  const blocks: CatalogPriceBlock[] = [];
  const today = todayCalendarDate();

  const prices = await loadStaged<AmpCatalogPriceRecord>(db, migrationJobId, 'catalog_prices');
  const products = await loadStaged<AmpProductRecord>(db, migrationJobId, 'products');
  const services = await loadStaged<AmpServiceRecord>(db, migrationJobId, 'services');
  const productById = new Map(products.map((row) => [row.packageRecordId, row]));
  const serviceById = new Map(services.map((row) => [row.packageRecordId, row]));

  // ---- price book
  const config = configuration.priceBook;
  let effectiveDate: string | null = null;
  if (prices.length > 0) {
    const book = config ? await getPriceBook(knex, tenant, config.priceBookId) : null;
    if (!config) {
      issues.push({ severity: 'blocking', code: 'CONFIG_PRICE_BOOK_MISSING', message: 'Prices are staged but no price book is configured for this job.', entityType: 'catalog_prices' });
    } else if (!book || (book.status !== 'draft' && book.status !== 'scheduled')) {
      issues.push({ severity: 'blocking', code: 'CONFIG_PRICE_BOOK_NOT_FOUND', message: 'The price book for this job does not exist or is no longer open for changes.', entityType: 'catalog_prices' });
    } else {
      effectiveDate = book.effective_date;
      if (effectiveDate < today) {
        issues.push({ severity: 'blocking', code: 'CONFIG_PRICE_BOOK_DATE_PAST', message: `The price book effective date ${effectiveDate} is in the past; a price book cannot be back-dated.`, entityType: 'catalog_prices' });
      }
    }
  }

  // ---- resolve every item key with the shared resolver
  const pendingPrices = prices.filter((row) => !row.alreadyMapped);
  const pendingItems = [...products, ...services].filter((row) => !row.alreadyMapped);
  const keyRows: CatalogItemKeyRow[] = [
    ...pendingPrices.map((row) => keyOf(row.payload, linkedItem(row.payload), row.payload.item_kind ?? null)),
    ...pendingItems.map((row) => itemKeyOf(row, productById.has(row.packageRecordId) ? 'product' : 'service')),
  ];
  const index: CatalogIndex = await loadCatalogIndex(knex, tenant, keyRows);

  function linkedItem(record: AmpCatalogPriceRecord): AmpProductRecord | AmpServiceRecord | undefined {
    if (record.service_package_record_id) return serviceById.get(record.service_package_record_id)?.payload;
    if (record.product_package_record_id) return productById.get(record.product_package_record_id)?.payload;
    return undefined;
  }

  function itemKeyOf(row: StagedRow<AmpProductRecord | AmpServiceRecord>, kind: 'product' | 'service'): CatalogItemKeyRow {
    const payload = row.payload as AmpProductRecord & AmpServiceRecord;
    return { itemKind: kind, sku: payload.sku, name: payload.name, serviceTypeName: kind === 'service' ? payload.service_type_name : null };
  }

  const itemResolutions = new Map<string, CatalogItemResolution>();
  for (const row of pendingItems) {
    const kind = productById.has(row.packageRecordId) ? 'product' : 'service';
    itemResolutions.set(row.packageRecordId, resolveCatalogItemKey(itemKeyOf(row, kind), index, { allowCreate: true }));
  }

  // ---- rates in effect on the price book date, for the matched items
  const matchedIds = new Set<string>();
  const resolutions = new Map<string, CatalogItemResolution>();
  for (const row of pendingPrices) {
    const linked = linkedItem(row.payload);
    const resolution = resolveCatalogItemKey(keyOf(row.payload, linked, row.payload.item_kind ?? null), index, { allowCreate: true });
    resolutions.set(row.packageRecordId, resolution);
    if (resolution.outcome === 'matched') matchedIds.add(resolution.item.serviceId);
  }
  type RateRow = { service_id: string; currency_code: string; rate: number; effective_date: string; price_book_id: string | null };
  const ratesByKey = new Map<string, RateRow[]>();
  if (effectiveDate && matchedIds.size > 0) {
    const ids = [...matchedIds];
    for (let offset = 0; offset < ids.length; offset += 1000) {
      const chunk = ids.slice(offset, offset + 1000);
      const rows = await db.table('service_prices').whereIn('service_id', chunk).where('effective_date', '<=', effectiveDate)
        .orderBy('effective_date', 'desc')
        .select('service_id', 'currency_code', 'rate', 'effective_date', 'price_book_id');
      for (const row of rows as any[]) {
        const key = `${row.service_id}|${row.currency_code}`;
        const list = ratesByKey.get(key) ?? [];
        list.push({
          service_id: row.service_id,
          currency_code: row.currency_code,
          rate: Number(row.rate),
          effective_date: row.effective_date instanceof Date ? row.effective_date.toISOString().slice(0, 10) : String(row.effective_date).slice(0, 10),
          price_book_id: row.price_book_id ?? null,
        });
        ratesByKey.set(key, list);
      }
    }
  }

  // ---- duplicates: the same item (or the same new item) and currency twice in the file
  const tenantDefault = await getTenantDefaultCurrency(knex, tenant);
  const jobCurrency = config?.currency ?? tenantDefault;
  const resolvedCurrency = (row: StagedRow<AmpCatalogPriceRecord>): string | null => {
    const code = row.payload.currency || jobCurrency || null;
    return code && isSupportedCurrency(code) ? code : null;
  };
  const groups = new Map<string, string[]>();
  for (const row of pendingPrices) {
    const currency = resolvedCurrency(row);
    const resolution = resolutions.get(row.packageRecordId);
    if (!currency || !resolution) continue;
    const key = catalogPriceRowKey(resolution, currency);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), row.packageRecordId]);
  }
  const duplicateRows = new Map<string, number[]>();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const rowNumbers = members.map((id) => sourceRowOf(prices.find((row) => row.packageRecordId === id)!.sourceRecordId));
    for (const id of members) duplicateRows.set(id, rowNumbers);
  }

  // ---- one plan row per staged price row
  const rows: CatalogPricePlanRow[] = [];
  const addBlock = (row: StagedRow<AmpCatalogPriceRecord>, code: string, message: string) => {
    blocks.push({ entityType: 'catalog_prices', packageRecordId: row.packageRecordId, code, message });
    for (const [pkg, kind] of [[row.payload.product_package_record_id, 'products'], [row.payload.service_package_record_id, 'services']] as const) {
      if (pkg) blocks.push({ entityType: kind, packageRecordId: pkg, code, message });
    }
  };

  for (const row of prices) {
    const record = row.payload;
    const linked = linkedItem(record);
    const base: CatalogPricePlanRow = {
      packageRecordId: row.packageRecordId,
      sourceRow: sourceRowOf(row.sourceRecordId),
      outcome: 'unchanged',
      code: null,
      message: null,
      itemName: record.name ?? linked?.name ?? null,
      itemKind: record.item_kind ?? (record.service_package_record_id ? 'service' : record.product_package_record_id ? 'product' : null),
      currency: record.currency ?? jobCurrency ?? null,
      currentRateMinor: null,
      newRateMinor: record.rate_minor ?? null,
      candidates: [],
      warnings: [],
      matchedItemId: null,
      alreadyApplied: false,
    };

    if (row.alreadyMapped) {
      rows.push({ ...base, outcome: 'unchanged', alreadyApplied: true, message: 'Already applied.' });
      continue;
    }

    const priceError = readPriceExtension(record.extension_json);
    if (priceError.error) {
      const message = PRICE_ERROR_MESSAGES[priceError.error] ?? 'The price could not be read.';
      const code = priceError.error === 'currency_unresolved' ? 'CONFIG_TENANT_CURRENCY_MISSING' : 'CATALOG_PRICE_INVALID';
      rows.push({ ...base, outcome: 'invalid', code, message: `${message} (${priceError.text ?? ''})` });
      addBlock(row, code, message);
      continue;
    }
    const currency = resolvedCurrency(row);
    if (!currency || record.rate_minor === null || record.rate_minor === undefined) {
      rows.push({ ...base, outcome: 'invalid', code: 'CATALOG_PRICE_INVALID', message: 'The price has no usable amount or currency.' });
      addBlock(row, 'CATALOG_PRICE_INVALID', 'The price has no usable amount or currency.');
      continue;
    }
    base.currency = currency;

    const resolution = resolutions.get(row.packageRecordId)!;
    const duplicate = duplicateRows.get(row.packageRecordId);
    if (duplicate) {
      const message = `Rows ${duplicate.join(', ')} price the same item in ${currency}; none of them was imported.`;
      rows.push({ ...base, outcome: 'invalid', code: 'CATALOG_PRICE_DUPLICATE_ROW', message });
      addBlock(row, 'CATALOG_PRICE_DUPLICATE_ROW', message);
      continue;
    }

    if (resolution.outcome === 'unmatched') {
      rows.push({ ...base, outcome: 'unmatched', code: 'CATALOG_PRICE_UNMATCHED', message: resolution.reason });
      addBlock(row, 'CATALOG_PRICE_UNMATCHED', resolution.reason);
      continue;
    }
    if (resolution.outcome === 'ambiguous') {
      const candidates = resolution.candidates.map(describeCatalogCandidate);
      const message = `${candidates.length} items match; add an Item ref to the file to pick one.`;
      rows.push({ ...base, outcome: 'ambiguous', code: 'CATALOG_ITEM_AMBIGUOUS', message, candidates });
      addBlock(row, 'CATALOG_ITEM_AMBIGUOUS', message);
      continue;
    }
    if (resolution.outcome === 'conflict') {
      const candidates = resolution.items.map(describeCatalogCandidate);
      rows.push({ ...base, outcome: 'conflict', code: 'CATALOG_ITEM_CONFLICT', message: resolution.reason, candidates });
      addBlock(row, 'CATALOG_ITEM_CONFLICT', resolution.reason);
      continue;
    }

    if (resolution.outcome === 'create') {
      if (!record.product_package_record_id && !record.service_package_record_id) {
        const message = 'No existing item matches, and the row has no name to create one.';
        rows.push({ ...base, outcome: 'unmatched', code: 'CATALOG_PRICE_UNMATCHED', message });
        addBlock(row, 'CATALOG_PRICE_UNMATCHED', message);
        continue;
      }
      rows.push({ ...base, outcome: 'create', itemKind: resolution.kind, warnings: resolution.warnings, message: 'Creates a new item.' });
      continue;
    }

    // matched
    const item = resolution.item;
    base.itemName = item.name;
    base.itemKind = item.itemKind;
    base.matchedItemId = item.serviceId;
    base.warnings = [...resolution.warnings];
    if (!item.isActive) base.warnings.push('This item is inactive.');
    const inactiveFlag = (linked as AmpProductRecord | undefined)?.is_active === 0;
    if (inactiveFlag) base.warnings.push('The file marks this item inactive; matched items are left unchanged and only the price is imported.');

    const history = ratesByKey.get(`${item.serviceId}|${currency}`) ?? [];
    const atDate = history.find((entry) => entry.effective_date === effectiveDate);
    const inEffect = history[0] ?? null; // newest first, all on or before the date
    base.currentRateMinor = inEffect ? inEffect.rate : null;

    if (atDate) {
      if (atDate.price_book_id !== null && atDate.price_book_id === config?.priceBookId) {
        if (atDate.rate === record.rate_minor) {
          rows.push({ ...base, outcome: 'unchanged', alreadyApplied: true, message: 'Already in this price book.' });
        } else if (effectiveDate! > today) {
          rows.push({ ...base, outcome: 'update', currentRateMinor: atDate.rate, message: 'Revises a price in this price book that has not taken effect yet.' });
        } else {
          const message = 'This price book row is already in effect; use a new price book with a later date.';
          rows.push({ ...base, outcome: 'invalid', code: CATALOG_PRICE_ALREADY_EFFECTIVE, message });
          addBlock(row, CATALOG_PRICE_ALREADY_EFFECTIVE, message);
        }
      } else {
        const message = 'The catalog already has a price for this item and currency on that date from another source.';
        rows.push({ ...base, outcome: 'invalid', code: 'CATALOG_PRICE_DATE_TAKEN', message });
        addBlock(row, 'CATALOG_PRICE_DATE_TAKEN', message);
      }
      continue;
    }
    const outcome: CatalogPriceOutcome = !inEffect ? 'create' : inEffect.rate === record.rate_minor ? 'unchanged' : 'update';
    rows.push({ ...base, outcome, message: outcome === 'unchanged' ? 'Same as the price in effect; written so the price book is complete.' : null });
  }

  // Item-only rows that resolve ambiguously also block their own record.
  for (const row of pendingItems) {
    const resolution = itemResolutions.get(row.packageRecordId);
    const entityType = productById.has(row.packageRecordId) ? 'products' : 'services';
    if (resolution?.outcome === 'ambiguous' && !blocks.some((b) => b.entityType === entityType && b.packageRecordId === row.packageRecordId)) {
      blocks.push({ entityType, packageRecordId: row.packageRecordId, code: 'CATALOG_ITEM_AMBIGUOUS', message: `${resolution.candidates.length} items match; add an Item ref to the file to pick one.` });
    }
  }

  rows.sort((a, b) => a.sourceRow - b.sourceRow || (a.currency ?? '').localeCompare(b.currency ?? ''));
  const counts = emptyCounts();
  for (const row of rows) counts[row.outcome] += 1;

  // ---- issues: blocked rows are warnings (the rest of the job still applies)
  const byCode = new Map<string, CatalogPricePlanRow[]>();
  for (const row of rows) if (row.code) byCode.set(row.code, [...(byCode.get(row.code) ?? []), row]);
  for (const [code, list] of byCode) {
    const blocking = code === 'CONFIG_TENANT_CURRENCY_MISSING';
    issues.push({
      severity: blocking ? 'blocking' : 'warning',
      code,
      message: blocking
        ? `${list.length} price(s) have no currency and neither the job nor the tenant has a default currency; set one in billing settings or add a currency column.`
        : `${list.length} price row(s) will not be imported (${code}).`,
      entityType: 'catalog_prices',
      recordCount: list.length,
      sampleRecordIds: list.slice(0, SAMPLE_LIMIT).map((row) => row.packageRecordId),
    });
  }
  const newServices = pendingItems.filter(
    (row) => !productById.has(row.packageRecordId) && itemResolutions.get(row.packageRecordId)?.outcome === 'create'
      && !blocks.some((b) => b.entityType === 'services' && b.packageRecordId === row.packageRecordId),
  ).length;
  const servicesMatched = pendingItems.filter(
    (row) => !productById.has(row.packageRecordId) && itemResolutions.get(row.packageRecordId)?.outcome === 'matched',
  ).length;

  return {
    plan: { priceBookId: config?.priceBookId ?? null, effectiveDate, counts, rows, plannedAt: new Date().toISOString() },
    blocks,
    issues,
    servicesToCreate: newServices,
    servicesMatched,
  };
}
