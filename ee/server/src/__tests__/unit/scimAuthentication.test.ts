import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertTenantTierAccess: vi.fn(),
  firstConnection: vi.fn(),
  getAdminConnection: vi.fn(),
  tryConsume: vi.fn(),
  verifyScimToken: vi.fn(),
}));

vi.mock('@alga-psa/core/rateLimit', () => ({
  TokenBucketRateLimiter: {
    getInstance: () => ({ tryConsume: mocks.tryConsume }),
  },
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: mocks.getAdminConnection,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    unscoped: () => ({
      where: () => ({
        first: mocks.firstConnection,
      }),
    }),
  }),
}));

vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  assertTenantTierAccess: mocks.assertTenantTierAccess,
}));

vi.mock('@ee/lib/scim/credentials', () => ({
  verifyScimToken: mocks.verifyScimToken,
}));

vi.mock('@ee/lib/scim/service', () => ({
  ScimProvisioningService: class {},
  SCIM_SERVICE_PROVIDER_CONFIG: {},
  scimResourceTypes: vi.fn(),
  scimSchemas: vi.fn(),
}));

import { handleScimGet } from '@ee/lib/scim/handler';

const allowed = { allowed: true, remaining: 59 };
const connection = {
  tenant: 'tenant-1',
  connection_id: 'known-connection',
  enabled: true,
  current_token_hash: 'current-hash',
  current_token_generation: 1,
  previous_token_hash: 'previous-hash',
  previous_token_expires_at: new Date(Date.now() + 60_000),
};

function request(): Request {
  return new Request('https://example.test/api/scim/v2/connection/Users', {
    headers: {
      authorization: 'Bearer test-token',
      'x-forwarded-for': '203.0.113.5, 198.51.100.8',
    },
  });
}

describe('SCIM authentication rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminConnection.mockResolvedValue({});
    mocks.firstConnection.mockResolvedValue(undefined);
    mocks.tryConsume.mockResolvedValue(allowed);
    mocks.verifyScimToken.mockReturnValue(false);
  });

  it('source-limits unknown connections before performing dummy scrypt work', async () => {
    const response = await handleScimGet(request(), {
      connectionId: 'unknown-connection',
      scimPath: ['Users'],
    });

    expect(response.status).toBe(401);
    expect(mocks.tryConsume).toHaveBeenCalledTimes(1);
    expect(mocks.tryConsume).toHaveBeenCalledWith(
      'scim-auth',
      '__scim_public__',
      '198.51.100.8'
    );
    expect(mocks.getAdminConnection).toHaveBeenCalledOnce();
    expect(mocks.verifyScimToken).toHaveBeenCalledTimes(2);
  });

  it('returns a generic credential failure without lookup or scrypt when the public budget is exhausted', async () => {
    mocks.tryConsume.mockResolvedValue({ allowed: false, remaining: 0 });

    const response = await handleScimGet(request(), {
      connectionId: 'unknown-connection',
      scimPath: ['Users'],
    });

    expect(response.status).toBe(401);
    expect(mocks.getAdminConnection).not.toHaveBeenCalled();
    expect(mocks.verifyScimToken).not.toHaveBeenCalled();
  });

  it('fails closed before lookup or scrypt when the public limiter is unavailable', async () => {
    mocks.tryConsume.mockResolvedValue({ allowed: true, remaining: -1 });

    const response = await handleScimGet(request(), {
      connectionId: 'unknown-connection',
      scimPath: ['Users'],
    });

    expect(response.status).toBe(503);
    expect(mocks.getAdminConnection).not.toHaveBeenCalled();
    expect(mocks.verifyScimToken).not.toHaveBeenCalled();
  });

  it('does not expose the connection limiter until credentials are valid', async () => {
    mocks.firstConnection.mockResolvedValue(connection);

    const response = await handleScimGet(request(), {
      connectionId: connection.connection_id,
      scimPath: ['Users'],
    });

    expect(response.status).toBe(401);
    expect(mocks.verifyScimToken).toHaveBeenCalledTimes(2);
    expect(mocks.tryConsume).toHaveBeenCalledTimes(1);
  });

  it('returns 429 from the tenant connection limiter only after successful authentication', async () => {
    mocks.firstConnection.mockResolvedValue(connection);
    mocks.verifyScimToken
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    mocks.tryConsume
      .mockResolvedValueOnce(allowed)
      .mockResolvedValueOnce({ allowed: false, remaining: 0 });

    const response = await handleScimGet(request(), {
      connectionId: connection.connection_id,
      scimPath: ['Users'],
    });

    expect(response.status).toBe(429);
    expect(mocks.tryConsume).toHaveBeenNthCalledWith(
      2,
      'scim',
      connection.tenant,
      `${connection.connection_id}:198.51.100.8`
    );
  });
});
