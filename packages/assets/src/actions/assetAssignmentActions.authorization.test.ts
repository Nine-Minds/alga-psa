import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const state = {
    readable: true,
    userType: 'internal' as 'internal' | 'client',
    permissions: { read: true, update: true },
    assignments: [] as Row[],
    currentAssignee: 'contact-old' as string | null,
    published: [] as unknown[],
    assignmentWrites: 0,
  };

  const tableName = (value: string) => value.split(' as ')[0];
  const columnName = (value: string) => value.includes('.') ? value.split('.').pop()! : value;
  const trx: any = (tableSpec: string) => {
    const name = tableName(tableSpec);
    let rows = name === 'asset_assignments' ? [...state.assignments] : [{ tenant: 'tenant-1', contact_name_id: 'contact-new', full_name: 'New Contact' }];
    const query: any = {
      where(filters: Row) {
        rows = rows.filter((row) => Object.entries(filters).every(([key, value]) => row[columnName(key)] === value));
        return query;
      },
      select() { return query; },
      orderBy() { return query; },
      first() { return Promise.resolve(rows[0]); },
      then(resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return query;
  };
  trx.raw = () => ({});
  return { state, trx };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'user-1', user_type: h.state.userType }, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(async (_user: unknown, _resource: string, action: 'read' | 'update') => h.state.permissions[action]),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: h.trx })),
  withTransaction: vi.fn(async (_knex: unknown, callback: (trx: unknown) => Promise<unknown>) => callback(h.trx)),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (table: string) => conn(table),
    tenantJoin: () => undefined,
  }),
}));

vi.mock('@alga-psa/authorization/assetReadAuthorization', () => ({
  loadReadableAssetById: vi.fn(async () => h.state.readable ? { asset_id: 'asset-1', client_id: 'client-1' } : null),
}));

vi.mock('../lib/assetAssignment', () => ({
  setAssetAssignee: vi.fn(async (_trx, _tenant, _assetId, contactId) => {
    h.state.assignmentWrites += 1;
    const previousContactId = h.state.currentAssignee;
    h.state.currentAssignee = contactId;
    return { changed: previousContactId !== contactId, previousContactId };
  }),
}));

vi.mock('../lib/assetChangeEvents', () => ({
  publishAssetChanged: vi.fn(async (...args: unknown[]) => { h.state.published.push(args); }),
}));

import { loadReadableAssetById } from '@alga-psa/authorization/assetReadAuthorization';
import { setAssetAssignee } from '../lib/assetAssignment';
import { publishAssetChanged } from '../lib/assetChangeEvents';
import { assignAssetContact, getAssetAssignments } from './assetAssignmentActions';

const assignment = {
  tenant: 'tenant-1', assignment_id: 'assignment-1', asset_id: 'asset-1', contact_name_id: 'contact-old',
  assigned_at: '2026-01-01T00:00:00.000Z', assigned_by_user_id: 'user-2', unassigned_at: null,
  unassigned_by_user_id: null, source: 'manual', note: 'private assignment note',
};

beforeEach(() => {
  h.state.readable = true;
  h.state.userType = 'internal';
  h.state.permissions = { read: true, update: true };
  h.state.assignments = [{ ...assignment }];
  h.state.currentAssignee = 'contact-old';
  h.state.published = [];
  h.state.assignmentWrites = 0;
  vi.clearAllMocks();
});

describe('asset assignment record-level authorization', () => {
  it.each(['internal', 'client'] as const)('hides assignment details and blocks reassignment for a restricted %s user with coarse permissions', async (userType) => {
    h.state.userType = userType;
    h.state.readable = false;

    expect(await getAssetAssignments('asset-1')).toEqual([]);
    const writeResult = await assignAssetContact('asset-1', 'contact-new');

    expect(writeResult).toMatchObject({ actionError: expect.any(String) });
    expect(h.state.currentAssignee).toBe('contact-old');
    expect(h.state.assignmentWrites).toBe(0);
    expect(h.state.published).toEqual([]);
    expect(loadReadableAssetById).toHaveBeenCalledTimes(2);
    expect(setAssetAssignee).not.toHaveBeenCalled();
    expect(publishAssetChanged).not.toHaveBeenCalled();
  });

  it('returns assignment details and publishes a permitted reassignment', async () => {
    expect(await getAssetAssignments('asset-1')).toMatchObject([{ note: 'private assignment note', contact_name_id: 'contact-old' }]);
    expect(await assignAssetContact('asset-1', 'contact-new')).toEqual({ contact_name_id: 'contact-new', contact_name: 'New Contact' });

    expect(h.state.currentAssignee).toBe('contact-new');
    expect(h.state.assignmentWrites).toBe(1);
    expect(h.state.published).toHaveLength(1);
    expect(setAssetAssignee).toHaveBeenCalledTimes(1);
    expect(publishAssetChanged).toHaveBeenCalledTimes(1);
  });

  it('keeps the existing coarse read and update permission denials', async () => {
    h.state.permissions.read = false;
    const readResult = await getAssetAssignments('asset-1');
    expect(readResult).toMatchObject({ permissionError: expect.any(String) });

    h.state.permissions.update = false;
    const writeResult = await assignAssetContact('asset-1', 'contact-new');
    expect(writeResult).toMatchObject({ permissionError: expect.any(String) });
    expect(loadReadableAssetById).not.toHaveBeenCalled();
    expect(h.state.assignmentWrites).toBe(0);
    expect(h.state.published).toEqual([]);
  });
});
