import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as resyncRoute from '../../../app/api/email/imap/resync/route';
import * as reconnectRoute from '../../../app/api/email/imap/reconnect/route';

const state = vi.hoisted(() => ({
  user: null as any,
  canUpdateSettings: false,
  providerLookups: 0,
  updates: [] as Array<{ table: string; values: unknown; where: unknown }>,
  permissionChecks: 0,
  tenantDbCalls: [] as unknown[],
  knex: Object.assign(() => undefined, { fn: { now: () => 'now' } }),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: () => state.user,
}));
vi.mock('@/lib/db', () => ({
  createTenantKnex: async () => ({ knex: state.knex, tenant: 'tenant-from-session' }),
}));
vi.mock('@/lib/productAccess', () => ({
  assertTenantProductAccess: async () => undefined,
  isProductAccessError: () => false,
  toProductAccessDeniedResponse: () => new Response(null, { status: 403 }),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: async (_user: unknown, resource: string, action: string) => {
    state.permissionChecks += 1;
    return resource === 'ticket_settings' && action === 'update' && state.canUpdateSettings;
  },
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: (connection: unknown, tenant: unknown) => {
    state.tenantDbCalls.push({ connection, tenant });
    return {
      table: (table: string) => {
        let where: unknown;
        const query: any = {
          where: (clause: unknown) => { where = clause; return query; },
          first: async () => {
            if (table === 'email_providers') state.providerLookups += 1;
            return table === 'email_providers'
              ? { id: 'provider-1', provider_type: 'imap' }
              : undefined;
          },
          update: async (values: unknown) => {
            state.updates.push({ table, values, where });
          },
        };
        return query;
      },
    };
  },
}));

const endpoints = [
  {
    name: 'resync',
    route: resyncRoute,
    expectedWrites: [{
      table: 'imap_email_provider_config',
      values: {
        uid_validity: null,
        last_uid: null,
        last_processed_message_id: null,
        folder_state: {},
        last_error: null,
        updated_at: 'now',
      },
    }],
  },
  {
    name: 'reconnect',
    route: reconnectRoute,
    expectedWrites: [
      {
        table: 'imap_email_provider_config',
        values: { lease_owner: null, lease_expires_at: null, updated_at: 'now' },
      },
      {
        table: 'email_providers',
        values: { status: 'disconnected', error_message: null, updated_at: 'now' },
      },
    ],
  },
] as const;

async function post(path: string, apiKey?: string) {
  const name = path as 'resync' | 'reconnect';
  const route = endpoints.find((endpoint) => endpoint.name === name)!.route;
  return route.POST(new NextRequest(`http://localhost/api/email/imap/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
    body: JSON.stringify({ providerId: 'provider-1' }),
  }));
}

describe('IMAP maintenance route authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user = { user_id: 'staff-1', tenant: 'tenant-from-session', user_type: 'internal' };
    state.canUpdateSettings = false;
    state.providerLookups = 0;
    state.updates = [];
    state.permissionChecks = 0;
    state.tenantDbCalls = [];
  });

  for (const endpoint of endpoints) {
    it(`${endpoint.name}: rejects missing sessions before reading or changing provider state`, async () => {
      state.user = null;
      const response = await post(endpoint.name, 'arbitrary-nonempty-key');

      expect(response.status).toBe(401);
      expect(state.permissionChecks).toBe(0);
      expect(state.providerLookups).toBe(0);
      expect(state.updates).toEqual([]);
    });

    it(`${endpoint.name}: rejects unauthorized staff even with an arbitrary API key`, async () => {
      const response = await post(endpoint.name, 'arbitrary-nonempty-key');

      expect(response.status).toBe(403);
      expect(state.permissionChecks).toBe(1);
      expect(state.providerLookups).toBe(0);
      expect(state.updates).toEqual([]);
    });

    it(`${endpoint.name}: rejects client users before permission or provider access`, async () => {
      state.user = { user_id: 'client-1', tenant: 'tenant-from-session', user_type: 'client' };
      const response = await post(endpoint.name, 'arbitrary-nonempty-key');

      expect(response.status).toBe(403);
      expect(state.permissionChecks).toBe(0);
      expect(state.providerLookups).toBe(0);
      expect(state.updates).toEqual([]);
    });

    it(`${endpoint.name}: permits an authorized administrator and scopes reads to the session tenant`, async () => {
      state.canUpdateSettings = true;
      const response = await post(endpoint.name, 'arbitrary-nonempty-key');

      expect(response.status).toBe(200);
      expect(state.providerLookups).toBe(1);
      expect(state.updates.map(({ table, values }) => ({ table, values }))).toEqual(endpoint.expectedWrites);
      expect(state.tenantDbCalls).toEqual([{ connection: state.knex, tenant: 'tenant-from-session' }]);
    });
  }
});
