import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  candidates: [] as Array<Record<string, unknown>>,
  visible: [] as Array<Record<string, unknown>>,
  permitted: true,
  permissionCalls: [] as string[],
  filterCalls: 0,
  trx: {},
  reservation: null as Record<string, unknown> | null,
  createPermitted: true,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(async (_user: unknown, resource: string, action: string) => {
    h.permissionCalls.push(`${resource}:${action}`);
    return h.permitted && (action !== 'create' || h.createPermitted);
  }),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_db: unknown, callback: (trx: unknown) => Promise<unknown>) => callback(h.trx)),
  tenantDb: vi.fn((_db: unknown, _tenant: string) => ({
    table: (name: string) => {
      const qb: any = {
        where: () => qb,
        whereRaw: () => qb,
        whereIn: () => qb,
        orderBy: () => qb,
        select: async () => name === 'assets' ? h.candidates : [],
        first: async () => name === 'asset_number_reservations' ? h.reservation : undefined,
        update: async () => 1,
      };
      return qb;
    },
  })),
}));
vi.mock('../lib/assetReadAuthorization', () => ({
  createAssetReadContext: vi.fn(async () => ({ kernel: true })),
  filterReadableAssets: vi.fn(async (_trx: unknown, _tenant: string, _context: unknown, candidates: Array<Record<string, unknown>>) => {
    h.filterCalls += 1;
    return candidates.filter((candidate) => h.visible.some((item) => item.asset_id === candidate.asset_id));
  }),
}));
vi.mock('./assetActions', () => ({ createAssetInTransaction: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/workflow-streams', () => ({ buildAssetCreatedPayload: vi.fn() }));

import { findAssetByScannedTag } from './assetNumberingActions';
import { hasPermission } from '@alga-psa/auth';

const asset = (id: string) => ({ asset_id: id, asset_tag: 'Tag-01', name: `Asset ${id}`, client_id: 'client-1', asset_type: 'unknown' });

describe('scan lookup record visibility', () => {
  beforeEach(() => {
    h.candidates = [];
    h.visible = [];
    h.permitted = true;
    h.permissionCalls = [];
    h.filterCalls = 0;
    h.reservation = null;
    h.createPermitted = true;
    vi.clearAllMocks();
  });

  it('checks reservation completion permission on the lookup transaction and hides denied reservations', async () => {
    h.reservation = { reservation_id: 'r1', state: 'reserved', expires_at: '2999-01-01' };
    await expect(findAssetByScannedTag('TAG-01')).resolves.toEqual({ kind: 'reservation', reservation: h.reservation });
    expect(hasPermission).toHaveBeenCalledWith(expect.anything(), 'asset', 'create', h.trx);
    h.createPermitted = false;
    await expect(findAssetByScannedTag('TAG-01')).resolves.toEqual({ kind: 'not_found' });
  });

  it('returns the one record allowed by the asset authorization kernel', async () => {
    h.candidates = [asset('hidden'), asset('visible')];
    h.visible = [asset('visible')];
    await expect(findAssetByScannedTag(' tag-01 ')).resolves.toEqual({ kind: 'asset', asset: asset('visible') });
    expect(h.filterCalls).toBe(1);
  });

  it('does not reveal hidden or ambiguous asset ids', async () => {
    h.candidates = [asset('hidden')];
    await expect(findAssetByScannedTag('TAG-01')).resolves.toEqual({ kind: 'not_found' });
    h.visible = [asset('one'), asset('two')];
    h.candidates = [...h.visible];
    await expect(findAssetByScannedTag('TAG-01')).resolves.toEqual({ kind: 'ambiguous' });
    expect(JSON.stringify(h.visible)).not.toContain('assetIds');
  });

  it('requires coarse asset read permission before querying', async () => {
    h.permitted = false;
    await expect(findAssetByScannedTag('TAG-01')).rejects.toThrow('Permission denied');
    expect(h.permissionCalls).toContain('asset:read');
  });
});
