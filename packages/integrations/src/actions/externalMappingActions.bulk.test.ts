/**
 * createExternalEntityMappings (bulk) — unit tests with an in-memory fake of
 * the tenant DB layer. They prove the properties that do not need Postgres:
 * permission and realm are checked once, rows are isolated, and the per-row
 * logic is the single-create logic (same duplicate rejection, same kind
 * handling). The DB-backed counterpart lives in externalMappingActions.db.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const store = vi.hoisted(() => ({ mappings: [] as Array<Record<string, any>> }));
const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  getStoredXeroConnections: vi.fn(),
  listItems: vi.fn(),
  listAccounts: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...args: any[]) => any) => async (...args: any[]) => fn(...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn(async () => undefined) }));
vi.mock('../lib/qbo/qboClientService', () => ({
  getStoredQboCredentialsMap: vi.fn(),
  QboClientService: { create: vi.fn() },
}));
vi.mock('../lib/xero/xeroClientService', () => ({
  getStoredXeroConnections: mocks.getStoredXeroConnections,
  XeroClientService: {
    create: vi.fn(async () => ({
      listItems: mocks.listItems,
      listAccounts: mocks.listAccounts,
      listTaxRates: vi.fn(async () => []),
    })),
  },
}));

vi.mock('@alga-psa/db', () => {
  function table(name: string) {
    const filters: Row[] = [];
    const flags = { notNull: false, null: false };
    const builder: any = {
      where(f: Row) { filters.push(f); return builder; },
      whereNull() { flags.null = true; return builder; },
      whereNotNull() { flags.notNull = true; return builder; },
      whereIn() { return builder; },
      async first() {
        if (name === 'service_catalog') return { service_id: 'exists' };
        if (flags.notNull) return undefined; // no tombstones in this fake
        return store.mappings.find((m) =>
          filters.every((f) => Object.entries(f).every(([k, v]) => m[k] === v))
        );
      },
      insert(row: Row) {
        return {
          async returning() {
            if (row.alga_entity_id === 'svc-explode') throw new Error('boom');
            const saved = { ...row, id: `id-${store.mappings.length + 1}` };
            store.mappings.push(saved);
            return [saved];
          },
        };
      },
    };
    return builder;
  }
  return {
    auditLog: vi.fn(async () => undefined),
    ACCOUNTING_EXPORT_INVOICE_CANCELLED: 'cancelled',
    ACCOUNTING_EXPORT_INVOICE_NOT_FOUND: 'not_found',
    createTenantKnex: vi.fn(async () => ({ knex: {} })),
    lockInvoiceForExternalSync: vi.fn(),
    lockInvoicesForExternalSync: vi.fn(),
    tenantDb: () => ({ table }),
    withTransaction: mocks.withTransaction,
    writeAccountingAudit: vi.fn(async () => undefined),
  };
});

import { createExternalEntityMappings } from './externalMappingActions';

const realm = 'xero-org-1';
const row = (id: string, external: string, kind: 'item' | 'account') => ({
  integration_type: 'xero',
  alga_entity_type: 'service',
  alga_entity_id: id,
  external_entity_id: external,
  external_realm_id: realm,
  metadata: { xeroTargetKind: kind },
});
const call = (rows: any[]) =>
  (createExternalEntityMappings as any)({ user_id: 'u' }, { tenant: 't1' }, rows);

beforeEach(() => {
  vi.clearAllMocks();
  store.mappings = [];
  mocks.hasPermission.mockResolvedValue(true);
  mocks.getStoredXeroConnections.mockResolvedValue({
    'conn-1': { connectionId: 'conn-1', xeroTenantId: realm },
  });
  mocks.listItems.mockResolvedValue([
    { itemId: 'i1', code: '200', name: 'Item 200', status: 'ACTIVE' },
    { itemId: 'i2', code: 'B', name: 'Item B', status: 'ACTIVE' },
  ]);
  mocks.listAccounts.mockResolvedValue([
    { accountId: 'a1', code: '200', name: 'Sales', type: 'REVENUE', status: 'ACTIVE' },
  ]);
  // Each call gets its own "transaction": the callback's throw is isolated to it.
  mocks.withTransaction.mockImplementation(async (_knex: unknown, cb: any) =>
    cb({ raw: vi.fn(async () => undefined) })
  );
});

describe('createExternalEntityMappings', () => {
  it('isolates rows: a duplicate and a thrown insert do not block the others', async () => {
    store.mappings.push({
      id: 'existing', tenant: 't1', integration_type: 'xero', alga_entity_type: 'service',
      alga_entity_id: 'svc-dup', external_realm_id: realm, deleted_at: null,
    });
    const results = await call([
      row('svc-a', '200', 'item'),
      row('svc-dup', 'B', 'item'),
      row('svc-explode', 'B', 'item'),
      row('svc-b', '200', 'account'),
    ]);

    expect(results.map((r: any) => [r.alga_entity_id, r.ok])).toEqual([
      ['svc-a', true],
      ['svc-dup', false],
      ['svc-explode', false],
      ['svc-b', true],
    ]);
    expect(results[1].error).toMatch(/already exists for the connected Xero organisation/);
    expect(results[2].error).toBeTruthy();
    // item:200 and account:200 were validated against their own catalogs and
    // persisted with their own kinds.
    const saved = store.mappings.filter((m) => m.id !== 'existing');
    expect(saved.map((m) => [m.alga_entity_id, m.external_entity_id, m.metadata.xeroTargetKind])).toEqual([
      ['svc-a', '200', 'item'],
      ['svc-b', '200', 'account'],
    ]);
  });

  it('checks permission once for the whole batch', async () => {
    await call([row('svc-a', '200', 'item'), row('svc-b', 'B', 'item'), row('svc-c', '200', 'account')]);
    expect(mocks.hasPermission).toHaveBeenCalledTimes(1);
    expect(mocks.hasPermission).toHaveBeenCalledWith(
      expect.anything(), 'accounting_integrations', 'mappings_manage', expect.anything()
    );
  });

  it('returns a top-level permission error and touches no rows when denied', async () => {
    mocks.hasPermission.mockResolvedValue(false);
    const result = await call([row('svc-a', '200', 'item')]);
    expect(result).toMatchObject({ permissionError: expect.stringContaining('Permission denied') });
    expect(mocks.withTransaction).not.toHaveBeenCalled();
    expect(store.mappings).toHaveLength(0);
  });

  it('validates the realm once and fails every row without running per-row logic when it is not connected', async () => {
    const rows = [row('svc-a', '200', 'item'), row('svc-b', 'B', 'item')].map((r) => ({
      ...r,
      external_realm_id: 'someone-elses-org',
    }));
    const results = await call(rows);
    expect(results.every((r: any) => !r.ok)).toBe(true);
    expect(results[0].error).toMatch(/not a connected Xero organisation/);
    // One realm check; the per-row path (which also reads connections) never ran.
    expect(mocks.getStoredXeroConnections).toHaveBeenCalledTimes(1);
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('never persists a Xero service row without an explicit kind; only that row fails', async () => {
    const results = await call([
      { ...row('svc-a', '200', 'item'), metadata: null },
      { ...row('svc-c', '200', 'item'), metadata: { xeroTargetKind: 'bogus' } },
      row('svc-b', 'B', 'item'),
    ]);
    expect(results.map((r: any) => r.ok)).toEqual([false, false, true]);
    expect(results[0].error).toMatch(/xeroTargetKind/);
    expect(store.mappings.map((m) => m.alga_entity_id)).toEqual(['svc-b']);
  });

  it('returns an empty result for an empty batch', async () => {
    expect(await call([])).toEqual([]);
  });
});
