import { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { QboClientService } from '@alga-psa/integrations/lib/qbo/qboClientService';
import type { QboItem } from '@alga-psa/integrations/lib/qbo/types';
import Service from '../../models/service';
import { SyncMappingLedger } from './syncMappingLedger';
import { SyncCycleRepository } from './syncCycleRepository';
import {
  resolveQboItems,
  type ExistingItemMappingRow,
  type ExistingServiceRow,
  type ItemResolution,
  type QboItemImportDefaults
} from './qboItemResolver';

/**
 * One-time bulk import of QBO Items into service_catalog — a bulk run of the
 * same resolve/apply machinery Item CDC will later feed one change at a time.
 * Preview never writes; execute re-fetches and re-resolves (a stale preview
 * is advisory, not a contract), applies row-by-row in per-row transactions,
 * and seeds an item-scoped sync-cycle cursor so a future Item CDC cycle
 * continues without gap or re-import.
 */

const SYNC_ADAPTER_TYPE = 'quickbooks_online';
// Item CDC gets its own cursor namespace: seeding under 'quickbooks_online'
// would advance the shared accounting sync cursor and make runAccountingSyncCycle
// skip unrelated QBO changes (invoices, payments) between its real cursor and
// the import time.
const ITEM_SYNC_ADAPTER_TYPE = 'quickbooks_online_items';
const IMPORTED_ITEM_TYPES = "('Service', 'NonInventory', 'Inventory', 'Category')";

export interface QboItemImportOptions {
  includeInactive: boolean;
  defaults: Omit<QboItemImportDefaults, 'currencyCode'>;
}

export interface QboItemImportPreviewRow {
  qboItemId: string;
  qboName: string;
  qboFullyQualifiedName: string | null;
  qboType: QboItem['Type'];
  action: ItemResolution['action'];
  matchedServiceId: string | null;
  fields: ItemResolution['fields'] | null;
  fieldChanges: ItemResolution['fieldChanges'] | null;
  flags: ItemResolution['flags'];
  reason: string | null;
}

export interface QboItemImportPreview {
  realm: string;
  currencyCode: string;
  totalQboItems: number;
  summary: { create: number; update: number; link: number; skip: number };
  rows: QboItemImportPreviewRow[];
}

export interface QboItemImportResult {
  created: number;
  updated: number;
  linked: number;
  skipped: number;
  errors: Array<{ qboItemId: string; qboName: string; message: string }>;
}

async function fetchQboItemsPaged(
  qboClient: QboClientService,
  includeInactive: boolean
): Promise<QboItem[]> {
  const PAGE_SIZE = 1000;
  const results: QboItem[] = [];
  let startPosition = 1;

  // Without an explicit Active filter QBO only returns active items.
  const activeFilter = includeInactive ? ' AND Active IN (true, false)' : '';

  while (true) {
    const query = `SELECT * FROM Item WHERE Type IN ${IMPORTED_ITEM_TYPES}${activeFilter} STARTPOSITION ${startPosition} MAXRESULTS ${PAGE_SIZE}`;
    const page = await qboClient.query<QboItem>(query);
    results.push(...page);
    if (page.length < PAGE_SIZE) break;
    startPosition += PAGE_SIZE;
  }

  return results;
}

async function getHomeCurrency(qboClient: QboClientService): Promise<string> {
  try {
    const prefs = await qboClient.getPreferences<any>();
    return prefs?.CurrencyPrefs?.HomeCurrency?.value ?? 'USD';
  } catch (error) {
    logger.warn('[qboItemImport] Failed to read QBO preferences; defaulting currency to USD', {
      error: error instanceof Error ? error.message : error
    });
    return 'USD';
  }
}

/** QBO TaxCode id → Alga tax_rate_id, via the tax_code mapping ledger and active tax_rates. */
async function buildTaxRateMap(knex: Knex, tenant: string, realm: string): Promise<Map<string, string>> {
  const db = tenantDb(knex, tenant);

  const taxMappings: Array<{ alga_entity_id: string; external_entity_id: string }> =
    await db.table('tenant_external_entity_mappings')
      .where({
        integration_type: SYNC_ADAPTER_TYPE,
        alga_entity_type: 'tax_code',
        external_realm_id: realm
      })
      .select('alga_entity_id', 'external_entity_id');

  if (taxMappings.length === 0) return new Map();

  const regionCodes = Array.from(new Set(taxMappings.map((m) => m.alga_entity_id)));
  const rates: Array<{ tax_rate_id: string; region_code: string }> = await db.table('tax_rates')
    .whereIn('region_code', regionCodes)
    .where({ is_active: true })
    .select('tax_rate_id', 'region_code');

  const rateByRegion = new Map(rates.map((r) => [r.region_code, r.tax_rate_id]));
  const map = new Map<string, string>();
  for (const mapping of taxMappings) {
    const rateId = rateByRegion.get(mapping.alga_entity_id);
    if (rateId) map.set(mapping.external_entity_id, rateId);
  }
  return map;
}

async function loadExistingCatalog(knex: Knex, tenant: string): Promise<ExistingServiceRow[]> {
  return tenantDb(knex, tenant).table('service_catalog')
    .select('service_id', 'service_name', 'item_kind', 'sku', 'description', 'default_rate', 'cost', 'is_active');
}

async function loadExistingItemMappings(
  knex: Knex,
  tenant: string,
  realm: string
): Promise<ExistingItemMappingRow[]> {
  return tenantDb(knex, tenant).table('tenant_external_entity_mappings')
    .where({
      integration_type: SYNC_ADAPTER_TYPE,
      alga_entity_type: 'service',
      external_realm_id: realm
    })
    .select('id', 'alga_entity_id', 'external_entity_id');
}

async function resolveAll(params: {
  knex: Knex;
  tenant: string;
  realm: string;
  options: QboItemImportOptions;
}): Promise<{ resolutions: ItemResolution[]; currencyCode: string; qboItems: QboItem[] }> {
  const { knex, tenant, realm, options } = params;

  const qboClient = await QboClientService.create(tenant, realm);
  const [qboItems, currencyCode, existingServices, existingMappings, taxRateMap] = await Promise.all([
    fetchQboItemsPaged(qboClient, options.includeInactive),
    getHomeCurrency(qboClient),
    loadExistingCatalog(knex, tenant),
    loadExistingItemMappings(knex, tenant, realm),
    buildTaxRateMap(knex, tenant, realm)
  ]);

  const resolutions = resolveQboItems(qboItems, existingServices, existingMappings, taxRateMap);
  return { resolutions, currencyCode, qboItems };
}

export async function previewQboItemImportForTenant(params: {
  tenant: string;
  realm: string;
  options: QboItemImportOptions;
}): Promise<QboItemImportPreview> {
  const { knex } = await createTenantKnex();
  const { resolutions, currencyCode, qboItems } = await resolveAll({ knex, ...params });

  const summary = { create: 0, update: 0, link: 0, skip: 0 };
  const rows: QboItemImportPreviewRow[] = resolutions.map((resolution) => {
    summary[resolution.action] += 1;
    return {
      qboItemId: resolution.qboItem.Id,
      qboName: resolution.qboItem.Name,
      qboFullyQualifiedName: resolution.qboItem.FullyQualifiedName ?? null,
      qboType: resolution.qboItem.Type,
      action: resolution.action,
      matchedServiceId: resolution.matchedServiceId ?? null,
      fields: resolution.fields ?? null,
      fieldChanges: resolution.fieldChanges ?? null,
      flags: resolution.flags,
      reason: resolution.reason ?? null
    };
  });

  return { realm: params.realm, currencyCode, totalQboItems: qboItems.length, summary, rows };
}

function mappingMetadataFor(item: QboItem): Record<string, unknown> {
  return {
    syncToken: item.SyncToken ?? null,
    lastUpdatedTime: item.MetaData?.LastUpdatedTime ?? null,
    incomeAccountId: item.IncomeAccountRef?.value ?? null,
    expenseAccountId: item.ExpenseAccountRef?.value ?? null,
    qboType: item.Type,
    fullyQualifiedName: item.FullyQualifiedName ?? null,
    importedAt: new Date().toISOString()
  };
}

async function publishCatalogSearchEvent(
  eventType: 'SERVICE_CATALOG_CREATED' | 'SERVICE_CATALOG_UPDATED',
  tenant: string,
  serviceId: string,
  itemKind: 'service' | 'product',
  userId: string | undefined,
  changedFields: string[]
): Promise<void> {
  try {
    await publishEvent({
      eventType,
      payload: {
        tenantId: tenant,
        serviceId,
        userId,
        itemKind,
        changedFields,
        timestamp: new Date().toISOString()
      }
    });
  } catch (eventError) {
    logger.warn(`[qboItemImport] Failed to publish ${eventType} search event`, {
      tenant,
      serviceId,
      error: eventError instanceof Error ? eventError.message : eventError
    });
  }
}

async function applyResolution(params: {
  knex: Knex;
  tenant: string;
  realm: string;
  resolution: ItemResolution;
  defaults: QboItemImportDefaults;
  userId?: string;
}): Promise<'created' | 'updated' | 'linked'> {
  const { knex, tenant, realm, resolution, defaults, userId } = params;
  const fields = resolution.fields!;

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const ledger = new SyncMappingLedger(trx, tenant, SYNC_ADAPTER_TYPE);
    const metadata = mappingMetadataFor(resolution.qboItem);

    const upsertLedger = async (serviceId: string) => {
      // No upsert helper on the ledger — re-check inside the transaction so a
      // re-run of the import updates rather than duplicates.
      const existing = resolution.existingMappingId
        ? { id: resolution.existingMappingId }
        : await ledger.findByExternalId('service', resolution.qboItem.Id, realm);
      if (existing) {
        await trx('tenant_external_entity_mappings')
          .where({ id: existing.id })
          .update({
            alga_entity_id: serviceId,
            sync_status: 'synced',
            last_synced_at: trx.fn.now(),
            metadata,
            updated_at: trx.fn.now()
          });
      } else {
        await ledger.insert({
          algaEntityType: 'service',
          algaEntityId: serviceId,
          externalEntityId: resolution.qboItem.Id,
          targetRealm: realm,
          syncStatus: 'synced',
          metadata
        });
      }
    };

    if (resolution.action === 'create') {
      const service = await Service.create(trx, {
        tenant,
        service_name: fields.service_name,
        custom_service_type_id: defaults.serviceTypeId,
        billing_method:
          fields.item_kind === 'product' ? defaults.productBillingMethod : defaults.serviceBillingMethod,
        default_rate: fields.default_rate,
        unit_of_measure: defaults.unitOfMeasure,
        category_id: null,
        item_kind: fields.item_kind,
        is_active: fields.is_active,
        sku: fields.sku,
        description: fields.description,
        cost: fields.cost,
        cost_currency: fields.cost !== null ? defaults.currencyCode : null,
        tax_rate_id: fields.tax_rate_id
      } as any);

      await upsertLedger(service.service_id);
      await publishCatalogSearchEvent('SERVICE_CATALOG_CREATED', tenant, service.service_id, fields.item_kind, userId, Object.keys(fields));
      return 'created';
    }

    const serviceId = resolution.matchedServiceId!;

    if (resolution.action === 'update') {
      // QBO-authoritative fields only; billing_method / unit_of_measure /
      // service type / category stay untouched.
      const patch: Record<string, unknown> = {};
      for (const change of resolution.fieldChanges ?? []) {
        patch[change.field] = change.to;
      }
      if (fields.cost !== null) {
        patch.cost_currency = defaults.currencyCode;
      }
      await Service.update(trx, serviceId, patch as any);
      await upsertLedger(serviceId);
      await publishCatalogSearchEvent('SERVICE_CATALOG_UPDATED', tenant, serviceId, fields.item_kind, userId, Object.keys(patch));
      return 'updated';
    }

    await upsertLedger(serviceId);
    return 'linked';
  });
}

export async function executeQboItemImportForTenant(params: {
  tenant: string;
  realm: string;
  options: QboItemImportOptions;
  userId?: string;
}): Promise<QboItemImportResult> {
  const { tenant, realm, options, userId } = params;
  const { knex } = await createTenantKnex();
  const importStartedAt = new Date().toISOString();

  const { resolutions, currencyCode } = await resolveAll({ knex, tenant, realm, options });
  const defaults: QboItemImportDefaults = { ...options.defaults, currencyCode };

  const result: QboItemImportResult = { created: 0, updated: 0, linked: 0, skipped: 0, errors: [] };

  for (const resolution of resolutions) {
    if (resolution.action === 'skip') {
      result.skipped += 1;
      continue;
    }

    // Transaction per row (Xero CSV precedent): one bad row is reported, not
    // allowed to abort the batch.
    try {
      const outcome = await applyResolution({ knex, tenant, realm, resolution, defaults, userId });
      if (outcome === 'created') result.created += 1;
      else if (outcome === 'updated') result.updated += 1;
      else result.linked += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to apply item';
      result.errors.push({
        qboItemId: resolution.qboItem.Id,
        qboName: resolution.qboItem.Name,
        message
      });
      logger.error('[qboItemImport] Failed to apply QBO item', {
        tenant, realm, qboItemId: resolution.qboItem.Id, error: message
      });
    }
  }

  // Seed the CDC cursor: the first Item CDC cycle should pick up right after
  // what this import saw (CURSOR_OVERLAP_MS absorbs the boundary).
  try {
    const lastUpdatedTimes = resolutions
      .map((r) => r.qboItem.MetaData?.LastUpdatedTime)
      .filter((t): t is string => Boolean(t));
    const cursorAfter = [importStartedAt, ...lastUpdatedTimes]
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
      .pop()!;

    const cycles = new SyncCycleRepository(knex);
    const cycleId = await cycles.startCycle({
      tenant,
      adapterType: ITEM_SYNC_ADAPTER_TYPE,
      targetRealm: realm,
      cursorBefore: null
    });
    await cycles.finishCycle(tenant, cycleId, { status: 'succeeded', cursorAfter });
  } catch (error) {
    logger.warn('[qboItemImport] Failed to seed sync-cycle cursor after import', {
      tenant, realm, error: error instanceof Error ? error.message : error
    });
  }

  logger.info('[qboItemImport] Import complete', { tenant, realm, ...result, errorCount: result.errors.length });
  return result;
}
