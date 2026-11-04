import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T122 / FR-E8: who a ticket raised from an asset can be filed for. A shared
 * workspace offers its users; a normal asset offers its assignee or nothing.
 */

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const TENANT = 'a0000000-0000-4000-8000-00000000000a';
  const dbState: Record<string, Row[]> = {};

  const resetDb = () => {
    for (const key of Object.keys(dbState)) delete dbState[key];
    dbState.assets = [];
    dbState.contacts = [];
    dbState.asset_groups = [];
    dbState.asset_group_members = [];
    dbState.asset_group_contacts = [];
  };

  const strip = (key: string) => (key.includes('.') ? key.split('.').pop()! : key);

  class QB {
    private readonly table: string;
    private wheres: Array<Record<string, any>> = [];
    /** The workspace lookup is a 3-way join; rows carry the joined shape. */
    private joined: string[] = [];

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
        this.wheres.push({ [strip(arg1)]: arg2 });
        return this;
      }
      const normalized: Record<string, any> = {};
      for (const [k, v] of Object.entries(arg1)) normalized[strip(k)] = v;
      this.wheres.push(normalized);
      return this;
    }

    join(table: string) {
      this.joined.push(table.split(' as ')[0]);
      return this;
    }

    leftJoin(table: string) {
      this.joined.push(table.split(' as ')[0]);
      return this;
    }

    select(..._cols: unknown[]) {
      return this;
    }

    orderBy() {
      return this;
    }

    private joinedRows(): Row[] {
      // asset_group_members -> asset_groups -> asset_group_contacts -> contacts
      const out: Row[] = [];
      for (const member of dbState.asset_group_members) {
        const group = dbState.asset_groups.find((g) => g.group_id === member.group_id);
        if (!group) continue;
        for (const gc of dbState.asset_group_contacts.filter((c) => c.group_id === group.group_id)) {
          const contact = dbState.contacts.find((c) => c.contact_name_id === gc.contact_name_id);
          out.push({ ...member, ...group, ...gc, full_name: contact?.full_name ?? null, contact_name: contact?.full_name ?? null });
        }
      }
      return out;
    }

    private filtered(): Row[] {
      let rows = this.joined.length > 0 ? this.joinedRows() : [...this.rows];
      for (const where of this.wheres) {
        rows = rows.filter((row) => Object.entries(where).every(([k, v]) => row[k] === v));
      }
      return rows;
    }

    first(..._cols: unknown[]) {
      return Promise.resolve(this.filtered().map((row) => ({ ...row }))[0]);
    }

    then(resolve: (value: any) => void, reject?: (reason: unknown) => void) {
      return Promise.resolve(this.filtered()).then(resolve, reject);
    }
  }

  const knexMock: any = (spec: string) => new QB(spec);

  return { TENANT, dbState, knexMock, resetDb };
});

vi.mock('@alga-psa/db', () => ({
  tenantDb: (conn: any, tenant: string) => ({
    table: (name: string) => conn(name).where({ tenant }),
  }),
}));

const { resolveAssetTicketContactOptions } = await import('../assetTicketContactModel');

const TENANT = h.TENANT;
const ASSET = 'f0000000-0000-4000-8000-00000000000f';
const GROUP = 'e0000000-0000-4000-8000-00000000000e';

beforeEach(() => {
  h.resetDb();
  h.dbState.contacts.push(
    { tenant: TENANT, contact_name_id: 'u1', full_name: 'Ada' },
    { tenant: TENANT, contact_name_id: 'u2', full_name: 'Bea' },
    { tenant: TENANT, contact_name_id: 'u3', full_name: 'Cass' },
    { tenant: TENANT, contact_name_id: 'owner', full_name: 'Owen' },
  );
});

const options = () => resolveAssetTicketContactOptions(h.knexMock as any, TENANT, ASSET);

describe('resolveAssetTicketContactOptions', () => {
  it('T122: offers all three users of a shared workspace', async () => {
    h.dbState.assets.push({ tenant: TENANT, asset_id: ASSET, contact_name_id: null });
    h.dbState.asset_groups.push({ tenant: TENANT, group_id: GROUP, kind: 'shared_workspace' });
    h.dbState.asset_group_members.push({ tenant: TENANT, group_id: GROUP, asset_id: ASSET });
    for (const contact of ['u1', 'u2', 'u3']) {
      h.dbState.asset_group_contacts.push({ tenant: TENANT, group_id: GROUP, contact_name_id: contact, role: 'user' });
    }

    const result = await options();
    expect(result.map((row) => row.contact_name_id).sort()).toEqual(['u1', 'u2', 'u3']);
    expect(result.map((row) => row.contact_name).sort()).toEqual(['Ada', 'Bea', 'Cass']);
  });

  it('T122: ignores a bundle owner — only shared workspaces replace the assignee', async () => {
    h.dbState.assets.push({ tenant: TENANT, asset_id: ASSET, contact_name_id: 'u1' });
    h.dbState.asset_groups.push({ tenant: TENANT, group_id: GROUP, kind: 'bundle' });
    h.dbState.asset_group_members.push({ tenant: TENANT, group_id: GROUP, asset_id: ASSET });
    h.dbState.asset_group_contacts.push({ tenant: TENANT, group_id: GROUP, contact_name_id: 'owner', role: 'owner' });

    expect(await options()).toEqual([{ contact_name_id: 'u1', contact_name: 'Ada' }]);
  });

  it('T122: a normal asset offers its single assignee', async () => {
    h.dbState.assets.push({ tenant: TENANT, asset_id: ASSET, contact_name_id: 'u2' });

    expect(await options()).toEqual([{ contact_name_id: 'u2', contact_name: 'Bea' }]);
  });

  it('T122: an unassigned asset offers nothing', async () => {
    h.dbState.assets.push({ tenant: TENANT, asset_id: ASSET, contact_name_id: null });

    expect(await options()).toEqual([]);
  });
});
