import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getCurrentUserMock = vi.fn();
const hasPermissionMock = vi.fn();
const createDebugStreamClientMock = vi.fn();

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
}));

vi.mock('server/src/lib/extensions/debugStream/redis', () => ({
  createDebugStreamClient: (...args: unknown[]) => createDebugStreamClientMock(...args),
  getDebugStreamPrefix: () => 'ext-debug:',
}));

const { GET, POST } = await import('./route');

function buildRequest(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers });
}

function buildRedisClient() {
  const xRevRange = vi.fn().mockResolvedValue([]);
  const xRead = vi.fn().mockRejectedValue(new Error('stop polling in test'));
  return {
    xRevRange,
    xRead,
    quit: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
  };
}

describe('/api/ext-debug/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignores forged tenant headers when selecting the stream key from the session tenant', async () => {
    getCurrentUserMock.mockResolvedValue({ user_id: 'u1', tenant: 'session-tenant', user_type: 'internal' });
    hasPermissionMock.mockResolvedValue(true);
    const client = buildRedisClient();
    createDebugStreamClientMock.mockResolvedValue(client);

    const response = await GET(
      buildRequest('https://example.test/api/ext-debug/stream?extensionId=testext', {
        'x-alga-tenant': 'attacker-tenant',
        'x-tenant-id': 'attacker-legacy',
      }),
    );

    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(client.xRevRange).toHaveBeenCalled());
    expect(client.xRevRange.mock.calls[0][0]).toBe('ext-debug:session-tenant:testext');
  });

  it('uses currentUser.tenant when no tenant query is supplied', async () => {
    getCurrentUserMock.mockResolvedValue({ user_id: 'u1', tenant: 'session-tenant', user_type: 'internal' });
    hasPermissionMock.mockResolvedValue(true);
    const client = buildRedisClient();
    createDebugStreamClientMock.mockResolvedValue(client);

    const response = await GET(
      buildRequest('https://example.test/api/ext-debug/stream?extensionId=testext'),
    );

    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(client.xRevRange).toHaveBeenCalled());
    expect(client.xRevRange.mock.calls[0][0]).toBe('ext-debug:session-tenant:testext');
  });

  it('honors the explicit tenant query selection after the user and RBAC gates pass', async () => {
    getCurrentUserMock.mockResolvedValue({ user_id: 'u1', tenant: 'session-tenant', user_type: 'internal' });
    hasPermissionMock.mockResolvedValue(true);
    const client = buildRedisClient();
    createDebugStreamClientMock.mockResolvedValue(client);

    const response = await GET(
      buildRequest(
        'https://example.test/api/ext-debug/stream?extensionId=testext&tenantId=query-tenant',
      ),
    );

    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(client.xRevRange).toHaveBeenCalled());
    expect(client.xRevRange.mock.calls[0][0]).toBe('ext-debug:query-tenant:testext');
  });

  it('denies with 401 without opening Redis when there is no current user', async () => {
    getCurrentUserMock.mockResolvedValue(null);

    const response = await GET(
      buildRequest('https://example.test/api/ext-debug/stream?extensionId=testext'),
    );

    expect(response.status).toBe(401);
    expect(createDebugStreamClientMock).not.toHaveBeenCalled();
  });

  it('denies with 403 without opening Redis when the RBAC gate fails', async () => {
    getCurrentUserMock.mockResolvedValue({ user_id: 'u1', tenant: 'session-tenant', user_type: 'internal' });
    hasPermissionMock.mockResolvedValue(false);

    const response = await GET(
      buildRequest('https://example.test/api/ext-debug/stream?extensionId=testext'),
    );

    expect(response.status).toBe(403);
    expect(createDebugStreamClientMock).not.toHaveBeenCalled();
  });

  it('keeps POST polling behind the same user/RBAC gates', async () => {
    getCurrentUserMock.mockResolvedValue(null);

    const response = await POST(
      buildRequest('https://example.test/api/ext-debug/stream?extensionId=testext'),
    );

    expect(response.status).toBe(401);
    expect(createDebugStreamClientMock).not.toHaveBeenCalled();
  });
});
