import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  links: [] as Array<{ asset_id: string; entity_id: string }>,
  assets: [] as Array<Record<string, unknown>>,
  custody: new Map<string, Record<string, unknown>>(),
  unreadable: new Set<string>(),
  canReadAssets: true,
}));

vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => state.canReadAssets }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({
    table: (name: string) => {
      const chain: any = {
        where: () => chain,
        whereIn: () => chain,
        select: async () => (name === 'asset_associations' ? state.links : state.assets),
      };
      return chain;
    },
  }),
}));
vi.mock('./assetReadAuthorization', () => ({
  createAssetReadContext: async () => ({}),
  isAssetReadAllowed: async (_k: unknown, _t: unknown, _c: unknown, asset: { asset_id: string }) => !state.unreadable.has(asset.asset_id),
}));
vi.mock('./custody/queries', () => ({
  getOpenCustodyForAssets: async (_k: unknown, _t: string, ids: string[]) =>
    new Map(ids.filter((id) => state.custody.has(id)).map((id) => [id, state.custody.get(id)!])),
}));

import { getTicketLinkedAssetLabelParts, listTicketLinkedAssetChoices } from './ticketLinkedAssetLabels';

const T = 'ticket-1';
const ctx = { tenant: 't', user: { user_id: 'u' }, baseUrl: 'https://x.test' } as never;

const held = (bin: string, followUp: string | null) => ({
  state: 'in_office', location_name: 'Main Office', bin, next_action_party: 'vendor', follow_up_on: followUp,
  next_action_note: 'SECRET NOTE',
});

function seed(opts: { assets: string[]; held?: Record<string, ReturnType<typeof held>> }) {
  state.links = opts.assets.map((asset_id) => ({ asset_id, entity_id: T }));
  state.assets = opts.assets.map((asset_id, i) => ({
    asset_id, asset_tag: `TAG-${asset_id}`, name: `Item ${asset_id}`, serial_number: `SERIAL-000${i}-WXYZ`, client_id: 'c',
  }));
  state.custody = new Map(Object.entries(opts.held ?? {}));
}

beforeEach(() => {
  state.unreadable = new Set();
  state.canReadAssets = true;
  seed({ assets: [] });
});

describe('getTicketLinkedAssetLabelParts', () => {
  const three = () =>
    seed({
      assets: ['a', 'b', 'c'],
      held: { a: held('Shelf A1', '2026-11-02'), b: held('Shelf B3', '2026-10-29'), c: held('Shelf C2', null) },
    });

  it('the picked asset decides: its own shelf and next action, and its own asset line', async () => {
    three();
    const [r] = await getTicketLinkedAssetLabelParts(ctx, [{ recordId: T, linkedAssetId: 'b' }]);
    expect(r).toMatchObject({
      assetId: 'b', assetTag: 'TAG-b', serialSuffix: 'WXYZ',
      custodyLocation: 'Main Office / Shelf B3', nextAction: 'Waiting on vendor, Oct 29',
    });
  });

  it('no pick on several held items: count plus the earliest follow-up, no asset line', async () => {
    three();
    const [r] = await getTicketLinkedAssetLabelParts(ctx, [{ recordId: T }]);
    expect(r).toEqual({ assetId: '', assetTag: null, serialSuffix: null, custodyLocation: '3 items held', nextAction: 'Follow up Oct 29' });
  });

  it('the same ticket can appear several times with different picks (batch)', async () => {
    three();
    const r = await getTicketLinkedAssetLabelParts(ctx, ['a', 'b', 'c'].map((linkedAssetId) => ({ recordId: T, linkedAssetId })));
    expect(r.map((p) => p?.custodyLocation)).toEqual(['Main Office / Shelf A1', 'Main Office / Shelf B3', 'Main Office / Shelf C2']);
  });

  it('a picked asset with no open custody prints no custody line, never the count', async () => {
    seed({ assets: ['a', 'b', 'c'], held: { a: held('Shelf A1', null), b: held('Shelf B3', null) } });
    const [r] = await getTicketLinkedAssetLabelParts(ctx, [{ recordId: T, linkedAssetId: 'c' }]);
    expect(r).toMatchObject({ assetId: 'c', assetTag: 'TAG-c', custodyLocation: null, nextAction: null });
  });

  it('unreadable assets contribute nothing to the count', async () => {
    three();
    state.unreadable.add('c');
    const [r] = await getTicketLinkedAssetLabelParts(ctx, [{ recordId: T }]);
    expect(r?.custodyLocation).toBe('2 items held');
    expect(r?.nextAction).toBe('Follow up Oct 29');
    state.unreadable.add('b');
    const [one] = await getTicketLinkedAssetLabelParts(ctx, [{ recordId: T }]);
    expect(one).toMatchObject({ assetId: 'a', custodyLocation: 'Main Office / Shelf A1' });
  });

  it('an unreadable pick is ignored and reveals nothing about that asset', async () => {
    three();
    state.unreadable.add('b');
    const [r] = await getTicketLinkedAssetLabelParts(ctx, [{ recordId: T, linkedAssetId: 'b' }]);
    expect(JSON.stringify(r)).not.toMatch(/Shelf B3|TAG-b/);
    expect(r?.custodyLocation).toBe('2 items held');
  });

  it('a pick that is not linked to the ticket is ignored (treated as no pick)', async () => {
    three();
    const [r] = await getTicketLinkedAssetLabelParts(ctx, [{ recordId: T, linkedAssetId: 'zzz' }]);
    expect(r).toMatchObject({ assetId: '', custodyLocation: '3 items held' });
  });

  it('one held item and no pick: that item', async () => {
    seed({ assets: ['a'], held: { a: held('Shelf A1', '2026-11-02') } });
    const [r] = await getTicketLinkedAssetLabelParts(ctx, [{ recordId: T }]);
    expect(r).toMatchObject({ assetId: 'a', custodyLocation: 'Main Office / Shelf A1', nextAction: 'Waiting on vendor, Nov 2' });
  });

  it('never carries the next-action note; no asset:read gives nulls', async () => {
    three();
    const [r] = await getTicketLinkedAssetLabelParts(ctx, [{ recordId: T, linkedAssetId: 'a' }]);
    expect(JSON.stringify(r)).not.toContain('SECRET NOTE');
    state.canReadAssets = false;
    expect(await getTicketLinkedAssetLabelParts(ctx, [{ recordId: T, linkedAssetId: 'a' }])).toEqual([null]);
  });
});

describe('listTicketLinkedAssetChoices', () => {
  it('returns each readable choice with the custody facts the tag would print', async () => {
    seed({ assets: ['a', 'b'], held: { a: held('Shelf A1', '2026-11-02') } });
    state.unreadable.add('zzz');
    const choices = await listTicketLinkedAssetChoices(ctx, T);
    expect(choices.map((c) => [c.assetId, c.custody?.custodyLocation ?? null])).toEqual([
      ['a', 'Main Office / Shelf A1'],
      ['b', null],
    ]);
    expect(JSON.stringify(choices)).not.toContain('SECRET NOTE');
  });
});
