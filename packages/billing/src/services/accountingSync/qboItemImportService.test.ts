/**
 * Mock-based unit tests for qboItemImportService.
 *
 * Covers the behaviors the resolver tests can't see:
 *  - paged QBO fetch assembly (STARTPOSITION/MAXRESULTS, active filter)
 *  - currency: minor-unit conversion already in the resolver; here the
 *    home-currency lookup feeding cost_currency
 *  - per-row transaction error isolation (one bad row reported, batch continues)
 *  - ledger insert-vs-update with provenance metadata
 *  - sync-cycle cursor seeding under the item-scoped adapter namespace
 */

/* eslint-disable custom-rules/no-feature-to-feature-imports -- tests bridge billing catalog and the QuickBooks integration client */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks (hoisted) ─────────────────────────────────────────────────

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
}));

// In-memory mapping/cursor state shared across mocks.
const mappingStore: any[] = [];
const cycleStore: any[] = [];

const qboQuery = vi.fn();
const qboGetPreferences = vi.fn();

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  QboClientService: {
    create: vi.fn(async () => ({
      query: qboQuery,
      getPreferences: qboGetPreferences
    }))
  }
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

const serviceCreate = vi.fn();
const serviceUpdate = vi.fn();

vi.mock('../../models/service', () => ({
  default: {
    create: (...args: any[]) => serviceCreate(...args),
    update: (...args: any[]) => serviceUpdate(...args)
  }
}));

vi.mock('./syncMappingLedger', () => ({
  SyncMappingLedger: class {
    constructor() {}
    async findByExternalId(_type: string, externalId: string) {
      return mappingStore.find((m) => m.external_entity_id === externalId);
    }
    async findAllByExternalId(_type: string, externalId: string) {
      return mappingStore.filter((m) => m.external_entity_id === externalId && !m.deleted_at);
    }
    async insert(params: any) {
      const row = { id: `m-${mappingStore.length + 1}`, ...params };
      mappingStore.push({
        id: row.id,
        alga_entity_id: params.algaEntityId,
        external_entity_id: params.externalEntityId,
        external_realm_id: params.targetRealm,
        sync_status: params.syncStatus,
        metadata: params.metadata
      });
      return row;
    }
  }
}));

vi.mock('./syncCycleRepository', () => ({
  SyncCycleRepository: class {
    constructor() {}
    async startCycle(params: any) {
      const id = `cycle-${cycleStore.length + 1}`;
      cycleStore.push({ id, ...params });
      return id;
    }
    async finishCycle(_tenant: string, cycleId: string, patch: any) {
      const cycle = cycleStore.find((c) => c.id === cycleId);
      if (cycle) Object.assign(cycle, patch);
    }
  }
}));

// Fake tenant knex: tenantDb(...).table(name) → chainable query. We only need
// the tables the service reads for resolution; Service/ledger/cycle are mocked.
const catalogRows: any[] = [];
const itemMappingRows: any[] = [];
const taxMappingRows: any[] = [];

function makeKnex() {
  const knex: any = (table: string) => knex.table(table);
  knex.table = (table: string) => {
    const query: any = {
      _table: table,
      _whereCriteria: undefined as any,
      where: vi.fn((criteria: any) => { query._whereCriteria = criteria; return query; }),
      andWhere: vi.fn(() => query),
      whereNull: vi.fn(() => query),
      whereIn: vi.fn(() => query),
      select: vi.fn(async () => {
        if (table === 'service_catalog') return catalogRows;
        if (table === 'tenant_external_entity_mappings') {
          // loadExistingItemMappings reads service mappings; buildTaxRateMap
          // reads tax_code mappings. The shared fake keys off the where-clause.
          const criteria = query._whereCriteria;
          if (criteria?.alga_entity_type === 'tax_code') return taxMappingRows;
          if (criteria?.alga_entity_type === 'service') return itemMappingRows;
          return [...itemMappingRows, ...taxMappingRows];
        }
        if (table === 'tax_rates') return [];
        return [];
      }),
      update: vi.fn(async (patch: any) => {
        if (table === 'tenant_external_entity_mappings') {
          const criteria = query._whereCriteria;
          const target = mappingStore.find((m) => m.id === criteria?.id);
          if (target) Object.assign(target, patch);
        }
        return 1;
      }),
      insert: vi.fn(async () => [1]),
      returning: vi.fn(async () => [{}]),
      first: vi.fn(async () => undefined)
    };
    return query;
  };
  knex.fn = { now: () => 'NOW()' };
  knex.transaction = async (fn: any) => fn(knex);
  return knex;
}

const lockQboItemTargets = vi.fn(async (..._args: any[]) => undefined);

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: makeKnex() })),
  lockQboItemTargets: (...args: any[]) => lockQboItemTargets(...args),
  tenantDb: (knex: any) => knex,
  withTransaction: (knex: any, fn: any) => knex.transaction(fn)
}));

import {
  previewQboItemImportForTenant,
  executeQboItemImportForTenant
} from './qboItemImportService';
import type { QboItem } from '@alga-psa/integrations/lib/qbo/types';

function qboItem(overrides: Partial<QboItem> & { Id: string; Name: string }): QboItem {
  return { Type: 'Service', ...overrides } as QboItem;
}

const DEFAULTS = {
  includeInactive: true,
  defaults: {
    serviceTypeId: 'st-1',
    serviceBillingMethod: 'hourly' as const,
    productBillingMethod: 'fixed' as const,
    unitOfMeasure: 'ea'
  }
};

describe('qboItemImportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mappingStore.length = 0;
    cycleStore.length = 0;
    catalogRows.length = 0;
    itemMappingRows.length = 0;
    taxMappingRows.length = 0;
    qboQuery.mockResolvedValue([]);
    qboGetPreferences.mockResolvedValue({ CurrencyPrefs: { HomeCurrency: { value: 'EUR' } } });
    serviceCreate.mockImplementation(async (_trx: any, data: any) => ({ ...data, service_id: `svc-${data.service_name}` }));
    serviceUpdate.mockResolvedValue({});
  });

  it('preview: pages the QBO Item query until a short page and converts to minor units', async () => {
    // First page full (1000) → forces a second request; second page short → stop.
    const page1 = Array.from({ length: 1000 }, (_, i) => qboItem({ Id: `a-${i}`, Name: `A${i}`, UnitPrice: 1 }));
    qboQuery.mockResolvedValueOnce(page1).mockResolvedValueOnce([qboItem({ Id: 'b-1', Name: 'B1', UnitPrice: 19.99 })]);

    const preview = await previewQboItemImportForTenant({ tenant: 't1', realm: 'r1', options: DEFAULTS });

    expect(qboQuery).toHaveBeenCalledTimes(2);
    expect(qboQuery.mock.calls[0][0]).toMatch(/STARTPOSITION 1 MAXRESULTS 1000/);
    expect(qboQuery.mock.calls[1][0]).toMatch(/STARTPOSITION 1001 MAXRESULTS 1000/);
    // Include-inactive asks QBO for both states explicitly.
    expect(qboQuery.mock.calls[0][0]).toMatch(/Active IN \(true, false\)/);
    expect(preview.summary.create).toBe(1001);
    const b1 = preview.rows.find((r) => r.qboItemId === 'b-1');
    expect(b1?.fields?.default_rate).toBe(1999);
  });

  it('preview: reads home currency from QBO preferences', async () => {
    qboQuery.mockResolvedValue([qboItem({ Id: 'c-1', Name: 'C1', UnitPrice: 5 })]);
    const preview = await previewQboItemImportForTenant({ tenant: 't1', realm: 'r1', options: DEFAULTS });
    expect(preview.currencyCode).toBe('EUR');
  });

  it('execute: creates rows, writes ledger with provenance metadata, and seeds the item-scoped cursor', async () => {
    qboQuery.mockResolvedValue([
      qboItem({
        Id: 'q1', Name: 'Consulting', UnitPrice: 150, PurchaseCost: 50,
        SyncToken: '3', FullyQualifiedName: 'Svc:Consulting',
        IncomeAccountRef: { value: 'acc-9', name: 'Income' } as any,
        MetaData: { CreateTime: '2026-01-01', LastUpdatedTime: '2026-06-01T10:00:00Z' } as any
      })
    ]);

    const result = await executeQboItemImportForTenant({ tenant: 't1', realm: 'r1', options: DEFAULTS, userId: 'u1' });

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(0);

    // Created with converted minor units and cost currency.
    expect(serviceCreate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      service_name: 'Consulting',
      default_rate: 15000,
      cost: 5000,
      cost_currency: 'EUR',
      custom_service_type_id: 'st-1'
    }));

    // Ledger row carries provenance metadata.
    expect(mappingStore).toHaveLength(1);
    expect(mappingStore[0]).toMatchObject({
      external_entity_id: 'q1',
      sync_status: 'synced',
      metadata: expect.objectContaining({
        syncToken: '3',
        lastUpdatedTime: '2026-06-01T10:00:00Z',
        incomeAccountId: 'acc-9',
        fullyQualifiedName: 'Svc:Consulting'
      })
    });

    // Cursor seeded under the item-scoped adapter namespace (never the shared
    // 'quickbooks_online' cursor), at max(LastUpdatedTime, import start).
    expect(cycleStore).toHaveLength(1);
    expect(cycleStore[0].adapterType).toBe('quickbooks_online_items');
    expect(cycleStore[0].status).toBe('succeeded');
    expect(cycleStore[0].cursorAfter >= '2026-06-01T10:00:00Z').toBe(true);
  });

  it('execute: one bad row is captured and does not abort the batch', async () => {
    qboQuery.mockResolvedValue([
      qboItem({ Id: 'ok-1', Name: 'Good', UnitPrice: 10 }),
      qboItem({ Id: 'bad-1', Name: 'Bad', UnitPrice: 20 })
    ]);
    serviceCreate
      .mockResolvedValueOnce({ service_id: 'svc-good' })
      .mockRejectedValueOnce(new Error('unique sku violation'));

    const result = await executeQboItemImportForTenant({ tenant: 't1', realm: 'r1', options: DEFAULTS });

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ qboItemId: 'bad-1', message: 'unique sku violation' });
    // Cursor still seeded despite the row error.
    expect(cycleStore).toHaveLength(1);
  });

  it('execute: updates QBO-authoritative fields only on a mapped drift, leaving Alga fields untouched', async () => {
    catalogRows.push({
      service_id: 'svc-existing',
      service_name: 'Old Name',
      item_kind: 'service',
      sku: null,
      description: null,
      default_rate: 10000,
      cost: null,
      is_active: true
    });
    const preExisting = {
      id: 'm-1',
      alga_entity_id: 'svc-existing',
      external_entity_id: 'q1',
      external_realm_id: 'r1',
      sync_status: 'synced',
      metadata: {}
    };
    mappingStore.push(preExisting);
    itemMappingRows.push({ id: 'm-1', alga_entity_id: 'svc-existing', external_entity_id: 'q1' });

    qboQuery.mockResolvedValue([
      qboItem({ Id: 'q1', Name: 'New Name', UnitPrice: 175, SyncToken: '4' })
    ]);

    const result = await executeQboItemImportForTenant({ tenant: 't1', realm: 'r1', options: DEFAULTS });

    expect(result.updated).toBe(1);
    // Only QBO-authoritative fields patched; billing_method / unit_of_measure /
    // service type / category never appear in the update.
    const patch = serviceUpdate.mock.calls[0][2];
    expect(patch).toMatchObject({ service_name: 'New Name', default_rate: 17500 });
    expect(patch).not.toHaveProperty('billing_method');
    expect(patch).not.toHaveProperty('unit_of_measure');
    expect(patch).not.toHaveProperty('custom_service_type_id');
    expect(patch).not.toHaveProperty('category_id');

    // Existing ledger row is updated in place, not duplicated.
    expect(mappingStore).toHaveLength(1);
    expect(serviceCreate).not.toHaveBeenCalled();
  });

  it('execute: re-run links an unchanged mapped item without writing to the catalog', async () => {
    catalogRows.push({
      service_id: 'svc-same',
      service_name: 'Same',
      item_kind: 'service',
      sku: null,
      description: null,
      default_rate: 5000,
      cost: null,
      is_active: true
    });
    mappingStore.push({
      id: 'm-1',
      alga_entity_id: 'svc-same',
      external_entity_id: 'q1',
      external_realm_id: 'r1',
      sync_status: 'synced',
      metadata: {}
    });
    itemMappingRows.push({ id: 'm-1', alga_entity_id: 'svc-same', external_entity_id: 'q1' });

    qboQuery.mockResolvedValue([qboItem({ Id: 'q1', Name: 'Same', UnitPrice: 50 })]);

    const result = await executeQboItemImportForTenant({ tenant: 't1', realm: 'r1', options: DEFAULTS });

    expect(result.linked).toBe(1);
    expect(serviceUpdate).not.toHaveBeenCalled();
    expect(serviceCreate).not.toHaveBeenCalled();
    expect(mappingStore).toHaveLength(1);
  });
  it('execute: takes the tenant/realm/item target lock before deciding each applied row', async () => {
    qboQuery.mockResolvedValue([qboItem({ Id: 'q-lock', Name: 'Locked', UnitPrice: 1 })]);

    await executeQboItemImportForTenant({ tenant: 't1', realm: 'r1', options: DEFAULTS });

    expect(lockQboItemTargets).toHaveBeenCalledTimes(1);
    expect(lockQboItemTargets).toHaveBeenCalledWith(expect.anything(), 't1', [{ realm: 'r1', itemId: 'q-lock' }]);
    // The lock precedes any catalog or ledger write.
    expect(lockQboItemTargets.mock.invocationCallOrder[0]).toBeLessThan(serviceCreate.mock.invocationCallOrder[0]);
  });

  describe('items shared by several services', () => {
    const seedShared = () => {
      for (const id of ['svc-a', 'svc-b']) {
        catalogRows.push({
          service_id: id, service_name: id, item_kind: 'service', sku: null,
          description: null, default_rate: 100, cost: null, is_active: true
        });
      }
      const rows = [
        { id: 'm-a', alga_entity_id: 'svc-a', external_entity_id: 'q-shared', external_realm_id: 'r1', sync_status: 'synced', metadata: { keep: 'a' } },
        { id: 'm-b', alga_entity_id: 'svc-b', external_entity_id: 'q-shared', external_realm_id: 'r1', sync_status: 'synced', metadata: { keep: 'b' } }
      ];
      mappingStore.push(...rows);
      itemMappingRows.push(...rows.map((r) => ({ id: r.id, alga_entity_id: r.alga_entity_id, external_entity_id: 'q-shared' })));
    };

    it('preview and execute skip a multi-mapped item with a reason and write nothing', async () => {
      seedShared();
      qboQuery.mockResolvedValue([qboItem({ Id: 'q-shared', Name: 'Renamed in QBO', UnitPrice: 999 })]);

      const preview = await previewQboItemImportForTenant({ tenant: 't1', realm: 'r1', options: DEFAULTS });
      expect(preview.summary).toMatchObject({ skip: 1, create: 0, update: 0, link: 0 });
      expect(preview.rows[0].flags).toContain('shared_item_mapping');
      expect(preview.rows[0].reason).toBeTruthy();

      const before = JSON.stringify(mappingStore);
      const result = await executeQboItemImportForTenant({ tenant: 't1', realm: 'r1', options: DEFAULTS });

      expect(result).toMatchObject({ created: 0, updated: 0, linked: 0, skipped: 1, errors: [] });
      expect(serviceCreate).not.toHaveBeenCalled();
      expect(serviceUpdate).not.toHaveBeenCalled();
      expect(JSON.stringify(mappingStore)).toBe(before);
      expect(lockQboItemTargets).not.toHaveBeenCalled();
    });

    it('a tombstone plus one live mapping is unambiguous and imports normally', async () => {
      seedShared();
      mappingStore[1].deleted_at = '2026-01-01T00:00:00Z';
      itemMappingRows.pop(); // loadExistingItemMappings filters tombstones in SQL
      qboQuery.mockResolvedValue([qboItem({ Id: 'q-shared', Name: 'svc-a', UnitPrice: 5 })]);

      const result = await executeQboItemImportForTenant({ tenant: 't1', realm: 'r1', options: DEFAULTS });

      expect(result.skipped).toBe(0);
      expect(result.updated + result.linked).toBe(1);
      expect(serviceCreate).not.toHaveBeenCalled();
    });

    it('a second mapping that appears after the preview aborts the row instead of choosing a winner', async () => {
      catalogRows.push({
        service_id: 'svc-a', service_name: 'svc-a', item_kind: 'service', sku: null,
        description: null, default_rate: 100, cost: null, is_active: true
      });
      mappingStore.push({ id: 'm-a', alga_entity_id: 'svc-a', external_entity_id: 'q-race', external_realm_id: 'r1', sync_status: 'synced', metadata: {} });
      itemMappingRows.push({ id: 'm-a', alga_entity_id: 'svc-a', external_entity_id: 'q-race' });
      // A concurrent writer maps another service once the lock is granted.
      lockQboItemTargets.mockImplementationOnce(async () => {
        mappingStore.push({ id: 'm-late', alga_entity_id: 'svc-late', external_entity_id: 'q-race', external_realm_id: 'r1', sync_status: 'synced', metadata: {} });
      });
      qboQuery.mockResolvedValue([qboItem({ Id: 'q-race', Name: 'Changed', UnitPrice: 7 })]);

      const result = await executeQboItemImportForTenant({ tenant: 't1', realm: 'r1', options: DEFAULTS });

      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toMatch(/changed after the preview/);
      expect(serviceUpdate).not.toHaveBeenCalled();
    });
  });
});
