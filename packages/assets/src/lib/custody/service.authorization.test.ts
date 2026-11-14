import { beforeEach, describe, expect, it, vi } from 'vitest';

const policy = vi.hoisted(() => ({ allowed: new Set<string>(), calls: [] as Array<{ action: string; db: unknown; contextDb: unknown }> }));
const state = vi.hoisted(() => ({
  episodes: [{ custody_id: 'custody-1', asset_id: 'asset-1', state: 'in_office', closed_at: null }] as Array<{ custody_id: string; asset_id: string; state: string; closed_at: string | null; purpose?: string }>,
  events: [{ event_id: 'event-1', custody_id: 'custody-1', asset_id: 'asset-1' }],
  assetStatus: 'held_by_msp',
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: (db: unknown) => ({
    table: (name: string) => ({
      where: () => ({
        select: () => ({ first: async () => name === 'assets' ? { asset_id: 'asset-1', client_id: 'client-1' } : null }),
      }),
    }),
  }),
}));
vi.mock('@alga-psa/auth', () => ({
  hasPermission: async (_user: unknown, resource: string, action: string) => resource === 'asset' && action === 'update',
}));
vi.mock('../assetReadAuthorization', () => ({
  createAssetReadContext: async (db: unknown) => ({ db }),
  filterReadableAssets: async () => [],
  isAssetActionAllowed: async (db: unknown, _tenant: string, ctx: { db: unknown }, _asset: unknown, action: string) => {
    policy.calls.push({ action, db, contextDb: ctx.db });
    return policy.allowed.has(action);
  },
}));
vi.mock('./shared', () => ({
  loadCustody: async () => ({ ...state.episodes[0] }),
  locationNames: async () => new Map(),
  userNames: async () => new Map(),
}));
vi.mock('./queries', () => ({
  getOpenCustodyForAssets: async () => new Map(),
  listCustodyEpisodes: async () => [{ custody_id: 'custody-1', asset_id: 'asset-1', state: 'in_office', closed_at: null }],
  listCustodyQueue: async () => ({ rows: [], total: 0 }),
}));
vi.mock('./openCustody', () => ({
  openCustody: async () => {
    state.episodes.push({ custody_id: 'custody-opened', asset_id: 'asset-1', state: 'in_office', closed_at: null });
    state.events.push({ event_id: 'event-opened', custody_id: 'custody-opened', asset_id: 'asset-1' });
    return { custody: { custody_id: 'custody-opened' }, event: { event_id: 'event-opened' } };
  },
}));
vi.mock('./receiveEquipment', () => ({
  receiveEquipmentForTicket: async (_trx: unknown, _tenant: string, _actor: string, _input: unknown, authorize: (assetId: string) => Promise<void>) => {
    await authorize('asset-1');
    state.episodes.push({ custody_id: 'custody-received', asset_id: 'asset-1', state: 'in_office', closed_at: null });
    state.events.push({ event_id: 'event-received', custody_id: 'custody-received', asset_id: 'asset-1' });
    return { custody: { custody_id: 'custody-received' }, event: { event_id: 'event-received' } };
  },
}));
vi.mock('./recordCustodyEvent', () => ({
  recordCustodyEvent: async () => {
    state.events.push({ event_id: 'event-returned', custody_id: 'custody-1', asset_id: 'asset-1' });
    state.episodes[0] = { ...state.episodes[0], state: 'closed', closed_at: 'now' };
    state.assetStatus = 'active';
    return { custody: { custody_id: 'custody-1' }, event: { event_id: 'event-returned', event_type: 'returned' }, assetStatusChange: { assetId: 'asset-1', before: 'held_by_msp', after: 'active' } };
  },
}));
vi.mock('./closeCustodyEpisode', () => ({
  closeCustodyEpisode: async () => {
    state.episodes[0] = { ...state.episodes[0], state: 'closed', closed_at: 'now' };
    return { custody: { custody_id: 'custody-1' }, occurredAt: 'now' };
  },
}));
vi.mock('./updateCustodyDetails', () => ({
  updateCustodyDetails: async () => {
    state.episodes[0] = { ...state.episodes[0], purpose: 'updated' };
    return { custody: { custody_id: 'custody-1' }, changedFields: ['purpose'] };
  },
}));
vi.mock('./publishCustodyChanged', () => ({ publishCustodyChanged: async () => {} }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: async () => {} }));
vi.mock('@alga-psa/workflow-streams', () => ({ buildAssetCreatedPayload: vi.fn(), buildAssetUpdatedPayload: vi.fn() }));
vi.mock('@shared/lib/documentAuthorization', () => ({ authorizeAndRedactDocuments: async () => [] }));

import {
  authorizeCustodyEpisode,
  closeCustodyEpisodeInTransaction,
  getAssetCustodyService,
  openCustodyService,
  receiveEquipmentInTransaction,
  recordCustodyEventInTransaction,
  updateCustodyService,
} from './service';
import { hasPermission } from '@alga-psa/auth';

const tenant = 'tenant-1';
const user = {
  user_id: 'user-1', user_type: 'internal' as const, username: 'User One', email: 'user@example.test', is_inactive: false, tenant,
};
const trx = { kind: 'transaction' } as any;
const knex = { kind: 'knex', transaction: async (work: (transaction: any) => unknown) => work(trx) } as any;
const input = { asset_id: 'asset-1', document_ids: [] } as any;

function snapshot() {
  return structuredClone({ episodes: state.episodes, events: state.events, assetStatus: state.assetStatus });
}

async function expectDeniedWithoutMutation(work: () => Promise<unknown>) {
  await expect(hasPermission(user, 'asset', 'update')).resolves.toBe(true);
  policy.allowed = new Set(['read']); // Coarse asset:update is granted by the calling action; record update is not.
  policy.calls = [];
  const before = snapshot();
  await expect(work()).rejects.toMatchObject({ code: 'not_found' });
  expect(snapshot()).toEqual(before);
  expect(policy.calls.map(call => call.action)).toContain('update');
  expect(policy.calls.every(call => call.db === trx && call.contextDb === trx)).toBe(true);
}

describe('custody service record-level authorization', () => {
  beforeEach(() => {
    state.episodes = [{ custody_id: 'custody-1', asset_id: 'asset-1', state: 'in_office', closed_at: null }];
    state.events = [{ event_id: 'event-1', custody_id: 'custody-1', asset_id: 'asset-1' }];
    state.assetStatus = 'held_by_msp';
    policy.allowed = new Set();
    policy.calls = [];
  });

  it('keeps read services on record-level read', async () => {
    policy.allowed = new Set(['read']);
    await expect(getAssetCustodyService(knex, tenant, user, 'asset-1')).resolves.toMatchObject({ open: { custody_id: 'custody-1' } });
    expect(policy.calls.map(call => call.action)).toEqual(['read']);
    await expect(authorizeCustodyEpisode(trx, tenant, user, 'custody-1')).resolves.toMatchObject({ custody_id: 'custody-1' });
  });

  it('denies opening custody without record-level update', async () => {
    await expectDeniedWithoutMutation(() => openCustodyService(knex, tenant, user, input));
  });

  it('denies receiving an existing asset without record-level update', async () => {
    await expectDeniedWithoutMutation(() => receiveEquipmentInTransaction(trx, tenant, user, { ...input, ticket_id: 'ticket-1' }));
  });

  it('denies event recording before episode, event, or returned asset status changes', async () => {
    await expectDeniedWithoutMutation(() => recordCustodyEventInTransaction(trx, tenant, user, 'custody-1', { event_type: 'returned', document_ids: [] } as any));
  });

  it('denies episode edits before opening or mutating the write transaction', async () => {
    await expectDeniedWithoutMutation(() => updateCustodyService(knex, tenant, user, 'custody-1', { purpose: 'updated' } as any));
  });

  it('denies RMA episode closure without record-level update', async () => {
    await expectDeniedWithoutMutation(() => closeCustodyEpisodeInTransaction(trx, tenant, user, 'custody-1', 'disposed'));
  });

  it.each([
    ['opening an episode', () => openCustodyService(knex, tenant, user, input)],
    ['receiving an existing asset', () => receiveEquipmentInTransaction(trx, tenant, user, { ...input, ticket_id: 'ticket-1' })],
    ['recording an event and changing asset status', () => recordCustodyEventInTransaction(trx, tenant, user, 'custody-1', { event_type: 'returned', document_ids: [] } as any)],
    ['editing an episode', () => updateCustodyService(knex, tenant, user, 'custody-1', { purpose: 'updated' } as any)],
    ['closing an episode for an RMA', () => closeCustodyEpisodeInTransaction(trx, tenant, user, 'custody-1', 'disposed')],
  ])('allows %s with record-level update in the write transaction', async (_name, work) => {
    policy.allowed = new Set(['update']);
    await expect(work()).resolves.toBeDefined();
    expect(policy.calls.length).toBeGreaterThan(0);
    expect(policy.calls.every(call => call.action === 'update' && call.db === trx && call.contextDb === trx)).toBe(true);
  });
});
