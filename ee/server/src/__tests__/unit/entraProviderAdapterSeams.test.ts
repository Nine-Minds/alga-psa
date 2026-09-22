// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  cipp: { baseUrl: 'https://cipp.test', apiToken: 'api-token' } as { baseUrl: string; apiToken: string } | null,
  get: vi.fn(),
}));

vi.mock('axios', () => {
  const isAxiosError = (e: any) => Boolean(e?.isAxiosError);
  return {
    default: { get: hoisted.get, post: vi.fn(), isAxiosError },
    get: hoisted.get,
    post: vi.fn(),
    isAxiosError,
  };
});

vi.mock('@ee/lib/integrations/entra/providers/cipp/cippSecretStore', () => ({
  getEntraCippCredentials: vi.fn(async () => hoisted.cipp),
  saveEntraCippCredentials: vi.fn(),
  clearEntraCippCredentials: vi.fn(),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getTenantSecret: vi.fn(async () => null),
    getAppSecret: vi.fn(async () => null),
  })),
}));

import { DirectProviderAdapter } from '@ee/lib/integrations/entra/providers/direct/directProviderAdapter';
import { CippProviderAdapter } from '@ee/lib/integrations/entra/providers/cipp/cippProviderAdapter';

describe('DirectProviderAdapter.listUsersForTenantWithToken', () => {
  beforeEach(() => {
    process.env.MICROSOFT_GRAPH_BASE_URL = 'https://graph.test';
    delete process.env.ENTRA_DIRECT_SMOKE_SELF_TENANT_MODE;
    hoisted.get.mockReset();
  });

  it('maps raw Graph rows to normalized users across pages', async () => {
    hoisted.get
      .mockResolvedValueOnce({
        data: {
          value: [
            { id: 'u1', mail: 'alice@acme.example', userPrincipalName: 'alice@acme.example', accountEnabled: true, displayName: 'Alice' },
            { id: 'u2', userPrincipalName: 'bob@acme.example', accountEnabled: false, displayName: 'Bob' },
          ],
          '@odata.nextLink': 'https://graph.test/users?$skiptoken=2',
        },
      })
      .mockResolvedValueOnce({
        data: {
          value: [
            { id: 'u3', mail: 'carol@acme.example', userPrincipalName: 'carol@acme.example', accountEnabled: true },
          ],
        },
      });

    const result = await new DirectProviderAdapter().listUsersForTenantWithToken({
      tenant: 't1',
      managedTenantId: 'managed-1',
      accessToken: 'tok',
    });

    expect(result.pages).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.users.map((u) => u.entraObjectId)).toEqual(['u1', 'u2', 'u3']);
    expect(result.users.map((u) => u.email)).toEqual([
      'alice@acme.example',
      'bob@acme.example',
      'carol@acme.example',
    ]);
    expect(result.users[1].accountEnabled).toBe(false);
  });

  it('reports truncation honestly when the page budget is exhausted', async () => {
    hoisted.get
      .mockResolvedValueOnce({
        data: { value: [{ id: 'u1', userPrincipalName: 'a@x.example' }], '@odata.nextLink': 'https://graph.test/users?$skiptoken=2' },
      })
      .mockResolvedValueOnce({
        data: { value: [{ id: 'u2', userPrincipalName: 'b@x.example' }], '@odata.nextLink': 'https://graph.test/users?$skiptoken=3' },
      });

    const result = await new DirectProviderAdapter().listUsersForTenantWithToken({
      tenant: 't1',
      managedTenantId: 'managed-1',
      accessToken: 'tok',
      maxPages: 2,
    });

    expect(result.pages).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.users).toHaveLength(2);
  });
});

describe('CippProviderAdapter seams', () => {
  beforeEach(() => {
    hoisted.get.mockReset();
    hoisted.cipp = { baseUrl: 'https://cipp.test', apiToken: 'api-token' };
  });

  it('normalizes CIPP user rows (id/upn/email) via the adapter', async () => {
    hoisted.get.mockResolvedValueOnce({
      data: [
        { id: 'c1', userPrincipalName: 'alice@acme.example', mail: 'alice@acme.example', accountEnabled: true },
        { objectId: 'c2', upn: 'bob@acme.example', enabled: false },
      ],
    });

    const users = await new CippProviderAdapter().listUsersForTenant({
      tenant: 't1',
      managedTenantId: 'customer-1',
    });

    expect(users.map((u) => u.entraObjectId)).toEqual(['c1', 'c2']);
    expect(users.map((u) => u.email)).toEqual(['alice@acme.example', 'bob@acme.example']);
    expect(users[1].accountEnabled).toBe(false);
  });

  it('falls back across tenant-list endpoints and reports the answering endpoint', async () => {
    hoisted.get
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { isAxiosError: true, response: { status: 404 } }))
      .mockResolvedValueOnce({
        status: 200,
        data: { data: [{ customerId: 'tenant-a', displayName: 'Tenant A' }] },
      });

    const probe = await new CippProviderAdapter().probeTenantList('t1');

    expect(probe.outcome).toBe('ok');
    expect(probe.reachable).toBe(true);
    expect(probe.endpoint).toContain('/api/tenant/list');
    expect(probe.tenants.map((t) => t.entraTenantId)).toEqual(['tenant-a']);
    expect(probe.attempted.length).toBe(2);
  });

  it('attributes a 401 to auth rather than reachability', async () => {
    hoisted.get.mockRejectedValueOnce(
      Object.assign(new Error('unauthorized'), { isAxiosError: true, response: { status: 401 } })
    );
    const probe = await new CippProviderAdapter().probeTenantList('t1');
    expect(probe.outcome).toBe('auth_rejected');
    expect(probe.reachable).toBe(true);
    expect(probe.authRejected).toBe(true);
  });

  it('reports all-candidate HTTP errors as http_error, not an empty list', async () => {
    hoisted.get.mockRejectedValue(
      Object.assign(new Error('server error'), { isAxiosError: true, response: { status: 500 } })
    );
    const probe = await new CippProviderAdapter().probeTenantList('t1');
    expect(probe.outcome).toBe('http_error');
    expect(probe.reachable).toBe(true);
    expect(probe.tenants).toEqual([]);
    expect(probe.attempted.length).toBe(3);
  });

  it('reports a 200 non-list payload as invalid_payload', async () => {
    hoisted.get.mockResolvedValueOnce({ status: 200, data: { ok: true } });
    const probe = await new CippProviderAdapter().probeTenantList('t1');
    expect(probe.outcome).toBe('invalid_payload');
    expect(probe.reachable).toBe(true);
  });

  it('reports DNS failures as unreachable with the network cause', async () => {
    hoisted.get.mockRejectedValue(
      Object.assign(new Error('getaddrinfo ENOTFOUND cipp.test'), { isAxiosError: true, code: 'ENOTFOUND' })
    );
    const probe = await new CippProviderAdapter().probeTenantList('t1');
    expect(probe.outcome).toBe('unreachable');
    expect(probe.reachable).toBe(false);
    expect(probe.networkCode).toBe('ENOTFOUND');
  });
});
