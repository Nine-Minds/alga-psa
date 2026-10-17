import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T091-T098 (F058 / F060 / F061 / F062 / F063 / F064) — the group invariants and
 * the bundle propagation that is the reason a bundle exists.
 */

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const TENANT = 'tenant-1';
  const dbState: Record<string, Row[]> = {};
  let counter = 0;

  const resetDb = () => {
    for (const key of Object.keys(dbState)) delete dbState[key];
    for (const name of [
      'assets', 'contacts', 'client_locations', 'asset_groups',
      'asset_group_members', 'asset_group_contacts', 'asset_assignments', 'asset_history',
    ]) {
      dbState[name] = [];
    }
    counter = 0;
  };

  const strip = (key: string) => (key.includes('.') ? key.split('.').pop()! : key);

  class QB {
    private readonly table: string;
    private objWheres: Array<Record<string, any>> = [];
    private notWheres: Array<Record<string, any>> = [];
    private nullWheres: Array<{ col: string; isNull: boolean }> = [];
    private inWheres: Array<{ col: string; values: any[] }> = [];

    constructor(spec: string) {
      this.table = spec.split(' as ')[0];
    }

    private get rows(): Row[] {
      if (!dbState[this.table]) dbState[this.table] = [];
      return dbState[this.table];
    }

    where(arg1: any, arg2?: any) {
      if (typeof arg1 === 'function') return this;
      if (typeof arg1 === 'string') {
        this.objWheres.push({ [strip(arg1)]: arg2 });
        return this;
      }
      const normalized: Record<string, any> = {};
      for (const [k, v] of Object.entries(arg1)) normalized[strip(k)] = v;
      this.objWheres.push(normalized);
      return this;
    }

    whereNot(arg1: Record<string, any>) {
      const normalized: Record<string, any> = {};
      for (const [k, v] of Object.entries(arg1)) normalized[strip(k)] = v;
      this.notWheres.push(normalized);
      return this;
    }

    whereNull(col: string) {
      this.nullWheres.push({ col: strip(col), isNull: true });
      return this;
    }

    whereIn(col: string, values: any[]) {
      this.inWheres.push({ col: strip(col), values });
      return this;
    }

    join(_table: string, _fn: unknown) { return this; }
    select(..._cols: unknown[]) { return this; }
    orderBy() { return this; }
    groupBy() { return this; }

    count(expression: string) {
      const alias = expression.includes(' as ') ? expression.split(' as ')[1] : 'count';
      const rows = this.filtered();
      const result: any = Promise.resolve([{ [alias]: String(rows.length) }]);
      result.first = () => Promise.resolve({ [alias]: String(rows.length) });
      return result;
    }

    pluck(col: string) {
      return Promise.resolve(this.filtered().map((row) => row[strip(col)]));
    }

    private filtered(): Row[] {
      let rows = [...this.rows];
      for (const where of this.objWheres) {
        rows = rows.filter((row) => Object.entries(where).every(([k, v]) => row[k] === v));
      }
      for (const where of this.notWheres) {
        rows = rows.filter((row) => !Object.entries(where).every(([k, v]) => row[k] === v));
      }
      for (const { col, isNull } of this.nullWheres) {
        rows = rows.filter((row) => (isNull ? row[col] == null : row[col] != null));
      }
      for (const { col, values } of this.inWheres) {
        rows = rows.filter((row) => values.includes(row[col]));
      }
      return rows;
    }

    first() {
      return Promise.resolve(this.filtered().map((row) => ({ ...row }))[0]);
    }

    insert(data: Row | Row[]) {
      const incoming = (Array.isArray(data) ? data : [data]).map((row) => {
        counter += 1;
        const copy: Row = { ...row };
        if (this.table === 'asset_groups' && !copy.group_id) copy.group_id = `g-${counter}`;
        if (this.table === 'asset_assignments') {
          copy.assignment_id = copy.assignment_id ?? `as-${counter}`;
          copy.unassigned_at = copy.unassigned_at ?? null;
        }
        return copy;
      });
      this.rows.push(...incoming);
      const result: any = Promise.resolve(incoming);
      result.returning = () => Promise.resolve(incoming);
      result.onConflict = () => ({ merge: async (patch: Row) => { Object.assign(incoming[0], patch); } });
      return result;
    }

    update(patch: Row) {
      const rows = this.filtered();
      for (const row of rows) Object.assign(row, patch);
      return Promise.resolve(rows.length);
    }

    delete() {
      const doomed = new Set(this.filtered());
      dbState[this.table] = this.rows.filter((row) => !doomed.has(row));
      return Promise.resolve(doomed.size);
    }

    then(resolve: (value: any) => void, reject?: (reason: unknown) => void) {
      return Promise.resolve(this.filtered().map((row) => ({ ...row }))).then(resolve, reject);
    }
  }

  const knexMock: any = (spec: string) => new QB(spec);
  knexMock.raw = (sql: string, bindings: unknown) => ({ __raw: true, sql, bindings });
  knexMock.fn = { now: () => '2026-10-09T12:00:00.000Z' };

  return { TENANT, dbState, knexMock, resetDb };
});

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, tenant: string) => ({
    table: (name: string) => conn(name).where({ tenant }),
    tenantJoin: (builder: any) => builder,
  }),
}));

const groups = await import('./assetGroups');

const TENANT = h.TENANT;
const CLIENT = 'client-1';
const OTHER_CLIENT = 'client-2';
const ACTOR = 'user-1';

const asset = (id: string, overrides: Row = {}): Row => ({
  tenant: TENANT, asset_id: id, client_id: CLIENT, name: `Asset ${id}`,
  contact_name_id: null, location_id: null, ...overrides,
});

const contact = (id: string, overrides: Row = {}): Row => ({
  tenant: TENANT, contact_name_id: id, client_id: CLIENT, contact_kind: 'person', ...overrides,
});

const makeGroup = (kind: 'bundle' | 'shared_workspace', overrides: Row = {}): Row => {
  const row = {
    tenant: TENANT, group_id: overrides.group_id ?? 'g1', client_id: CLIENT,
    name: kind === 'bundle' ? 'Front desk 1' : 'Hot desk B', kind,
    location_id: null, description: null, created_at: null, updated_at: null, ...overrides,
  };
  h.dbState.asset_groups.push(row);
  return row;
};

beforeEach(() => {
  h.resetDb();
  h.dbState.assets.push(asset('a1'), asset('a2'), asset('a3', { client_id: OTHER_CLIENT }));
  h.dbState.contacts.push(contact('c1'), contact('c2'), contact('c3', { client_id: OTHER_CLIENT }));
  h.dbState.client_locations.push(
    { tenant: TENANT, location_id: 'loc-1', client_id: CLIENT, is_active: true, location_name: 'Lobby' },
  );
});

const add = (groupId: string, assetIds: string[]) =>
  groups.addAssetsToGroupRows(h.knexMock, TENANT, groupId, assetIds, { actorUserId: ACTOR });

describe('addAssetsToGroupRows', () => {
  it('rejects an asset of another client, naming it', async () => {
    makeGroup('bundle');
    await expect(add('g1', ['a3'])).rejects.toThrow(/Asset a3.*another client|belongs to another client/);
    expect(h.dbState.asset_group_members).toHaveLength(0);
  });

  it('rejects an asset that is already in another group', async () => {
    makeGroup('bundle');
    makeGroup('bundle', { group_id: 'g2', name: 'Other bundle' });
    await add('g2', ['a1']);
    await expect(add('g1', ['a1'])).rejects.toThrow(/already in another group/);
  });

  it('assigns each new bundle member to the owner and moves it to the group location', async () => {
    makeGroup('bundle', { location_id: 'loc-1' });
    h.dbState.asset_group_contacts.push({ tenant: TENANT, group_id: 'g1', contact_name_id: 'c1', role: 'owner' });
    h.dbState.assets[0].location = 'Stale address';

    await add('g1', ['a1', 'a2']);

    expect(h.dbState.assets.filter((row) => row.asset_id !== 'a3').map((row) => row.contact_name_id))
      .toEqual(['c1', 'c1']);
    expect(h.dbState.assets[0].location_id).toBe('loc-1');
    // The denormalized label has to move with the id — the Identity tile and the
    // asset list render `location`, not `location_id`.
    expect(h.dbState.assets[0].location).toBe('Lobby');
    const bundleAssignments = h.dbState.asset_assignments.filter((row) => row.source === 'bundle');
    expect(bundleAssignments).toHaveLength(2);
    expect(bundleAssignments[0].note).toBe('Front desk 1');
  });

  it('unassigns an assigned asset added to a shared workspace', async () => {
    makeGroup('shared_workspace');
    h.dbState.assets[0].contact_name_id = 'c1';
    h.dbState.asset_assignments.push({
      tenant: TENANT, assignment_id: 'a0', asset_id: 'a1', contact_name_id: 'c1',
      source: 'manual', unassigned_at: null,
    });

    await add('g1', ['a1']);

    expect(h.dbState.assets[0].contact_name_id).toBeNull();
    expect(h.dbState.asset_assignments[0].unassigned_at).not.toBeNull();
  });

  it('writes group_added history carrying the group id and name', async () => {
    makeGroup('bundle');
    await add('g1', ['a1']);
    const entry = h.dbState.asset_history.find((row) => row.change_type === 'group_added');
    expect(entry?.changes).toMatchObject({ group_id: 'g1', group_name: 'Front desk 1', group_kind: 'bundle' });
  });
});

describe('group people invariants', () => {
  it('refuses a user on a bundle and an owner on a shared workspace', async () => {
    makeGroup('bundle');
    makeGroup('shared_workspace', { group_id: 'g2' });

    await expect(groups.addGroupUser(h.knexMock, TENANT, 'g1', 'c1'))
      .rejects.toThrow(/one owner, not a list of users/);
    await expect(groups.setGroupOwner(h.knexMock, TENANT, 'g2', 'c1'))
      .rejects.toThrow(/users, not an owner/);
  });

  it('refuses a contact of another client', async () => {
    makeGroup('bundle');
    await expect(groups.setGroupOwner(h.knexMock, TENANT, 'g1', 'c3'))
      .rejects.toThrow(/not available for this client/);
  });

  it('keeps at most one bundle owner', async () => {
    makeGroup('bundle');
    await groups.setGroupOwner(h.knexMock, TENANT, 'g1', 'c1', { actorUserId: ACTOR });
    await groups.setGroupOwner(h.knexMock, TENANT, 'g1', 'c2', { actorUserId: ACTOR });
    const owners = h.dbState.asset_group_contacts.filter((row) => row.role === 'owner');
    expect(owners).toHaveLength(1);
    expect(owners[0].contact_name_id).toBe('c2');
  });
});

describe('setGroupOwner propagation', () => {
  it('assigns every member, and clearing the owner unassigns every member', async () => {
    makeGroup('bundle');
    await add('g1', ['a1', 'a2']);

    await groups.setGroupOwner(h.knexMock, TENANT, 'g1', 'c1', { actorUserId: ACTOR });
    expect(h.dbState.assets.slice(0, 2).map((row) => row.contact_name_id)).toEqual(['c1', 'c1']);

    await groups.setGroupOwner(h.knexMock, TENANT, 'g1', null, { actorUserId: ACTOR });
    expect(h.dbState.assets.slice(0, 2).map((row) => row.contact_name_id)).toEqual([null, null]);
  });
});

describe('updateGroupRow', () => {
  it('propagates a location change to every member', async () => {
    makeGroup('bundle');
    await add('g1', ['a1', 'a2']);
    h.dbState.assets[0].location = 'Stale address';

    await groups.updateGroupRow(h.knexMock, TENANT, 'g1', { locationId: 'loc-1', actorUserId: ACTOR });

    expect(h.dbState.assets.slice(0, 2).map((row) => row.location_id)).toEqual(['loc-1', 'loc-1']);
    // Both columns move, so the read surfaces agree with the edit form.
    expect(h.dbState.assets.slice(0, 2).map((row) => row.location)).toEqual(['Lobby', 'Lobby']);
    // A dedicated change type, so the timeline can say "Moved to Lobby with
    // …" instead of "Updated — Group id, Group name".
    const moved = h.dbState.asset_history.filter((row) => row.change_type === 'group_location_changed');
    expect(moved).toHaveLength(2);
    expect(moved[0].changes).toMatchObject({ location_id: 'loc-1', location_name: 'Lobby' });
  });

  it('clears the denormalized label when the group location is cleared', async () => {
    makeGroup('bundle', { location_id: 'loc-1' });
    await add('g1', ['a1']);
    expect(h.dbState.assets[0].location).toBe('Lobby');

    await groups.updateGroupRow(h.knexMock, TENANT, 'g1', { locationId: null, actorUserId: ACTOR });

    expect(h.dbState.assets[0].location_id).toBeNull();
    expect(h.dbState.assets[0].location).toBe('');
  });

  it('refuses shared workspace → bundle while users exist', async () => {
    makeGroup('shared_workspace');
    await groups.addGroupUser(h.knexMock, TENANT, 'g1', 'c1');

    await expect(groups.updateGroupRow(h.knexMock, TENANT, 'g1', { kind: 'bundle' }))
      .rejects.toThrow(/Remove the workspace users/);
  });

  it('unassigns members and drops the owner on bundle → shared workspace', async () => {
    makeGroup('bundle');
    await add('g1', ['a1']);
    await groups.setGroupOwner(h.knexMock, TENANT, 'g1', 'c1', { actorUserId: ACTOR });

    await groups.updateGroupRow(h.knexMock, TENANT, 'g1', { kind: 'shared_workspace', actorUserId: ACTOR });

    expect(h.dbState.assets[0].contact_name_id).toBeNull();
    expect(h.dbState.asset_group_contacts).toHaveLength(0);
    expect(h.dbState.asset_groups[0].kind).toBe('shared_workspace');
  });

  it('rejects a blank name', async () => {
    makeGroup('bundle');
    await expect(groups.updateGroupRow(h.knexMock, TENANT, 'g1', { name: '   ' }))
      .rejects.toThrow(/name is required/);
  });
});

describe('removal and deletion', () => {
  it('removeAssetFromGroupRow leaves the assignee and location alone', async () => {
    makeGroup('bundle', { location_id: 'loc-1' });
    h.dbState.asset_group_contacts.push({ tenant: TENANT, group_id: 'g1', contact_name_id: 'c1', role: 'owner' });
    await add('g1', ['a1']);

    await groups.removeAssetFromGroupRow(h.knexMock, TENANT, 'g1', 'a1', { actorUserId: ACTOR });

    expect(h.dbState.asset_group_members).toHaveLength(0);
    expect(h.dbState.assets[0].contact_name_id).toBe('c1');
    expect(h.dbState.assets[0].location_id).toBe('loc-1');
    expect(h.dbState.asset_history.some((row) => row.change_type === 'group_removed')).toBe(true);
  });

  it('deleteGroupRow removes member and contact rows and leaves the assets alone', async () => {
    makeGroup('bundle');
    h.dbState.asset_group_contacts.push({ tenant: TENANT, group_id: 'g1', contact_name_id: 'c1', role: 'owner' });
    await add('g1', ['a1']);

    await groups.deleteGroupRow(h.knexMock, TENANT, 'g1', { actorUserId: ACTOR });

    expect(h.dbState.asset_groups).toHaveLength(0);
    expect(h.dbState.asset_group_members).toHaveLength(0);
    expect(h.dbState.asset_group_contacts).toHaveLength(0);
    expect(h.dbState.assets[0].contact_name_id).toBe('c1');
  });

  it('removeAssetFromAnyGroup is a no-op for an ungrouped asset', async () => {
    await expect(groups.removeAssetFromAnyGroup(h.knexMock, TENANT, 'a1', { actorUserId: ACTOR }))
      .resolves.toBeUndefined();
  });
});

describe('getAssetGroupSummary', () => {
  it('carries the kind, member count and workspace user count', async () => {
    makeGroup('shared_workspace', { location_id: 'loc-1' });
    await add('g1', ['a1', 'a2']);
    await groups.addGroupUser(h.knexMock, TENANT, 'g1', 'c1');
    await groups.addGroupUser(h.knexMock, TENANT, 'g1', 'c2');

    const summary = await groups.getAssetGroupSummary(h.knexMock, TENANT, 'a1');
    expect(summary).toMatchObject({
      group_id: 'g1',
      kind: 'shared_workspace',
      member_count: 2,
      user_count: 2,
      location_name: 'Lobby',
    });
  });

  it('is null for an ungrouped asset', async () => {
    expect(await groups.getAssetGroupSummary(h.knexMock, TENANT, 'a1')).toBeNull();
  });
});
