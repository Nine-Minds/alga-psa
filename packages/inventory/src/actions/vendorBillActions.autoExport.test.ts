/**
 * The draft→open transition is the single auto-export hook point for vendor
 * bills (bills are always created as draft): moving a bill to open must queue
 * the accounting export producer, and no other transition may. This is the
 * unit-level proof of the "Open auto-queue" behavior from the vendor bill
 * export alignment plan (docs/plans/2026-07-10-vendor-bill-export-alignment-plan.md).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const enqueueVendorBillAutoExportMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true)
}));

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/db')>('@alga-psa/db');
  return {
    ...actual,
    createTenantKnex: createTenantKnexMock,
    withTransaction: vi.fn(async (knex: any, fn: any) => fn(knex))
  };
});

vi.mock('@alga-psa/billing/runtime', () => ({
  enqueueVendorBillAutoExport: enqueueVendorBillAutoExportMock
}));

import { setVendorBillStatus } from './vendorBillActions';
import { hasPermission } from '@alga-psa/auth/rbac';

const TENANT = 'tenant-1';
const USER = { user_id: 'user-1' };

/** Fake knex/trx for setVendorBillStatus: bill lookup + status update. */
function makeDb(currentStatus: string, billId = 'bill-1') {
  const billRow = { bill_id: billId, tenant: TENANT, status: currentStatus };
  const db: any = vi.fn((tableName: string) => {
    const builder: any = {};
    builder.where = vi.fn(() => builder);
    builder.forUpdate = vi.fn(() => builder);
    builder.first = vi.fn(async () => (tableName === 'vendor_bills' ? billRow : undefined));
    builder.update = vi.fn(() => builder);
    builder.returning = vi.fn(async () => [{ ...billRow, status: 'updated' }]);
    return builder;
  });
  db.fn = { now: vi.fn(() => 'now()') };
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hasPermission).mockResolvedValue(true);
});

describe('setVendorBillStatus auto-export hook', () => {
  it('draft → open queues the vendor bill auto-export with the outer db handle', async () => {
    const db = makeDb('draft');
    createTenantKnexMock.mockResolvedValue({ knex: db, tenant: TENANT });

    await (setVendorBillStatus as any)(USER, { tenant: TENANT }, 'bill-1', 'open');

    expect(enqueueVendorBillAutoExportMock).toHaveBeenCalledTimes(1);
    expect(enqueueVendorBillAutoExportMock).toHaveBeenCalledWith(db, TENANT, 'bill-1');
  });

  it('draft → void does not queue an export', async () => {
    const db = makeDb('draft');
    createTenantKnexMock.mockResolvedValue({ knex: db, tenant: TENANT });

    await (setVendorBillStatus as any)(USER, { tenant: TENANT }, 'bill-1', 'void');

    expect(enqueueVendorBillAutoExportMock).not.toHaveBeenCalled();
  });

  it('open → paid does not queue an export', async () => {
    const db = makeDb('open');
    createTenantKnexMock.mockResolvedValue({ knex: db, tenant: TENANT });

    await (setVendorBillStatus as any)(USER, { tenant: TENANT }, 'bill-1', 'paid');

    expect(enqueueVendorBillAutoExportMock).not.toHaveBeenCalled();
  });

  it('invalid transition (paid → open) returns an action error before any enqueue', async () => {
    const db = makeDb('paid');
    createTenantKnexMock.mockResolvedValue({ knex: db, tenant: TENANT });

    await expect(
      (setVendorBillStatus as any)(USER, { tenant: TENANT }, 'bill-1', 'open')
    ).resolves.toEqual({ actionError: 'Cannot move a paid bill to open' });

    expect(enqueueVendorBillAutoExportMock).not.toHaveBeenCalled();
  });
});
