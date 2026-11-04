import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import knexFactory from 'knex';
import { tenantDb } from '@alga-psa/db';

const mocks = vi.hoisted(() => ({
  knex: null as any,
  user: null as any,
  permitted: false,
  rows: {} as Record<string, any[]>,
  queries: [] as Array<{ text: string; bindings: any[] }>,
  getTenantSecret: vi.fn(),
  setTenantSecret: vi.fn(),
  postSafeOutboundForm: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  createTenantKnex: vi.fn(async (tenant: string) => ({ knex: mocks.knex, tenant })),
}));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: async () => mocks.user }));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getAppSecret: async (name: string) => name === 'NEXT_PUBLIC_BASE_URL' ? 'https://app.example.test' : null,
    getTenantSecret: mocks.getTenantSecret,
    setTenantSecret: mocks.setTenantSecret,
  }),
}));
vi.mock('@alga-psa/core/net/safeFetch', () => ({
  assertPublicHttpsUrl: vi.fn(async () => undefined),
  postSafeOutboundForm: mocks.postSafeOutboundForm,
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: (...args: any[]) => mocks.hasPermission(...args) }));
vi.mock('@/lib/productAccess', () => ({
  assertTenantProductAccess: vi.fn(async () => undefined),
  isProductAccessError: vi.fn(() => false),
  toProductAccessDeniedResponse: vi.fn(),
}));

import { GET } from '@/app/api/email/oauth/imap/callback/route';
import { POST } from '@/app/api/email/oauth/imap/initiate/route';
import { createImapOAuthState } from '@/utils/email/imapOAuthState';

const knex = knexFactory({ client: 'pg', pool: { min: 0, max: 1 } });

function matchRows(sql: string, bindings: any[], rows: any[]) {
  return rows.filter((row) => {
    const predicates = [...sql.matchAll(/(?:"[a-z_]+"\.)?"([a-z_]+)"\s*=\s*\$(\d+)/gi)];
    for (const [, column, position] of predicates) {
      if (column && row[column] !== bindings[Number(position) - 1]) return false;
    }
    return true;
  });
}

function executeMemoryQuery(text: string, bindings: any[]) {
  const command = text.trim().split(/\s+/, 1)[0]!.toUpperCase();
  const tableMatch = text.match(/(?:FROM|INTO|UPDATE)\s+"?([a-z_]+)"?/i);
  const table = tableMatch?.[1];
  if (!table) throw new Error(`Unsupported test SQL: ${text}`);
  const rows = mocks.rows[table] ?? (mocks.rows[table] = []);

  if (command === 'SELECT') {
    const selected = matchRows(text, bindings, rows);
    return { command, rows: selected, rowCount: selected.length };
  }
  if (command === 'INSERT') {
    const columns = text.match(/\(([^)]+)\)\s*values/i)?.[1]
      ?.split(',').map((column) => column.trim().replaceAll('"', '')) ?? [];
    const inserted = Object.fromEntries(columns.map((column, index) => [column, bindings[index]]));
    if (table === 'imap_oauth_states' && typeof inserted.state === 'string') {
      inserted.state = JSON.parse(inserted.state);
    }
    rows.push(inserted);
    return { command, rows: [], rowCount: 1 };
  }
  if (command === 'DELETE') {
    let removed: any[] = [];
    if (text.includes('"nonce"')) {
      const parameter = (column: string) => {
        const matches = [...text.matchAll(new RegExp(`(?:"[a-z_]+"\\.)?"${column}"\\s*[=><]+\\s*\\$(\\d+)`, 'gi'))];
        return matches.map((match) => bindings[Number(match[1]) - 1]);
      };
      const tenantValues = parameter('tenant');
      const [nonce] = parameter('nonce');
      const [expiresAt] = parameter('expires_at');
      removed = rows.filter((row) => tenantValues.every((tenant) => row.tenant === tenant) &&
        row.nonce === nonce && new Date(row.expires_at).getTime() > new Date(expiresAt).getTime());
    } else {
      const cutoff = new Date(bindings[1]).getTime();
      removed = rows.filter((row) => row.tenant === bindings[0] && new Date(row.expires_at).getTime() <= cutoff);
    }
    mocks.rows[table] = rows.filter((row) => !removed.includes(row));
    return { command, rows: text.includes('returning') ? removed : [], rowCount: removed.length };
  }
  if (command === 'UPDATE') {
    return { command, rows: [], rowCount: 1 };
  }
  throw new Error(`Unsupported test SQL command: ${text}`);
}

beforeAll(() => {
  const connection = {
    query: (query: { text: string; values: any[] }, callback: (error: Error | null, result?: any) => void) => {
      try {
        mocks.queries.push({ text: query.text, bindings: query.values ?? [] });
        callback(null, executeMemoryQuery(query.text, query.values ?? []));
      } catch (error) {
        callback(error as Error);
      }
    },
  };
  (knex.client as any).acquireConnection = async () => connection;
  (knex.client as any).releaseConnection = async () => undefined;
  mocks.knex = knex;
});

afterAll(async () => knex.destroy());

function seedTenant(tenant: string) {
  mocks.rows.email_providers = [
    { tenant, id: 'provider-a', provider_type: 'imap', status: 'pending' },
  ];
  mocks.rows.imap_email_provider_config = [
    {
      tenant,
      email_provider_id: 'provider-a',
      oauth_authorize_url: 'https://idp.example.test/authorize',
      oauth_token_url: 'https://idp.example.test/token',
      oauth_client_id: 'client-a',
      oauth_scopes: 'mail.read',
    },
  ];
  mocks.rows.imap_oauth_states = [];
}

function callbackRequest(state: string, tenantHeader = 'tenant-b') {
  return new NextRequest(
    `https://app.example.test/api/email/oauth/imap/callback?code=auth-code&state=${encodeURIComponent(state)}`,
    { headers: { 'x-tenant-id': tenantHeader } },
  );
}

describe('IMAP OAuth routes with the real tenantDb facade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXTAUTH_SECRET = 'tenant-test-signing-key';
    mocks.user = { user_id: 'msp-user', user_type: 'internal', tenant: 'tenant-a' };
    mocks.permitted = true;
    mocks.hasPermission.mockImplementation(async () => mocks.permitted);
    mocks.rows = {};
    mocks.queries = [];
    mocks.getTenantSecret.mockImplementation(async (_tenant: string, name: string) =>
      name.startsWith('imap_oauth_client_secret_') ? 'client-secret' : null);
    mocks.setTenantSecret.mockResolvedValue(undefined);
    mocks.postSafeOutboundForm.mockResolvedValue({
      status: 200,
      data: { access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 3600 },
    });
    seedTenant('tenant-a');
  });

  it('initiates, persists, consumes once, and rejects replay using tenantDb scoping', async () => {
    const response = await POST(new NextRequest('https://app.example.test/api/email/oauth/imap/initiate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant-id': 'tenant-b' },
      body: JSON.stringify({ providerId: 'provider-a', redirectUri: 'https://attacker.test/callback' }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.hasPermission).toHaveBeenCalledWith(mocks.user, 'ticket_settings', 'update', knex);

    const started = await response.json();
    const persisted = mocks.rows.imap_oauth_states;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ tenant: 'tenant-a', state: expect.objectContaining({
      tenant: 'tenant-a', userId: 'msp-user', providerId: 'provider-a',
      redirectUri: 'https://app.example.test/api/email/oauth/imap/callback',
    }) });
    expect(started.authUrl).toContain(encodeURIComponent('https://app.example.test/api/email/oauth/imap/callback'));

    const first = await GET(callbackRequest(started.state));
    expect(first.status, JSON.stringify({ body: await first.clone().text(), rows: mocks.rows.imap_oauth_states, queries: mocks.queries }, null, 2)).toBe(307);
    expect(mocks.rows.imap_oauth_states).toHaveLength(0);
    expect(mocks.setTenantSecret).toHaveBeenCalledWith('tenant-a', 'imap_refresh_token_provider-a', 'refresh-token');

    const replay = await GET(callbackRequest(started.state));
    expect(replay.status).toBe(400);
    expect(mocks.postSafeOutboundForm).toHaveBeenCalledTimes(1);
  });

  it('isolates initiation and state consumption by the authenticated tenant', async () => {
    seedTenant('tenant-b');
    const denied = await POST(new NextRequest('https://app.example.test/api/email/oauth/imap/initiate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId: 'provider-a' }),
    }));
    expect(denied.status).toBe(404);
    expect(mocks.rows.imap_oauth_states).toHaveLength(0);

    const { state, token } = await createImapOAuthState({
      tenant: 'tenant-a', userId: 'msp-user', providerId: 'provider-a',
      redirectUri: 'https://app.example.test/api/email/oauth/imap/callback',
    });
    mocks.rows.imap_oauth_states.push({ tenant: 'tenant-b', nonce: state.nonce, state, expires_at: new Date(state.expiresAt).toISOString() });
    const isolated = await GET(callbackRequest(token, 'tenant-b'));
    expect(isolated.status).toBe(400);
    expect(mocks.rows.imap_oauth_states).toHaveLength(1);
    expect(mocks.getTenantSecret).not.toHaveBeenCalled();
    expect(mocks.postSafeOutboundForm).not.toHaveBeenCalled();
  });
});
