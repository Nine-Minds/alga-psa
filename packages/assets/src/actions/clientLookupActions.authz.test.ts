import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const h = vi.hoisted(() => {
  const state = {
    user: { user_id: 'user-1', tenant: 'tenant-1', user_type: 'internal', clientId: undefined as string | undefined } as any,
    permissions: new Set(['asset:read']),
    selectedClientIds: null as string[] | null,
    tables: {
      clients: [
        { client_id: 'client-a', client_name: 'A' },
        { client_id: 'client-b', client_name: 'B' },
      ],
      client_locations: [{ client_id: 'client-a', location_name: 'A location', is_active: true }],
      contacts: [{ client_id: 'client-a', contact_name_id: 'contact-a', full_name: 'A Contact', contact_kind: 'person', is_inactive: false }],
      client_billing_profiles: [{ client_id: 'client-a', billing_profile_id: 'billing-a', name: 'A Billing', is_active: true }],
      vendors: [],
    } as Record<string, Row[]>,
    touchedTables: [] as string[],
    protectedReads: [] as Array<{ table: string; selectedColumns: string[]; whereInClientIds: unknown[] }>,
    logoCalls: [] as string[],
  };

  class Query {
    private predicates: Array<(row: Row) => boolean> = [];
    private orders: Array<{ column: string; direction: 'asc' | 'desc' }> = [];
    private selectedColumns: string[] = [];
    private whereInClientIds: unknown[] = [];
    constructor(private readonly table: string) { state.touchedTables.push(table); }
    select(...columns: string[]) { this.selectedColumns = columns; return this; }
    where(columnOrPredicate: string | Record<string, unknown> | ((this: Query) => void), value?: unknown) {
      if (typeof columnOrPredicate === 'function') columnOrPredicate.call(this);
      else if (typeof columnOrPredicate === 'string') this.predicates.push((row) => row[columnOrPredicate] === value);
      else this.predicates.push((row) => Object.entries(columnOrPredicate).every(([key, expected]) => row[key] === expected));
      return this;
    }
    whereIn(column: string, values: unknown[]) {
      if (column === 'client_id') this.whereInClientIds = values;
      this.predicates.push((row) => values.includes(row[column]));
      return this;
    }
    whereNot(column: string | Record<string, unknown>, value?: unknown) {
      if (typeof column === 'string') this.predicates.push((row) => row[column] !== value);
      else this.predicates.push((row) => Object.entries(column).every(([key, expected]) => row[key] !== expected));
      return this;
    }
    whereNull(column: string) { this.predicates.push((row) => row[column] == null); return this; }
    orWhereNull(column: string) { this.predicates.push((row) => row[column] == null); return this; }
    orWhere(column: string, value: unknown) { this.predicates.push((row) => row[column] === value); return this; }
    andWhere(predicate: Record<string, unknown> | ((this: Query) => void)) {
      if (typeof predicate === 'function') return this;
      else this.where(predicate);
      return this;
    }
    orderBy(column: string, direction: 'asc' | 'desc' = 'asc') { this.orders.push({ column, direction }); return this; }
    private result() {
      if (this.selectedColumns.includes('*') || this.table !== 'clients') {
        state.protectedReads.push({ table: this.table, selectedColumns: this.selectedColumns, whereInClientIds: this.whereInClientIds });
      }
      const rows = (state.tables[this.table] ?? []).filter((row) => this.predicates.every((predicate) => predicate(row)));
      for (const { column, direction } of this.orders) rows.sort((a, b) => String(a[column] ?? '').localeCompare(String(b[column] ?? '')) * (direction === 'asc' ? 1 : -1));
      return rows.map((row) => this.selectedColumns.length > 0 && !this.selectedColumns.includes('*')
        ? Object.fromEntries(this.selectedColumns.map((column) => [column, row[column]]))
        : row);
    }
    first() { return Promise.resolve(this.result()[0]); }
    then(resolve: (value: Row[]) => unknown, reject?: (reason: unknown) => unknown) { return Promise.resolve(this.result()).then(resolve, reject); }
  }

  const connection: any = { table: (name: string) => new Query(name) };
  return { state, connection };
});

const hasPermissionMock = vi.hoisted(() => vi.fn(async (_user: unknown, resource: string, action: string) =>
  h.state.permissions.has(`${resource}:${action}`)
));
const createAssetReadContextMock = vi.hoisted(() => vi.fn(async (_trx: unknown, _tenant: string, user: any) => ({
  subject: { tenant: user.tenant, userId: user.user_id, userType: user.user_type, clientId: user.clientId ?? null },
  requestCache: {},
  authorizationKernel: {
    authorizeResource: async (input: any) => {
      const clientId = input.record?.clientId;
      const allowedIds = h.state.selectedClientIds;
      const allowed = user.user_type === 'client'
        ? Boolean(user.clientId && user.clientId === clientId && (allowedIds === null || allowedIds.includes(clientId)))
        : allowedIds === null || allowedIds.includes(clientId);
      return { allowed };
    },
  },
})));
const getClientLogoUrlMock = vi.hoisted(() => vi.fn(async (clientId: string) => { h.state.logoCalls.push(clientId); return `logo:${clientId}`; }));
const getClientLogoUrlsBatchMock = vi.hoisted(() => vi.fn(async (clientIds: string[]) => {
  h.state.logoCalls.push(...clientIds);
  return new Map(clientIds.map((clientId) => [clientId, `logo:${clientId}`]));
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...args: any[]) => unknown) => (...args: any[]) => fn(h.state.user, { tenant: h.state.user.tenant }, ...args),
  hasPermission: hasPermissionMock,
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: h.connection }),
  tenantDb: (connection: any) => connection,
  withTransaction: async (_knex: any, callback: (trx: any) => unknown) => callback(h.connection),
}));
vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: getClientLogoUrlMock,
  getClientLogoUrlsBatch: getClientLogoUrlsBatchMock,
}));
vi.mock('@shared/services/productAccessGuard', () => ({ assertPsaOnlyTenantAccess: vi.fn(async () => undefined) }));
vi.mock('../lib/assetReadAuthorization', () => ({ createAssetReadContext: createAssetReadContextMock }));

import {
  getAllClientsForAssets,
  getClientBillingProfilesForAssets,
  getClientByIdForAssets,
  getClientContactsForAssets,
  getClientLocationsForAssets,
  getVendorOptionsForAssets,
} from './clientLookupActions';

describe('asset client lookup authorization', () => {
  beforeEach(() => {
    h.state.user = { user_id: 'user-1', tenant: 'tenant-1', user_type: 'internal' };
    h.state.permissions = new Set(['asset:read']);
    h.state.selectedClientIds = null;
    h.state.touchedTables = [];
    h.state.protectedReads = [];
    h.state.logoCalls = [];
    vi.clearAllMocks();
  });

  it('allows an authorized internal reader to list clients and resolve logos', async () => {
    const clients = await getAllClientsForAssets(true);
    expect(clients.map((client) => client.client_id)).toEqual(['client-a', 'client-b']);
    expect(h.state.logoCalls).toEqual(['client-a', 'client-b']);
  });

  it('scopes client-user lists to their own client', async () => {
    h.state.user = { ...h.state.user, user_type: 'client', clientId: 'client-a' };
    const clients = await getAllClientsForAssets(true);
    expect(clients.map((client) => client.client_id)).toEqual(['client-a']);
    expect(h.state.logoCalls).toEqual(['client-a']);
  });

  it('applies the internal caller asset:read selected-clients bundle to lists', async () => {
    h.state.selectedClientIds = ['client-a'];
    const clients = await getAllClientsForAssets(true);
    expect(clients.map((client) => client.client_id)).toEqual(['client-a']);
    expect(h.state.protectedReads).toEqual([
      expect.objectContaining({ table: 'clients', selectedColumns: ['*'], whereInClientIds: ['client-a'] }),
    ]);
    expect(h.state.logoCalls).toEqual(['client-a']);
  });

  it('rejects callers without asset read permission before protected reads', async () => {
    h.state.permissions.clear();
    await expect(getAllClientsForAssets(true)).rejects.toThrow('Permission denied');
    expect(h.state.touchedTables).toEqual([]);
    expect(h.state.protectedReads).toEqual([]);
    expect(h.state.logoCalls).toEqual([]);
  });

  it('rejects an unresolved client user before reading candidate or protected client data', async () => {
    h.state.user = { ...h.state.user, user_type: 'client', clientId: undefined };
    await expect(getAllClientsForAssets(true)).resolves.toEqual([]);
    await expect(getClientByIdForAssets('client-a')).rejects.toThrow('asset read scope');
    expect(h.state.touchedTables).toEqual([]);
    expect(h.state.protectedReads).toEqual([]);
    expect(h.state.logoCalls).toEqual([]);
  });

  it.each([
    ['client detail', (id: string) => getClientByIdForAssets(id)],
    ['locations', (id: string) => getClientLocationsForAssets(id)],
    ['contacts', (id: string) => getClientContactsForAssets(id)],
    ['billing profiles', (id: string) => getClientBillingProfilesForAssets(id)],
  ])('rejects internal selected-client bundle requests for %s before downstream reads', async (_label, lookup) => {
    h.state.selectedClientIds = ['client-a'];
    await expect(lookup('client-b')).rejects.toThrow('asset read scope');
    expect(h.state.protectedReads).toEqual([]);
    expect(h.state.logoCalls).toEqual([]);
  });

  it.each([
    ['client list', () => getAllClientsForAssets(true)],
    ['client detail', () => getClientByIdForAssets('client-a')],
    ['locations', () => getClientLocationsForAssets('client-a')],
    ['contacts', () => getClientContactsForAssets('client-a')],
    ['billing profiles', () => getClientBillingProfilesForAssets('client-a')],
    ['vendors', () => getVendorOptionsForAssets()],
  ])('denies %s without asset:read before protected reads', async (_label, lookup) => {
    h.state.permissions.clear();
    await expect(lookup()).rejects.toThrow('Permission denied');
    expect(hasPermissionMock).toHaveBeenCalledWith(h.state.user, 'asset', 'read');
    expect(h.state.protectedReads).toEqual([]);
    expect(h.state.logoCalls).toEqual([]);
  });

  it('rejects client-user requests outside the resolved client scope before downstream reads', async () => {
    h.state.user = { ...h.state.user, user_type: 'client', clientId: 'client-a' };
    await expect(getClientByIdForAssets('client-b')).rejects.toThrow('asset read scope');
    expect(h.state.protectedReads).toEqual([]);
    expect(h.state.logoCalls).toEqual([]);
  });

  it('allows internal selected-client access for the client covered by asset:read', async () => {
    h.state.selectedClientIds = ['client-a'];
    await expect(getClientByIdForAssets('client-a')).resolves.toMatchObject({ client_id: 'client-a', logoUrl: 'logo:client-a' });
    await expect(getClientLocationsForAssets('client-a')).resolves.toHaveLength(1);
    await expect(getClientContactsForAssets('client-a')).resolves.toHaveLength(1);
    await expect(getClientBillingProfilesForAssets('client-a')).resolves.toHaveLength(1);
    expect(h.state.logoCalls).toEqual(['client-a']);
  });

  it('allows scoped by-ID and sibling lookups for the caller client', async () => {
    h.state.user = { ...h.state.user, user_type: 'client', clientId: 'client-a' };
    await expect(getClientByIdForAssets('client-a')).resolves.toMatchObject({ client_id: 'client-a', logoUrl: 'logo:client-a' });
    await expect(getClientLocationsForAssets('client-a')).resolves.toHaveLength(1);
    await expect(getClientContactsForAssets('client-a')).resolves.toHaveLength(1);
    await expect(getClientBillingProfilesForAssets('client-a')).resolves.toHaveLength(1);
  });
});
