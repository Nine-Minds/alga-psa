import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T071-T076 (F045) — the auto-assignment guard rails: only in `auto` mode, only
 * on an unassigned or rmm-assigned device, never on a shared-workspace member,
 * and never an unassign when the signed-in user is empty.
 */

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const dbState: Record<string, Row[]> = {};

  const resetDb = () => {
    for (const key of Object.keys(dbState)) delete dbState[key];
    dbState.assets = [];
    dbState.contacts = [];
    dbState.asset_assignments = [];
    dbState.asset_history = [];
    dbState.asset_group_members = [];
    dbState.asset_groups = [];
    dbState.tenant_external_entity_mappings = [];
  };

  const strip = (key: string) => (key.includes('.') ? key.split('.').pop()! : key);

  class QB {
    private readonly table: string;
    private objWheres: Array<Record<string, any>> = [];
    private notWheres: Array<Record<string, any>> = [];
    private nullWheres: Array<{ col: string; isNull: boolean }> = [];
    private order: { col: string; dir: string } | null = null;

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
      return this;
    }

    select(..._cols: unknown[]) {
      return this;
    }

    orderBy(col: string, dir = 'asc') {
      this.order = { col: strip(col), dir };
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
      if (this.order) {
        const { col, dir } = this.order;
        rows.sort((a, b) => String(a[col] ?? '').localeCompare(String(b[col] ?? '')) * (dir === 'desc' ? -1 : 1));
      }
      return rows;
    }

    first() {
      return Promise.resolve(this.filtered().map((row) => ({ ...row }))[0]);
    }

    insert(data: Row | Row[]) {
      const incoming = (Array.isArray(data) ? data : [data]).map((row, index) => ({
        assignment_id: `as-${this.rows.length + index + 1}`,
        unassigned_at: null,
        ...row,
      }));
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
      return Promise.resolve(this.filtered().map((row) => ({ ...row }))).then(resolve, reject);
    }
  }

  const knexMock: any = (spec: string) => new QB(spec);
  knexMock.raw = (sql: string, bindings: unknown) => ({ __raw: true, sql, bindings });
  knexMock.fn = { now: () => '2026-10-09T12:00:00.000Z' };

  return { dbState, knexMock, resetDb };
});

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, tenant: string) => ({
    table: (name: string) => conn(name).where({ tenant }),
  }),
}));

const { applyRmmSignedInUserAssignment } = await import('../autoAssignFromSignedInUser');

const TENANT = 'tenant-1';
const CLIENT = 'client-1';
const ASSET = 'asset-1';
const INTEGRATION = 'integration-1';

beforeEach(() => {
  h.resetDb();
  h.dbState.assets.push({ tenant: TENANT, asset_id: ASSET, client_id: CLIENT, contact_name_id: null });
  h.dbState.contacts.push(
    { tenant: TENANT, contact_name_id: 'c-jane', client_id: CLIENT, contact_kind: 'person', email: 'jdoe@acme.com', full_name: 'Jane Doe' },
    { tenant: TENANT, contact_name_id: 'c-sam', client_id: CLIENT, contact_kind: 'person', email: 'spatel@acme.com', full_name: 'Sam Patel' },
  );
});

const run = (mode: string, currentUser: string | null) =>
  applyRmmSignedInUserAssignment(h.knexMock, {
    tenant: TENANT,
    assetId: ASSET,
    clientId: CLIENT,
    integrationId: INTEGRATION,
    provider: 'tacticalrmm',
    mode,
    currentUser,
    actorUserId: null,
  });

describe('applyRmmSignedInUserAssignment', () => {
  it('assigns an unassigned device in auto mode, with source rmm and the raw user as the note', async () => {
    const result = await run('auto', 'CORP\\jdoe');
    expect(result).toMatchObject({ assigned: true, contactId: 'c-jane' });
    expect(h.dbState.asset_assignments).toHaveLength(1);
    expect(h.dbState.asset_assignments[0]).toMatchObject({
      contact_name_id: 'c-jane',
      source: 'rmm',
      note: 'CORP\\jdoe',
    });
    expect(h.dbState.assets[0].contact_name_id).toBe('c-jane');
  });

  it('never overrides a manual assignment', async () => {
    h.dbState.assets[0].contact_name_id = 'c-sam';
    h.dbState.asset_assignments.push({
      tenant: TENANT, assignment_id: 'a1', asset_id: ASSET, contact_name_id: 'c-sam',
      source: 'manual', unassigned_at: null, assigned_at: '2026-10-01T00:00:00.000Z',
    });

    const result = await run('auto', 'CORP\\jdoe');
    expect(result).toMatchObject({ assigned: false, reason: 'manual_assignment' });
    expect(h.dbState.assets[0].contact_name_id).toBe('c-sam');
  });

  it('reassigns a device whose open assignment came from rmm', async () => {
    h.dbState.assets[0].contact_name_id = 'c-sam';
    h.dbState.asset_assignments.push({
      tenant: TENANT, assignment_id: 'a1', asset_id: ASSET, contact_name_id: 'c-sam',
      source: 'rmm', unassigned_at: null, assigned_at: '2026-10-01T00:00:00.000Z',
    });

    const result = await run('auto', 'CORP\\jdoe');
    expect(result).toMatchObject({ assigned: true, contactId: 'c-jane' });
    expect(h.dbState.assets[0].contact_name_id).toBe('c-jane');
  });

  it('leaves an existing rmm assignment open when the signed-in user is empty', async () => {
    h.dbState.assets[0].contact_name_id = 'c-jane';
    h.dbState.asset_assignments.push({
      tenant: TENANT, assignment_id: 'a1', asset_id: ASSET, contact_name_id: 'c-jane',
      source: 'rmm', unassigned_at: null, assigned_at: '2026-10-01T00:00:00.000Z',
    });

    for (const value of ['', '   ', null]) {
      const result = await run('auto', value);
      expect(result).toMatchObject({ assigned: false, reason: 'no_current_user' });
    }
    expect(h.dbState.assets[0].contact_name_id).toBe('c-jane');
    expect(h.dbState.asset_assignments[0].unassigned_at).toBeNull();
  });

  it('writes nothing in suggest or off mode', async () => {
    for (const mode of ['suggest', 'off']) {
      const result = await run(mode, 'CORP\\jdoe');
      expect(result).toMatchObject({ assigned: false, reason: 'mode' });
    }
    expect(h.dbState.asset_assignments).toHaveLength(0);
  });

  it('skips a shared-workspace member', async () => {
    h.dbState.asset_groups.push({ tenant: TENANT, group_id: 'g1', kind: 'shared_workspace' });
    h.dbState.asset_group_members.push({ tenant: TENANT, group_id: 'g1', asset_id: ASSET, kind: 'shared_workspace' });

    const result = await run('auto', 'CORP\\jdoe');
    expect(result).toMatchObject({ assigned: false, reason: 'shared_workspace' });
    expect(h.dbState.asset_assignments).toHaveLength(0);
  });

  it('does not rewrite an unchanged rmm assignment', async () => {
    h.dbState.assets[0].contact_name_id = 'c-jane';
    h.dbState.asset_assignments.push({
      tenant: TENANT, assignment_id: 'a1', asset_id: ASSET, contact_name_id: 'c-jane',
      source: 'rmm', unassigned_at: null, assigned_at: '2026-10-01T00:00:00.000Z',
    });

    const result = await run('auto', 'CORP\\jdoe');
    expect(result).toMatchObject({ assigned: false, reason: 'unchanged' });
    expect(h.dbState.asset_assignments).toHaveLength(1);
  });

  it('writes nothing when the signed-in user matches nobody', async () => {
    const result = await run('auto', 'CORP\\nobody');
    expect(result).toMatchObject({ assigned: false, reason: 'no_match' });
    expect(h.dbState.asset_assignments).toHaveLength(0);
  });
});
