import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
const h = vi.hoisted(() => ({
  trx: { transactionId: 'group-operation' },
  user: { user_id: 'u1', user_type: 'internal', roles: ['r1'] },
  context: { subject: { userId: 'u1' } },
  tables: {} as Record<string, Row[]>,
  groupListing: [] as Row[],
  deniedClients: new Set<string>(),
  deniedReadAssets: new Set<string>(),
  deniedUpdateAssets: new Set<string>(),
  beforeGroupLock: undefined as (() => Promise<void>) | undefined,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(h.user, { tenant: 't1' }, ...args),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_knex: unknown, work: (trx: any) => Promise<unknown>) => work(h.trx)),
  tenantDb: (_trx: unknown, tenant: string) => ({
    table(name: string) {
      let rows = (h.tables[name] ?? []).filter((row) => row.tenant === tenant);
      let forUpdate = false;
      const query = {
        where(criteria: Row) {
          rows = rows.filter((row) => Object.entries(criteria).every(([key, value]) => row[key] === value));
          return query;
        },
        whereIn(key: string, values: string[]) {
          rows = rows.filter((row) => values.includes(row[key] as string));
          return query;
        },
        select: async () => rows,
        forUpdate() {
          forUpdate = true;
          return query;
        },
        first: async () => {
          if (forUpdate) await h.beforeGroupLock?.();
          return rows[0];
        },
        pluck: async (key: string) => rows.map((row) => row[key]),
      };
      return query;
    },
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Exercise production group authorization with controlled asset permissions.
vi.mock('../../lib/assetReadAuthorization', () => ({
  createAssetReadContext: vi.fn(async () => h.context),
  isAssetClientActionAllowed: vi.fn(async (_trx: unknown, _tenant: string, _context: unknown, clientId: string) =>
    !h.deniedClients.has(clientId)),
  isAssetReadAllowed: vi.fn(async (_trx: unknown, _tenant: string, _context: unknown, asset: { asset_id: string }) =>
    !h.deniedReadAssets.has(asset.asset_id)),
  isAssetActionAllowed: vi.fn(async (_trx: unknown, _tenant: string, _context: unknown, asset: { asset_id: string }) =>
    !h.deniedUpdateAssets.has(asset.asset_id)),
}));
vi.mock('../../lib/assetGroups', async (importOriginal) => ({
  // Keep the production mutation lock so authorization exercises its query and ordering.
  ...await importOriginal<typeof import('../../lib/assetGroups')>(),
  listGroupMemberIds: vi.fn(async () => ['a1', 'a2']),
  listGroupsForClient: vi.fn(async () => h.groupListing),
  getGroupWithDetails: vi.fn(async () => ({
    group_id: 'g1',
    members: [{ asset_id: 'a1' }, { asset_id: 'a2' }],
    contacts: [{ contact_name: 'Private contact', email: 'private@example.com' }],
  })),
  createGroup: vi.fn(async () => ({ group_id: 'g1' })),
  updateGroupRow: vi.fn(async () => {}),
  deleteGroupRow: vi.fn(async () => {}),
  addAssetsToGroupRows: vi.fn(async () => {}),
  removeAssetFromGroupRow: vi.fn(async () => {}),
  setGroupOwner: vi.fn(async () => {}),
  addGroupUser: vi.fn(async () => {}),
  removeGroupUser: vi.fn(async () => {}),
  listContactSharedWorkspaces: vi.fn(async () => [{ group_id: 'g1' }]),
}));
vi.mock('@alga-psa/shared/models/assetTicketContactModel', () => ({ resolveAssetTicketContactOptions: vi.fn() }));
vi.mock('../../lib/assetChangeEvents', () => ({ publishAssetChanged: vi.fn(async () => {}) }));

import { hasPermission } from '@alga-psa/auth';
import { revalidatePath } from 'next/cache';
import { publishAssetChanged } from '../../lib/assetChangeEvents';
import {
  createAssetReadContext,
  isAssetReadAllowed,
} from '../../lib/assetReadAuthorization';
import * as groups from '../../lib/assetGroups';
import {
  addAssetGroupUser,
  addAssetsToGroup,
  createAssetGroup,
  deleteAssetGroup,
  getAssetGroup,
  getContactSharedWorkspaces,
  listAssetGroups,
  removeAssetFromGroup,
  removeAssetGroupUser,
  setAssetGroupOwner,
  updateAssetGroup,
} from '../assetGroupActions';

const createInput = { clientId: 'c1', name: 'Group', kind: 'bundle' as const, assetIds: ['a1', 'a3'] };
const mutations = [
  { name: 'update', run: () => updateAssetGroup('g1', { name: 'Changed' }), write: groups.updateGroupRow },
  { name: 'delete', run: () => deleteAssetGroup('g1'), write: groups.deleteGroupRow },
  { name: 'member-add', run: () => addAssetsToGroup('g1', ['a3']), write: groups.addAssetsToGroupRows },
  { name: 'member-remove', run: () => removeAssetFromGroup('g1', 'a1'), write: groups.removeAssetFromGroupRow },
  { name: 'owner change', run: () => setAssetGroupOwner('g1', 'contact-1'), write: groups.setGroupOwner },
  { name: 'user-add', run: () => addAssetGroupUser('g1', 'contact-1'), write: groups.addGroupUser },
  { name: 'user-remove', run: () => removeAssetGroupUser('g1', 'contact-1'), write: groups.removeGroupUser },
];
const writes = [groups.createGroup, ...mutations.map(({ write }) => write)];

function expectNoSideEffects(): void {
  for (const write of writes) expect(write).not.toHaveBeenCalled();
  expect(groups.getGroupWithDetails).not.toHaveBeenCalled();
  expect(publishAssetChanged).not.toHaveBeenCalled();
  expect(revalidatePath).not.toHaveBeenCalled();
}

function permissionDenied(action: 'read' | 'update') {
  return expect.objectContaining({
    permissionError: expect.any(String),
    messageKey: `msp/assets:errors.permissions.${action}Assets`,
  });
}

describe('asset group record authorization at the action boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasPermission).mockResolvedValue(true);
    h.deniedClients = new Set();
    h.deniedReadAssets = new Set();
    h.deniedUpdateAssets = new Set();
    h.beforeGroupLock = undefined;
    h.groupListing = [{ group_id: 'g1' }];
    h.tables = {
      clients: [{ tenant: 't1', client_id: 'c1' }],
      asset_groups: [{ tenant: 't1', group_id: 'g1', client_id: 'c1' }],
      asset_group_members: ['a1', 'a2'].map((asset_id) => ({ tenant: 't1', group_id: 'g1', asset_id })),
      assets: ['a1', 'a2', 'a3'].map((asset_id) => ({ tenant: 't1', client_id: 'c1', asset_id })),
    };
  });

  it.each(['client', 'member'] as const)('denies getAssetGroup with an out-of-scope %s without returning details', async (scope) => {
    if (scope === 'client') h.deniedClients.add('c1');
    else h.deniedReadAssets.add('a2');
    await expect(getAssetGroup('g1')).resolves.toEqual(permissionDenied('read'));
    expectNoSideEffects();
  });

  it('authorizes every member and reads details on the same transaction', async () => {
    await expect(getAssetGroup('g1')).resolves.toMatchObject({ group_id: 'g1', members: [{ asset_id: 'a1' }, { asset_id: 'a2' }] });
    expect(createAssetReadContext).toHaveBeenCalledWith(h.trx, 't1', h.user);
    for (const asset_id of ['a1', 'a2']) {
      expect(isAssetReadAllowed).toHaveBeenCalledWith(h.trx, 't1', h.context, expect.objectContaining({ asset_id, client_id: 'c1' }));
    }
    expect(groups.getGroupWithDetails).toHaveBeenCalledWith(h.trx, 't1', 'g1');
  });

  it('denies listAssetGroups before calling listGroupsForClient for an excluded client', async () => {
    h.deniedClients.add('c1');
    await expect(listAssetGroups('c1')).resolves.toEqual(permissionDenied('read'));
    expect(groups.listGroupsForClient).not.toHaveBeenCalled();
  });

  it('preserves an in-scope client listing', async () => {
    await expect(listAssetGroups('c1')).resolves.toEqual([{ group_id: 'g1' }]);
    expect(groups.listGroupsForClient).toHaveBeenCalledWith(h.trx, 't1', 'c1');
  });

  it('omits out-of-scope and mixed-member groups with all their listing metadata', async () => {
    h.tables.asset_groups = [
      { tenant: 't1', group_id: 'in-team', client_id: 'c1' },
      { tenant: 't1', group_id: 'out-team', client_id: 'c1' },
      { tenant: 't1', group_id: 'mixed', client_id: 'c1' },
    ];
    h.tables.asset_group_members = [
      { tenant: 't1', group_id: 'in-team', asset_id: 'in-asset' },
      { tenant: 't1', group_id: 'out-team', asset_id: 'out-asset' },
      { tenant: 't1', group_id: 'mixed', asset_id: 'in-asset' },
      { tenant: 't1', group_id: 'mixed', asset_id: 'out-asset' },
    ];
    h.tables.assets = [
      { tenant: 't1', client_id: 'c1', asset_id: 'in-asset' },
      { tenant: 't1', client_id: 'c1', asset_id: 'out-asset' },
    ];
    h.groupListing = [
      { group_id: 'in-team', name: 'Visible group', description: 'Visible description', member_count: 1 },
      { group_id: 'out-team', name: 'Hidden group', description: 'Hidden description', member_count: 1 },
      { group_id: 'mixed', name: 'Mixed group', description: 'Mixed description', member_count: 2 },
    ];
    h.deniedReadAssets.add('out-asset');

    const result = await listAssetGroups('c1');

    expect(result).toEqual([h.groupListing[0]]);
    const serialized = JSON.stringify(result);
    for (const privateValue of ['out-team', 'Hidden group', 'Hidden description', 'mixed', 'Mixed group', 'Mixed description']) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('propagates unexpected authorization failures while listing groups', async () => {
    vi.mocked(isAssetReadAllowed).mockRejectedValueOnce(new Error('authorization database unavailable'));
    await expect(listAssetGroups('c1')).rejects.toThrow('authorization database unavailable');
  });

  it.each(['client', 'supplied member'] as const)('denies create for an out-of-scope %s before any writes', async (scope) => {
    if (scope === 'client') h.deniedClients.add('c1');
    else h.deniedReadAssets.add('a3');
    await expect(createAssetGroup(createInput)).resolves.toEqual(permissionDenied('update'));
    expectNoSideEffects();
  });

  it('denies creation of an empty group for an excluded client', async () => {
    h.deniedClients.add('c1');
    await expect(createAssetGroup({ ...createInput, assetIds: [] })).resolves.toEqual(permissionDenied('update'));
    expectNoSideEffects();
  });

  it('creates an in-scope group and supplied members on the authorized transaction', async () => {
    await expect(createAssetGroup(createInput)).resolves.toHaveProperty('group_id', 'g1');
    expect(groups.createGroup).toHaveBeenCalledWith(h.trx, 't1', { ...createInput, actorUserId: 'u1' });
    expect(groups.addAssetsToGroupRows).toHaveBeenCalledWith(h.trx, 't1', 'g1', ['a1', 'a3'], { actorUserId: 'u1' });
  });

  describe.each(mutations)('$name', ({ run, write, name }) => {
    it.each(['client', 'member read', 'member update'] as const)('denies an out-of-scope %s without applying the mutation', async (scope) => {
      if (scope === 'client') h.deniedClients.add('c1');
      else if (scope === 'member read') h.deniedReadAssets.add('a2');
      else h.deniedUpdateAssets.add('a2');
      await expect(run()).resolves.toEqual(permissionDenied('update'));
      expectNoSideEffects();
    });

    it('preserves the fully in-scope operation', async () => {
      await expect(run()).resolves.toMatchObject(name === 'delete' ? { success: true } : { group_id: 'g1' });
      expect(write).toHaveBeenCalledOnce();
      expect(vi.mocked(write).mock.calls[0][0]).toBe(h.trx);
      expect(revalidatePath).toHaveBeenCalled();
    });

    it('denies a restricted member committed while waiting for the group lock', async () => {
      let enterLock!: () => void;
      let releaseLock!: () => void;
      const lockEntered = new Promise<void>((resolve) => { enterLock = resolve; });
      const lockReleased = new Promise<void>((resolve) => { releaseLock = resolve; });
      h.beforeGroupLock = async () => {
        enterLock();
        await lockReleased;
      };

      const operation = run();
      await lockEntered;
      try {
        expect(createAssetReadContext).not.toHaveBeenCalled();
        expectNoSideEffects();
        h.tables.asset_group_members.push({ tenant: 't1', group_id: 'g1', asset_id: 'a3' });
        h.deniedUpdateAssets.add('a3');
      } finally {
        releaseLock();
      }

      await expect(operation).resolves.toEqual(permissionDenied('update'));
      expectNoSideEffects();
    });
  });

  it('authorizes supplied additions as well as existing members', async () => {
    h.deniedReadAssets.add('a3');
    await expect(addAssetsToGroup('g1', ['a3'])).resolves.toEqual(permissionDenied('update'));
    expectNoSideEffects();
  });

  it('authorizes the removed asset before removing its membership', async () => {
    h.deniedReadAssets.add('a1');
    await expect(removeAssetFromGroup('g1', 'a1')).resolves.toEqual(permissionDenied('update'));
    expectNoSideEffects();
  });

  it.each(['missing', 'foreign-tenant', 'foreign-client'])('rejects a %s supplied asset before creating a group', async (assetId) => {
    h.tables.assets.push(
      { tenant: 't2', client_id: 'c1', asset_id: 'foreign-tenant' },
      { tenant: 't1', client_id: 'c2', asset_id: 'foreign-client' },
    );
    await expect(createAssetGroup({ ...createInput, assetIds: [assetId] })).resolves.toEqual(permissionDenied('update'));
    expectNoSideEffects();
  });

  it('retains coarse permission checks as an outer bound', async () => {
    vi.mocked(hasPermission).mockResolvedValue(false);
    await expect(getAssetGroup('g1')).resolves.toEqual(permissionDenied('read'));
    await expect(listAssetGroups('c1')).resolves.toEqual(permissionDenied('read'));
    await expect(createAssetGroup(createInput)).resolves.toEqual(permissionDenied('update'));
    for (const { run } of mutations) await expect(run()).resolves.toEqual(permissionDenied('update'));
    expect(createAssetReadContext).not.toHaveBeenCalled();
    expectNoSideEffects();
  });

  it('preserves withGroupErrors for authorized operations that violate a group invariant', async () => {
    const error = Object.assign(new Error('Group name is required'), { name: 'AssetGroupError', code: 'invalid_name' });
    vi.mocked(groups.updateGroupRow).mockRejectedValueOnce(error);
    await expect(updateAssetGroup('g1', { name: '' })).resolves.toMatchObject({
      actionError: error.message,
      messageKey: 'msp/assets:errors.assetGroup.invalid_name',
    });
    expect(publishAssetChanged).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('filters excluded shared workspaces on the contact surface', async () => {
    h.deniedReadAssets.add('a2');
    await expect(getContactSharedWorkspaces('contact-1')).resolves.toEqual([]);
  });
});
