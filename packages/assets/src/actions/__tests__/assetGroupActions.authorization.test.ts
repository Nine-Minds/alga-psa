import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  scopeAllowed: true,
  queriedDetails: 0,
  listed: 0,
  created: 0,
  updated: 0,
  deleted: 0,
  addedMembers: 0,
  removedMembers: 0,
  changedOwner: 0,
  changedUsers: 0,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u1', user_type: 'internal' }, { tenant: 't1' }, ...args),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_knex: unknown, work: (trx: any) => Promise<unknown>) => work({})),
  tenantDb: () => ({
    table: () => ({
      where() { return this; }, whereIn() { return this; }, select() { return Promise.resolve([]); },
    }),
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../lib/assetGroupAuthorization', () => ({
  isAssetGroupOperationAllowed: vi.fn(async () => h.scopeAllowed),
}));
vi.mock('../../lib/assetGroups', () => ({
  isAssetGroupError: () => false,
  listGroupMemberIds: vi.fn(async () => []),
  listGroupsForClient: vi.fn(async () => { h.listed++; return [{ group_id: 'g1' }]; }),
  getGroupWithDetails: vi.fn(async () => { h.queriedDetails++; return { group_id: 'g1', members: [{ asset_id: 'a1' }] }; }),
  createGroup: vi.fn(async () => { h.created++; return { group_id: 'g1' }; }),
  updateGroupRow: vi.fn(async () => { h.updated++; }),
  deleteGroupRow: vi.fn(async () => { h.deleted++; return { success: true }; }),
  addAssetsToGroupRows: vi.fn(async () => { h.addedMembers++; }),
  removeAssetFromGroupRow: vi.fn(async () => { h.removedMembers++; }),
  setGroupOwner: vi.fn(async () => { h.changedOwner++; }),
  addGroupUser: vi.fn(async () => { h.changedUsers++; }),
  removeGroupUser: vi.fn(async () => { h.changedUsers++; }),
  listContactSharedWorkspaces: vi.fn(async () => []),
}));
vi.mock('@alga-psa/shared/models/assetTicketContactModel', () => ({ resolveAssetTicketContactOptions: vi.fn(async () => []) }));
vi.mock('../../lib/assetChangeEvents', () => ({ publishAssetChanged: vi.fn(async () => {}) }));

import {
  addAssetGroupUser,
  addAssetsToGroup,
  createAssetGroup,
  deleteAssetGroup,
  getAssetGroup,
  listAssetGroups,
  removeAssetFromGroup,
  removeAssetGroupUser,
  setAssetGroupOwner,
  updateAssetGroup,
} from '../assetGroupActions';
import * as groups from '../../lib/assetGroups';
import { isAssetGroupOperationAllowed } from '../../lib/assetGroupAuthorization';

describe('asset group record authorization', () => {
  beforeEach(() => {
    Object.assign(h, { scopeAllowed: true, queriedDetails: 0, listed: 0, created: 0, updated: 0, deleted: 0, addedMembers: 0, removedMembers: 0, changedOwner: 0, changedUsers: 0 });
    vi.mocked(isAssetGroupOperationAllowed).mockImplementation(async () => h.scopeAllowed);
    vi.clearAllMocks();
  });

  it('returns an allowed group detail and authorizes the caller supplied group id', async () => {
    await expect(getAssetGroup('arbitrary-client-group-id')).resolves.toMatchObject({ group_id: 'g1', members: [{ asset_id: 'a1' }] });
    expect(isAssetGroupOperationAllowed).toHaveBeenCalledWith({}, 't1', expect.anything(), { action: 'read', groupId: 'arbitrary-client-group-id' });
    expect(h.queriedDetails).toBe(1);
  });

  it('does not resolve details for an inaccessible group id', async () => {
    h.scopeAllowed = false;
    await expect(getAssetGroup('excluded-group')).resolves.toHaveProperty('permissionError');
    expect(h.queriedDetails).toBe(0);
  });

  it('rejects an excluded client before listing groups', async () => {
    h.scopeAllowed = false;
    await expect(listAssetGroups('excluded-client')).resolves.toHaveProperty('permissionError');
    expect(isAssetGroupOperationAllowed).toHaveBeenCalledWith({}, 't1', expect.anything(), { action: 'read', clientId: 'excluded-client' });
    expect(h.listed).toBe(0);
  });

  it('rejects creation before any group or member writes when client or a supplied asset is inaccessible', async () => {
    h.scopeAllowed = false;
    await expect(createAssetGroup({ clientId: 'excluded-client', name: 'g', kind: 'bundle', assetIds: ['a1'] })).resolves.toHaveProperty('permissionError');
    expect(h.created).toBe(0);
    expect(h.addedMembers).toBe(0);
  });

  it('rejects mutations without writes for arbitrary group and supplied member asset ids', async () => {
    h.scopeAllowed = false;
    const calls = [
      updateAssetGroup('arbitrary-group', { name: 'changed' }),
      deleteAssetGroup('arbitrary-group'),
      addAssetsToGroup('arbitrary-group', ['excluded-asset']),
      removeAssetFromGroup('arbitrary-group', 'excluded-asset'),
      setAssetGroupOwner('arbitrary-group', 'contact-1'),
      addAssetGroupUser('arbitrary-group', 'contact-1'),
      removeAssetGroupUser('arbitrary-group', 'contact-1'),
    ];
    const results = await Promise.all(calls);
    expect(results.every((result: any) => Boolean(result?.permissionError))).toBe(true);
    expect(h.updated + h.deleted + h.addedMembers + h.removedMembers + h.changedOwner + h.changedUsers).toBe(0);
  });

  it('performs in-scope mutations and preserves returned detail behavior', async () => {
    await expect(updateAssetGroup('g1', { name: 'new name' })).resolves.toMatchObject({ group_id: 'g1' });
    await expect(addAssetsToGroup('g1', ['a1'])).resolves.toMatchObject({ group_id: 'g1' });
    await expect(setAssetGroupOwner('g1', 'contact-1')).resolves.toMatchObject({ group_id: 'g1' });
    expect(h.updated).toBe(1);
    expect(h.addedMembers).toBe(1);
    expect(h.changedOwner).toBe(1);
    expect(groups.getGroupWithDetails).toHaveBeenCalled();
  });
});
