import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

const fake = vi.hoisted(() => ({
  rma: {} as any,
  custody: {} as any,
  asset: { asset_id: 'asset-1', client_id: 'client-1', serial_number: 'NEW-SERIAL' },
  writes: [] as Array<{ table: string; row: any }>,
  allowed: new Set<string>(),
  checks: [] as Array<{ db: unknown; contextDb: unknown; tenant: string; user: unknown; asset: unknown; action: string }>,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (table: string) => {
      const query: any = {
        where: () => query,
        forUpdate: () => query,
        orderBy: () => query,
        select: () => query,
        first: async () => {
          if (table === 'rma_cases') return { ...fake.rma };
          if (table === 'assets') return { ...fake.asset };
          if (table === 'vendors') return { vendor_name: 'Vendor One' };
          if (table === 'rma_events') return { payload: { before: { serial_number: 'OLD-SERIAL' }, dead_unit_serial_number: 'OLD-SERIAL' } };
          throw new Error(`Unexpected table: ${table}`);
        },
        update: (row: any) => {
          fake.writes.push({ table, row });
          Object.assign(fake.rma, row);
          return { returning: async () => [{ ...fake.rma }] };
        },
        insert: (row: any) => {
          fake.writes.push({ table, row });
          return { returning: async () => [{ ...row, event_id: 'rma-event-1', payload: JSON.parse(row.payload), document_ids: [] }] };
        },
      };
      return query;
    },
  }),
}));
vi.mock('@alga-psa/shared/services/numberingService', () => ({ SharedNumberingService: {} }));
// Exercise the real custody authorization boundary, with a controllable record-level policy.
vi.mock('@alga-psa/assets/lib/assetReadAuthorization', () => ({
  createAssetReadContext: async (db: unknown, _tenant: string, user: unknown) => ({ db, user }),
  isAssetActionAllowed: async (db: unknown, tenant: string, ctx: { db: unknown; user: unknown }, asset: unknown, action: string) => {
    fake.checks.push({ db, contextDb: ctx.db, tenant, user: ctx.user, asset, action });
    return fake.allowed.has(action);
  },
}));
vi.mock('@alga-psa/assets/lib/custody/shared', () => ({ loadCustody: async () => ({ ...fake.custody }) }));
vi.mock('@alga-psa/assets/lib/custody/recordCustodyEvent', () => ({
  recordCustodyEvent: vi.fn(async (_trx: unknown, _tenant: string, _actor: string, _id: string, input: any) => {
    fake.custody.state = 'with_vendor';
    fake.writes.push({ table: 'asset_custody_events', row: input });
    return { custody: { ...fake.custody }, event: { ...input, occurred_at: input.occurred_at }, assetStatusChange: null };
  }),
}));
vi.mock('@alga-psa/assets/lib/custody/closeCustodyEpisode', () => ({
  closeCustodyEpisode: vi.fn(async (_trx: unknown, _tenant: string, _actor: string, _id: string, reason: string) => {
    Object.assign(fake.custody, { state: 'closed', close_reason: reason });
    fake.writes.push({ table: 'asset_custody', row: { ...fake.custody } });
    return { custody: { ...fake.custody }, occurredAt: '2026-11-01T12:00:00.000Z' };
  }),
}));
vi.mock('@alga-psa/assets/lib/warranty/applyWarrantyReplacement', () => ({ applyWarrantyReplacement: vi.fn() }));

import { recordCustodyEvent } from '@alga-psa/assets/lib/custody/recordCustodyEvent';
import { closeCustodyEpisode } from '@alga-psa/assets/lib/custody/closeCustodyEpisode';
import { confirmVendorReceiptCore, shipDeadUnitToVendorCore } from './warrantyTransitions';

const tenant = 'tenant-1';
const actor = 'user-1';
const trx = { fn: { now: () => '2026-11-01T12:00:00.000Z' } } as unknown as Knex.Transaction;
const shippingInput = { carrier: 'UPS', tracking_number: 'TRACK-1', return_by: undefined, occurred_at: '2026-11-01T12:00:00.000Z', note: null };
const transitions = [
  { name: 'shipping the dead unit', status: 'replaced', custodyState: 'in_office', run: () => shipDeadUnitToVendorCore(trx, tenant, actor, 'rma-1', shippingInput) },
  { name: 'confirming vendor receipt', status: 'dead_unit_owed', custodyState: 'with_vendor', run: () => confirmVendorReceiptCore(trx, tenant, actor, 'rma-1', { note: null }) },
];

beforeEach(() => {
  vi.clearAllMocks();
  fake.rma = {
    rma_id: 'rma-1', rma_number: 'RMA-1', asset_id: 'asset-1', client_id: 'client-1', custody_id: 'custody-1',
    vendor_id: 'vendor-1', returned_unit_id: null, rma_type: 'advance_replacement', replacement_serial_number: 'NEW-SERIAL',
  };
  fake.custody = { custody_id: 'custody-1', asset_id: 'asset-1', closed_at: null };
  fake.writes = [];
  fake.checks = [];
  fake.allowed = new Set();
});

describe.each(transitions)('$name requires record-level custody update', ({ status, custodyState, run }) => {
  beforeEach(() => {
    fake.rma.status = status;
    fake.custody.state = custodyState;
  });

  it('refuses read-only access before any custody or RMA mutation', async () => {
    fake.allowed = new Set(['read']);
    const before = structuredClone({ rma: fake.rma, custody: fake.custody, asset: fake.asset });

    await expect(run()).rejects.toMatchObject({ code: 'not_found', message: 'Custody record not found.' });

    expect({ rma: fake.rma, custody: fake.custody, asset: fake.asset }).toEqual(before);
    expect(fake.writes).toEqual([]);
    expect(recordCustodyEvent).not.toHaveBeenCalled();
    expect(closeCustodyEpisode).not.toHaveBeenCalled();
    expect(fake.checks).toEqual([{
      db: trx, contextDb: trx, tenant, user: { user_id: actor, user_type: 'internal' }, asset: fake.asset, action: 'update',
    }]);
  });

  it('allows record-level update in the existing transaction and preserves the replacement asset', async () => {
    fake.allowed = new Set(['update']);
    const asset = { ...fake.asset };
    const result = await run();

    expect(fake.asset).toEqual(asset);
    expect(fake.checks).toEqual([{
      db: trx, contextDb: trx, tenant, user: { user_id: actor, user_type: 'internal' }, asset, action: 'update',
    }]);
    expect(fake.writes.filter(write => write.table === 'rma_cases')).toHaveLength(1);
    expect(fake.writes.filter(write => write.table === 'rma_events')).toHaveLength(1);
    expect(result.event.payload.dead_unit_serial_number).toBe('OLD-SERIAL');

    if (status === 'replaced') {
      expect(result.rma.status).toBe('dead_unit_owed');
      expect(result.custodyEffects).toMatchObject([{ custody: { state: 'with_vendor' }, eventType: 'shipped' }]);
      expect(recordCustodyEvent).toHaveBeenCalledWith(trx, tenant, actor, 'custody-1', expect.objectContaining({
        event_type: 'shipped', counterparty: 'Vendor One', note: expect.stringContaining('Dead unit S/N OLD-SERIAL'),
      }));
      expect(closeCustodyEpisode).not.toHaveBeenCalled();
    } else {
      expect(result.rma).toMatchObject({ status: 'closed', closed_reason: 'resolved' });
      expect(result.custodyEffects).toMatchObject([{ custody: { state: 'closed', close_reason: 'returned_to_vendor' }, eventType: 'updated' }]);
      expect(closeCustodyEpisode).toHaveBeenCalledWith(trx, tenant, actor, 'custody-1', 'returned_to_vendor', {
        note: 'Dead unit S/N OLD-SERIAL · received by vendor', rmaId: 'rma-1', rmaNumber: 'RMA-1',
      });
      expect(recordCustodyEvent).not.toHaveBeenCalled();
    }
  });
});
