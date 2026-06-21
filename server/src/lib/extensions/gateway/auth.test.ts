import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { getTenantFromAuth } from './auth';

const getSessionMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  getSession: () => getSessionMock(),
}));

function request(headers: Record<string, string> = {}) {
  return new NextRequest('https://example.test/api/ext/demo', { headers });
}

describe('extension gateway tenant resolution', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    delete process.env.DEV_TENANT_ID;
  });

  it('uses the authenticated session tenant even when no tenant header is present', async () => {
    getSessionMock.mockResolvedValue({ user: { tenant: 'tenant-a' } });

    await expect(getTenantFromAuth(request())).resolves.toBe('tenant-a');
  });

  it('rejects a tenant header that attempts to switch away from the session tenant', async () => {
    getSessionMock.mockResolvedValue({ user: { tenant: 'tenant-a' } });

    await expect(
      getTenantFromAuth(request({ 'x-alga-tenant': 'tenant-b' }))
    ).rejects.toThrow('tenant_mismatch');
  });

  it('allows matching tenant headers for callers with a session tenant', async () => {
    getSessionMock.mockResolvedValue({ user: { tenant: 'tenant-a' } });

    await expect(
      getTenantFromAuth(request({ 'x-tenant-id': 'tenant-a' }))
    ).resolves.toBe('tenant-a');
  });

  it('still supports header-only tenant resolution for internal callers without a session', async () => {
    getSessionMock.mockResolvedValue(null);

    await expect(
      getTenantFromAuth(request({ 'x-alga-tenant': 'tenant-internal' }))
    ).resolves.toBe('tenant-internal');
  });
});
