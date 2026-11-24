import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

// Run the restore's savepoint and the real flag derivation against a small
// transactional store. No provider, database or filesystem resources are used.
type Row = Record<string, any>;
const state = vi.hoisted(() => ({ rows: {} as Record<string, Row[]>, columns: [] as Row[], constraints: [] as Row[], failSync: false }));
vi.mock('../../../../../packages/db/src/lib/tenantDb', () => ({
  tenantDb: (trx: any, tenant: string) => ({
    table: (table: string) => trx(table).where({ tenant }),
    tenantJoin: (query: any) => query.joinRoles(),
  }),
}));
vi.mock('@alga-psa/db', async () => ({
  ...await import('../../../../../packages/db/src/lib/tenantDb'),
  ...await import('../../../../../packages/db/src/lib/clientPortalAdminFlag'),
}));
import { insertCoManagedPortableWorkspaceDatabase } from '../../lib/co-managed/portableWorkspaceRestoreDatabase';

const TENANT = '00000000-0000-4000-8000-000000000011';
const SOURCE = '00000000-0000-4000-8000-000000000012';
const FOREIGN = '00000000-0000-4000-8000-000000000013';
const key = (column: string) => column.split('.').at(-1)!;
function query(name: string): any {
  const table = name.split(' as ')[0];
  const filters: ((row: Row) => boolean)[] = [];
  let first = false, join = false;
  const rows = () => {
    let values = table === 'information_schema.columns' ? state.columns : state.rows[table] ?? [];
    if (join) values = values.flatMap(member => (state.rows.roles ?? [])
      .filter(role => role.tenant === member.tenant && role.role_id === member.role_id)
      .map(role => ({ ...member, ...role })));
    return values.filter(row => filters.every(filter => filter(row)));
  };
  const builder = {
    where(criteria: Row | string, value?: unknown) {
      const pairs = typeof criteria === 'string' ? { [criteria]: value } : criteria;
      filters.push(row => Object.entries(pairs).every(([column, expected]) => row[key(column)] === expected));
      return builder;
    },
    whereIn(column: string, values: any[]) { filters.push(row => values.includes(row[key(column)])); return builder; },
    whereNot(criteria: Row) { filters.push(row => Object.entries(criteria).every(([column, value]) => row[key(column)] !== value)); return builder; },
    whereRaw(_sql: string, values: any[]) { filters.push(row => row.role_name.toLowerCase() === values[0]); return builder; },
    select() { return builder; },
    first() { first = true; return builder; },
    joinRoles() { join = true; return builder; },
    async insert(values: Row[]) { (state.rows[table] ??= []).push(...structuredClone(values)); },
    async update(values: Row) {
      if (table === 'contacts' && state.failSync) throw new Error('flag write failed');
      const matches = rows(); matches.forEach(row => Object.assign(row, values)); return matches.length;
    },
    then(resolve: any, reject: any) { const matches = rows(); return Promise.resolve(first ? matches[0] : matches).then(resolve, reject); },
  };
  return builder;
}
const trx = Object.assign(query, {
  isTransaction: true,
  raw: async (sql: string) => ({ rows: sql.includes('pg_constraint')
    ? [...state.constraints, ...['tenants', 'users', 'contacts', 'roles', 'user_roles'].map(table => ({
      table, kind: 'p', columns: table === 'user_roles' ? ['tenant', 'user_id', 'role_id']
        : ['tenant', ({ users: 'user_id', contacts: 'contact_name_id', roles: 'role_id' } as Record<string, string>)[table]].filter(Boolean),
    }))] : [] }),
  transaction: async (callback: (conn: any) => Promise<unknown>) => {
    const snapshot = structuredClone(state.rows);
    try { return await callback(trx); } catch (error) { state.rows = snapshot; throw error; }
  },
});

function fixture(roleName = 'User', archivedFlag = true) {
  const records = {
    tenants: [{ tenant: TENANT }],
    users: [{ tenant: TENANT, user_id: 'portal', user_type: 'client', contact_id: 'linked', is_inactive: true },
      { tenant: TENANT, user_id: 'staff', user_type: 'internal', contact_id: 'staff-contact', is_inactive: true }],
    contacts: [{ tenant: TENANT, contact_name_id: 'linked', is_client_admin: archivedFlag },
      { tenant: TENANT, contact_name_id: 'unlinked', is_client_admin: true },
      { tenant: TENANT, contact_name_id: 'staff-contact', is_client_admin: true }],
    roles: [{ tenant: TENANT, role_id: 'role', role_name: roleName, client: true, msp: true }],
    user_roles: [{ tenant: TENANT, user_id: 'portal', role_id: 'role' }],
  };
  const columns = Object.fromEntries(Object.entries(records).map(([table, rows]) => [table, Object.keys(rows[0])]));
  state.columns = Object.entries(columns).flatMap(([table, cols]) => cols.map(column => ({
    table_schema: 'public', table_name: table, column_name: column, is_nullable: 'YES', column_default: null, is_generated: 'NEVER',
  })));
  return {
    preparedRecords: { records, columns, tables: Object.keys(records), profiles: [], globalCatalogs: {},
      destinationTenant: TENANT, sourceTenant: SOURCE },
    externalFiles: [], vault: { tenant: TENANT, credentials: [], credential_access_grants: [], credential_associations: [] },
  } as any;
}

beforeEach(() => {
  state.failSync = false;
  state.constraints = [];
  state.rows = { contacts: [{ tenant: FOREIGN, contact_name_id: 'linked', is_client_admin: true }] };
});

describe('portable restore portal-admin convergence', () => {
  it.each([
    ['User', true, false], ['aDmIn', false, true],
  ] as const)('converges archived %s roles before returning a suspended restore', async (role, archived, expected) => {
    const result = await insertCoManagedPortableWorkspaceDatabase(trx as unknown as Knex.Transaction, fixture(role, archived));
    expect(result.suspended).toBe(true);
    expect(state.rows.contacts.find(row => row.tenant === TENANT && row.contact_name_id === 'linked')?.is_client_admin).toBe(expected);
    expect(state.rows.contacts.filter(row => row.tenant === FOREIGN || row.contact_name_id !== 'linked').every(row => row.is_client_admin)).toBe(true);
    expect(state.rows.users.every(row => row.is_inactive)).toBe(true);
    expect(state.rows.user_roles).toHaveLength(1);
  });

  it('clears archived admin scope even when no role membership was archived', async () => {
    const input = fixture(); input.preparedRecords.records.user_roles = [];
    await insertCoManagedPortableWorkspaceDatabase(trx as unknown as Knex.Transaction, input);
    expect(state.rows.contacts.find(row => row.tenant === TENANT && row.contact_name_id === 'linked')?.is_client_admin).toBe(false);
  });

  it('converges after restoring a contact link deferred by a foreign-key cycle', async () => {
    const input = fixture();
    input.preparedRecords.records.contacts[0].owner_id = 'portal';
    input.preparedRecords.columns.contacts.push('owner_id');
    state.columns.push({ table_schema: 'public', table_name: 'contacts', column_name: 'owner_id',
      is_nullable: 'YES', column_default: null, is_generated: 'NEVER' });
    state.constraints = [
      { kind: 'f', match: 's', table: 'users', parent: 'contacts', parent_schema: 'public',
        columns: ['tenant', 'contact_id'], parent_columns: ['tenant', 'contact_name_id'] },
      { kind: 'f', match: 's', table: 'contacts', parent: 'users', parent_schema: 'public',
        columns: ['tenant', 'owner_id'], parent_columns: ['tenant', 'user_id'] },
    ];
    await insertCoManagedPortableWorkspaceDatabase(trx as unknown as Knex.Transaction, input);
    expect(state.rows.users.find(row => row.user_id === 'portal')?.contact_id).toBe('linked');
    expect(state.rows.contacts.find(row => row.tenant === TENANT && row.contact_name_id === 'linked')?.is_client_admin).toBe(false);
  });

  it('rolls the restored graph back if flag convergence fails', async () => {
    const original = structuredClone(state.rows);
    state.failSync = true;
    await expect(insertCoManagedPortableWorkspaceDatabase(trx as unknown as Knex.Transaction, fixture())).rejects.toThrow('flag write failed');
    expect(state.rows).toEqual(original);
  });
});
