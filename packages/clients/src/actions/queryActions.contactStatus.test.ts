import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knexFactory from 'knex';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: db }),
  withTransaction: (_db: unknown, fn: any) => fn(db),
}));
vi.mock('../lib/authHelpers', () => ({ hasPermissionAsync: async () => true }));
vi.mock('@alga-psa/authorization/clientScopeAuthorization', () => ({
  createClientScopeContext: async () => ({
    narrowing: async (_resource: string, alias: string) => ({
      apply: (query: any) => query.where(`${alias}.client_id`, 'allowed-client'),
    }),
  }),
}));
vi.mock('@alga-psa/shared/models/contactModel', () => ({
  ContactModel: { hydrateContactsWithPhoneNumbers: async (rows: unknown[]) => rows },
}));
vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getContactAvatarUrlsBatch: async () => new Map(),
  getClientLogoUrlsBatch: async () => new Map(),
}));
vi.mock('../lib/displayTags', () => ({
  attachDisplayTags: async (_db: unknown, _tenant: string, _user: unknown, _type: string, rows: unknown[]) => rows,
}));
vi.mock('../lib/contactLocations', () => ({
  attachContactLocations: async (_db: unknown, _tenant: string, rows: unknown[]) => rows,
}));

// Execute the action with real Knex/tenantDb query construction, intercepting
// only the driver: no database or shared infrastructure is needed.
const db = knexFactory({ client: 'pg' });
const queries: { sql: string; bindings: unknown[] }[] = [];
vi.spyOn(db.client, 'acquireConnection').mockResolvedValue({});
vi.spyOn(db.client, 'releaseConnection').mockResolvedValue(undefined);
vi.spyOn(db.client, 'query').mockImplementation(async (_connection, query: any) => {
  queries.push({ sql: query.sql, bindings: query.bindings });
  return {
    ...query,
    response: { command: 'SELECT', rows: query.sql.includes('from "clients"') ? [{ client_id: 'allowed-client' }] : [] },
  };
});

const { getContactsByClient } = await import('./queryActions');

beforeEach(() => { queries.length = 0; });
afterAll(async () => { await db.destroy(); });

describe('getContactsByClient activity filter', () => {
  it.each([undefined, 'active', 'inactive', 'all'] as const)(
    'keeps tenant/client narrowing and treats NULL as active for status %s',
    async (status) => {
      await getContactsByClient('allowed-client', status);
      const contactQuery = queries.find(({ sql }) => sql.includes('from "contacts"'))!;
      expect(contactQuery).toBeDefined();
      expect(contactQuery.sql).toContain('"contacts"."tenant" = ?');
      expect(contactQuery.sql).toContain('"contacts"."client_id" = ?');
      expect(contactQuery.sql).toContain('"clients"."tenant" = "contacts"."tenant"');
      if (status === 'all') {
        expect(contactQuery.sql).not.toContain('is_inactive');
        expect(contactQuery.bindings).toEqual(['tenant-1', 'allowed-client', 'allowed-client']);
      } else {
        // COALESCE gives both legacy NULL and false the active classification;
        // true remains inactive. Keep it ANDed with the caller's narrowing.
        expect(contactQuery.sql).toContain('coalesce(contacts.is_inactive, false) = ? and "contacts"."client_id" = ?');
        expect(contactQuery.bindings).toEqual(['tenant-1', 'allowed-client', status === 'inactive', 'allowed-client']);
      }
    },
  );
});
