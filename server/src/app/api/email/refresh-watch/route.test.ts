import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
  getAdminConnection: vi.fn(),
  tenantDb: vi.fn(),
  configureGmailProvider: vi.fn(),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@alga-psa/db', () => ({ tenantDb: mocks.tenantDb }));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: mocks.getAdminConnection }));
vi.mock('@alga-psa/integrations/actions/email-actions/configureGmailProvider', () => ({
  configureGmailProvider: mocks.configureGmailProvider,
}));

import { POST } from './route';

const knex = {};

function buildRequest(providerId = 'provider-1') {
  return new Request('https://example.test/api/email/refresh-watch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ providerId }),
  }) as any;
}

function setupTenantDb(options: { provider?: Record<string, unknown> | null; config?: Record<string, unknown> } = {}) {
  const provider = Object.hasOwn(options, 'provider') ? options.provider : {
    id: 'provider-1',
    tenant: 'tenant-1',
    mailbox: 'support@example.test',
  };
  const config = options.config ?? { project_id: 'google-project-1' };
  let lookupCount = 0;
  const first = vi.fn().mockImplementation(() => {
    const result = lookupCount++ % 2 === 0 ? provider : config;
    return Promise.resolve(result);
  });
  const query = {
    where: vi.fn().mockReturnThis(),
    first,
  };
  const db = { table: vi.fn().mockReturnValue(query) };
  mocks.tenantDb.mockReturnValue(db);
  return { db, query, first };
}

describe('POST /api/email/refresh-watch authorization and rate limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminConnection.mockResolvedValue(knex);
    mocks.getCurrentUser.mockResolvedValue({
      user_id: 'user-1',
      user_type: 'internal',
      tenant: 'tenant-1',
      email: 'admin@example.test',
    });
    mocks.hasPermission.mockResolvedValue(true);
    mocks.configureGmailProvider.mockResolvedValue({
      success: true,
      pubsubConfigured: true,
      watchRegistered: true,
      warnings: [],
    });
    setupTenantDb();
  });

  it('denies a tenant user without ticket_settings:update before provider lookup or external work', async () => {
    mocks.hasPermission.mockResolvedValue(false);

    const response = await POST(buildRequest());

    expect(response.status).toBe(403);
    expect(mocks.tenantDb).not.toHaveBeenCalled();
    expect(mocks.configureGmailProvider).not.toHaveBeenCalled();
  });

  it('denies client users even if permission data says they have the permission', async () => {
    mocks.getCurrentUser.mockResolvedValue({
      user_id: 'client-1', user_type: 'client', tenant: 'tenant-1',
    });

    const response = await POST(buildRequest());

    expect(response.status).toBe(403);
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    expect(mocks.tenantDb).not.toHaveBeenCalled();
    expect(mocks.configureGmailProvider).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests before database or external work', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const response = await POST(buildRequest());

    expect(response.status).toBe(401);
    expect(mocks.getAdminConnection).not.toHaveBeenCalled();
    expect(mocks.tenantDb).not.toHaveBeenCalled();
    expect(mocks.configureGmailProvider).not.toHaveBeenCalled();
  });

  it('allows an administrator to force-refresh a provider from their tenant', async () => {
    const { query } = setupTenantDb();

    const response = await POST(buildRequest());

    expect(response.status).toBe(200);
    expect(mocks.tenantDb).toHaveBeenCalledWith(knex, 'tenant-1');
    expect(query.where).toHaveBeenCalledWith('id', 'provider-1');
    expect(mocks.configureGmailProvider).toHaveBeenCalledWith({
      tenant: 'tenant-1',
      providerId: 'provider-1',
      projectId: 'google-project-1',
      force: true,
    });
  });

  it('does not refresh a provider that is not visible in the caller tenant', async () => {
    setupTenantDb({ provider: null });

    const response = await POST(buildRequest('foreign-provider'));

    expect(response.status).toBe(404);
    expect(mocks.tenantDb).toHaveBeenCalledWith(knex, 'tenant-1');
    expect(mocks.configureGmailProvider).not.toHaveBeenCalled();
  });

  it('limits repeated refreshes per tenant and provider while isolating tenants and providers', async () => {
    const firstRefresh = await POST(buildRequest('limited-provider'));
    const secondRefresh = await POST(buildRequest('limited-provider'));
    const independentProviderRefresh = await POST(buildRequest('independent-provider'));

    mocks.getCurrentUser.mockResolvedValue({
      user_id: 'user-2',
      user_type: 'internal',
      tenant: 'tenant-2',
    });
    const sameProviderOtherTenantRefresh = await POST(buildRequest('shared-provider-id'));
    mocks.getCurrentUser.mockResolvedValue({
      user_id: 'user-1',
      user_type: 'internal',
      tenant: 'tenant-1',
    });
    const sameProviderFirstTenantRefresh = await POST(buildRequest('shared-provider-id'));

    expect(firstRefresh.status).toBe(200);
    expect(secondRefresh.status).toBe(429);
    expect(independentProviderRefresh.status).toBe(200);
    expect(sameProviderOtherTenantRefresh.status).toBe(200);
    expect(sameProviderFirstTenantRefresh.status).toBe(200);
    expect(mocks.configureGmailProvider).toHaveBeenCalledTimes(4);
  });
});
