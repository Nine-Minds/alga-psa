import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FR-C2 unit coverage for the single assignee write helper, against an
 * in-memory query builder: the open/closed row pair, the no-op path, the
 * client-boundary rejection and the shared-workspace guard.
 */

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const TENANT = 'a0000000-0000-4000-8000-00000000000a';
  const dbState: Record<string, Row[]> = {};
  let uuid = 0;

  const resetDb = () => {
    for (const key of Object.keys(dbState)) delete dbState[key];
    dbState.assets = [];
    dbState.contacts = [];
    dbState.asset_assignments = [];
    dbState.asset_history = [];
    dbState.asset_group_members = [];
    dbState.asset_groups = [];
    uuid = 0;
  };

  const strip = (key: string) => (key.includes('.') ? key.split('.').pop()! : key);

  class QB {
    private readonly table: string;
    private objWheres: Array<Record<string, any>> = [];
    private notWheres: Array<Record<string, any>> = [];
    private nullWheres: Array<{ col: string; isNull: boolean }> = [];

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

    join(_table: string, _fn: unknown) {
      // The workspace lookup joins asset_groups; the member rows in this
      // harness already carry the group kind, so the join is a pass-through.
      return this;
    }

    select(..._cols: unknown[]) {
      return this;
    }

    orderBy() {
      return this;
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
      return rows;
    }

    first() {
      return Promise.resolve(this.filtered().map((row) => ({ ...row }))[0]);
    }

    insert(data: Row | Row[]) {
      const incoming = (Array.isArray(data) ? data : [data]).map((row) => {
        uuid += 1;
        return { assignment_id: `as-${uuid}`, unassigned_at: null, ...row };
      });
      this.rows.push(...incoming);
      const result: any = Promise.resolve(incoming);
      result.returning = () => Promise.resolve(incoming);
      return result;
    }

    update(patch: Row) {
      const rows = this.filtered();
      for (const row of rows) Object.assign(row, patch);
      return Promise.resolve(rows.length);
    }

    then(resolve: (value: any) => void, reject?: (reason: unknown) => void) {
      return Promise.resolve(this.filtered()).then(resolve, reject);
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
  }),
}));

const { setAssetAssignee, isAssetAssigneeError } = await import('../assetAssignmentModel');

const TENANT = h.TENANT;
const ASSET = 'f0000000-0000-4000-8000-00000000000f';
const CLIENT = 'b0000000-0000-4000-8000-00000000000b';
const CONTACT_A = '11000000-0000-4000-8000-000000000001';
const CONTACT_B = '11000000-0000-4000-8000-000000000002';
const ACTOR = 'd0000000-0000-4000-8000-00000000000d';

beforeEach(() => {
  h.resetDb();
  h.dbState.assets.push({ tenant: TENANT, asset_id: ASSET, client_id: CLIENT, contact_name_id: null });
  h.dbState.contacts.push(
    { tenant: TENANT, contact_name_id: CONTACT_A, client_id: CLIENT, contact_kind: 'person' },
    { tenant: TENANT, contact_name_id: CONTACT_B, client_id: CLIENT, contact_kind: 'person' },
    { tenant: TENANT, contact_name_id: 'mailbox', client_id: CLIENT, contact_kind: 'shared_mailbox' },
    { tenant: TENANT, contact_name_id: 'other-client', client_id: 'other', contact_kind: 'person' },
  );
});

const assign = (contactId: string | null, extra?: Record<string, unknown>) =>
  setAssetAssignee(h.knexMock as any, TENANT, ASSET, contactId, {
    actorUserId: ACTOR,
    source: 'manual',
    ...extra,
  } as any);

describe('setAssetAssignee', () => {
  it('opens an assignment, sets the column and writes assignee_changed history', async () => {
    const result = await assign(CONTACT_A);
    expect(result).toMatchObject({ changed: true, previousContactId: null, contactId: CONTACT_A });
    expect(h.dbState.asset_assignments).toHaveLength(1);
    expect(h.dbState.asset_assignments[0]).toMatchObject({
      asset_id: ASSET,
      contact_name_id: CONTACT_A,
      unassigned_at: null,
      source: 'manual',
      assigned_by_user_id: ACTOR,
    });
    expect(h.dbState.assets[0].contact_name_id).toBe(CONTACT_A);
    expect(h.dbState.asset_history).toHaveLength(1);
    expect(h.dbState.asset_history[0]).toMatchObject({ change_type: 'assignee_changed' });
  });

  it('closes the previous row on reassignment', async () => {
    await assign(CONTACT_A);
    await assign(CONTACT_B);
    expect(h.dbState.asset_assignments).toHaveLength(2);
    expect(h.dbState.asset_assignments[0].unassigned_at).not.toBeNull();
    expect(h.dbState.asset_assignments[0].unassigned_by_user_id).toBe(ACTOR);
    expect(h.dbState.asset_assignments[1].unassigned_at).toBeNull();
  });

  it('closes the open row and nulls the column on unassign', async () => {
    await assign(CONTACT_A);
    const result = await assign(null);
    expect(result.changed).toBe(true);
    expect(h.dbState.asset_assignments).toHaveLength(1);
    expect(h.dbState.asset_assignments[0].unassigned_at).not.toBeNull();
    expect(h.dbState.assets[0].contact_name_id).toBeNull();
  });

  it('is a no-op when the assignee is unchanged', async () => {
    await assign(CONTACT_A);
    const result = await assign(CONTACT_A);
    expect(result.changed).toBe(false);
    expect(h.dbState.asset_assignments).toHaveLength(1);
    expect(h.dbState.asset_history).toHaveLength(1);
  });

  it('rejects a contact of another client and a shared mailbox', async () => {
    await expect(assign('other-client')).rejects.toThrow(/not available for this client/);
    await expect(assign('mailbox')).rejects.toThrow(/not available for this client/);
    expect(h.dbState.asset_assignments).toHaveLength(0);
  });

  it('rejects a non-null contact on a shared-workspace member with a typed error', async () => {
    h.dbState.asset_groups.push({ tenant: TENANT, group_id: 'g1', kind: 'shared_workspace' });
    h.dbState.asset_group_members.push({ tenant: TENANT, group_id: 'g1', asset_id: ASSET, kind: 'shared_workspace' });

    const error = await assign(CONTACT_A).catch((err: unknown) => err);
    expect(isAssetAssigneeError(error)).toBe(true);
    expect((error as any).code).toBe('workspace_member');
  });

  it('still unassigns a shared-workspace member (the clear is always allowed)', async () => {
    h.dbState.assets[0].contact_name_id = CONTACT_A;
    h.dbState.asset_groups.push({ tenant: TENANT, group_id: 'g1', kind: 'shared_workspace' });
    h.dbState.asset_group_members.push({ tenant: TENANT, group_id: 'g1', asset_id: ASSET, kind: 'shared_workspace' });

    const result = await assign(null);
    expect(result.changed).toBe(true);
    expect(h.dbState.assets[0].contact_name_id).toBeNull();
  });

  it('still writes history when there is no actor (sessionless RMM sync)', async () => {
    await setAssetAssignee(h.knexMock as any, TENANT, ASSET, CONTACT_A, {
      actorUserId: null,
      source: 'rmm',
      provider: 'levelio',
      note: 'CORP\\jdoe',
    });
    expect(h.dbState.asset_assignments).toHaveLength(1);
    expect(h.dbState.asset_assignments[0].note).toBe('CORP\\jdoe');
    // `asset_history.changed_by` is nullable since 20261009125200, so the
    // auto-assignment is visible on the timeline and names its provider.
    expect(h.dbState.asset_history).toHaveLength(1);
    expect(h.dbState.asset_history[0]).toMatchObject({
      change_type: 'assignee_changed',
      changed_by: null,
    });
    expect(h.dbState.asset_history[0].changes).toMatchObject({
      source: 'rmm',
      provider: 'levelio',
      note: 'CORP\\jdoe',
      contact_name_id: CONTACT_A,
    });
  });
});
