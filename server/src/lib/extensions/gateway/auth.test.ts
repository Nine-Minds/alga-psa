import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

import {
  TenantAuthError,
  getTenantFromSessionAuth,
  getTenantFromServiceAuth,
} from './auth';

const getSessionMock = vi.fn();

vi.mock('@alga-psa/auth', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('@alga-psa/auth');
  return {
    ...actual,
    getSession: () => getSessionMock(),
  };
});

function request(headers: Record<string, string> = {}) {
  return new NextRequest('https://example.test/api/ext/demo', { headers });
}

function expectTenantAuthError(
  promise: Promise<unknown>,
  code: string,
) {
  return expect(promise).rejects.toMatchObject({ code });
}

describe('extension gateway tenant resolution', () => {
  beforeEach(() => {
    getSessionMock.mockReset();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('RUNNER_SERVICE_TOKEN', '');
    vi.stubEnv('DEV_TENANT_ID', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });  describe('getTenantFromSessionAuth', () => {
    it('returns the session tenant when no tenant header is present', async () => {
      getSessionMock.mockResolvedValue({ user: { tenant: 'tenant-a' } });

      await expect(getTenantFromSessionAuth(request())).resolves.toBe('tenant-a');
    });

    it('returns the session tenant when a matching canonical header is present', async () => {
      getSessionMock.mockResolvedValue({ user: { tenant: 'tenant-a' } });

      await expect(
        getTenantFromSessionAuth(request({ 'x-alga-tenant': 'tenant-a' })),
      ).resolves.toBe('tenant-a');
    });

    it('returns the session tenant when a matching legacy header is present', async () => {
      getSessionMock.mockResolvedValue({ user: { tenant: 'tenant-a' } });

      await expect(
        getTenantFromSessionAuth(request({ 'x-tenant-id': 'tenant-a' })),
      ).resolves.toBe('tenant-a');
    });

    it('returns the session tenant when canonical and legacy headers both match', async () => {
      getSessionMock.mockResolvedValue({ user: { tenant: 'tenant-a' } });

      await expect(
        getTenantFromSessionAuth(
          request({ 'x-alga-tenant': 'tenant-a', 'x-tenant-id': 'tenant-a' }),
        ),
      ).resolves.toBe('tenant-a');
    });

    it('rejects with tenant_mismatch when the canonical header differs from the session', async () => {
      getSessionMock.mockResolvedValue({ user: { tenant: 'tenant-a' } });

      await expectTenantAuthError(
        getTenantFromSessionAuth(request({ 'x-alga-tenant': 'tenant-b' })),
        'tenant_mismatch',
      );
    });

    it('rejects with tenant_mismatch when the legacy header differs from the session', async () => {
      getSessionMock.mockResolvedValue({ user: { tenant: 'tenant-a' } });

      await expectTenantAuthError(
        getTenantFromSessionAuth(request({ 'x-tenant-id': 'tenant-b' })),
        'tenant_mismatch',
      );
    });

    it('rejects with tenant_mismatch when canonical and legacy headers disagree even if one matches the session', async () => {
      getSessionMock.mockResolvedValue({ user: { tenant: 'tenant-a' } });

      await expectTenantAuthError(
        getTenantFromSessionAuth(
          request({ 'x-alga-tenant': 'tenant-a', 'x-tenant-id': 'tenant-b' }),
        ),
        'tenant_mismatch',
      );
    });

    it('rejects with tenant_mismatch when both supplied headers disagree with the session', async () => {
      getSessionMock.mockResolvedValue({ user: { tenant: 'tenant-a' } });

      await expectTenantAuthError(
        getTenantFromSessionAuth(
          request({ 'x-alga-tenant': 'tenant-b', 'x-tenant-id': 'tenant-c' }),
        ),
        'tenant_mismatch',
      );
    });

    it('rejects with unauthenticated when there is no session even with a forged tenant header', async () => {
      getSessionMock.mockResolvedValue(null);

      await expectTenantAuthError(
        getTenantFromSessionAuth(request({ 'x-alga-tenant': 'attacker-tenant' })),
        'unauthenticated',
      );
    });

    it('rejects with unauthenticated even when a valid service token accompanies a forged header', async () => {
      getSessionMock.mockResolvedValue(null);
      vi.stubEnv('RUNNER_SERVICE_TOKEN', 'service-secret');

      await expectTenantAuthError(
        getTenantFromSessionAuth(
          request({
            'x-alga-tenant': 'attacker-tenant',
            'x-runner-auth': 'service-secret',
          }),
        ),
        'unauthenticated',
      );
    });

    it('rejects with invalid_session when the session user has no tenant, regardless of headers/token', async () => {
      getSessionMock.mockResolvedValue({ user: { tenant: undefined } });

      await expectTenantAuthError(
        getTenantFromSessionAuth(request({ 'x-alga-tenant': 'tenant-b' })),
        'invalid_session',
      );
    });

    it('rejects with invalid_session when the session tenant is blank, regardless of headers/token', async () => {
      getSessionMock.mockResolvedValue({ user: { tenant: '   ' } });

      await expectTenantAuthError(
        getTenantFromSessionAuth(
          request({
            'x-alga-tenant': 'tenant-b',
            'x-runner-auth': 'service-secret',
          }),
        ),
        'invalid_session',
      );
    });

    it('rejects with invalid_session when the session user is absent, never falling into service mode', async () => {
      getSessionMock.mockResolvedValue({});

      await expectTenantAuthError(
        getTenantFromSessionAuth(request()),
        'invalid_session',
      );
    });
  });

  describe('getTenantFromServiceAuth', () => {
    it('rejects with invalid_service_auth when no token is supplied', async () => {
      getSessionMock.mockResolvedValue(null);
      vi.stubEnv('RUNNER_SERVICE_TOKEN', 'service-secret');

      await expectTenantAuthError(
        getTenantFromServiceAuth(request({ 'x-alga-tenant': 'tenant-svc' })),
        'invalid_service_auth',
      );
    });

    it('rejects with invalid_service_auth when the token is incorrect', async () => {
      getSessionMock.mockResolvedValue(null);
      vi.stubEnv('RUNNER_SERVICE_TOKEN', 'service-secret');

      await expectTenantAuthError(
        getTenantFromServiceAuth(
          request({ 'x-alga-tenant': 'tenant-svc', 'x-runner-auth': 'wrong-token' }),
        ),
        'invalid_service_auth',
      );
    });

    it('rejects with invalid_service_auth when the token is unconfigured', async () => {
      getSessionMock.mockResolvedValue(null);

      await expectTenantAuthError(
        getTenantFromServiceAuth(
          request({ 'x-alga-tenant': 'tenant-svc', 'x-runner-auth': 'service-secret' }),
        ),
        'invalid_service_auth',
      );
    });

    it('returns the canonical header tenant with a valid token', async () => {
      getSessionMock.mockResolvedValue(null);
      vi.stubEnv('RUNNER_SERVICE_TOKEN', 'service-secret');

      await expect(
        getTenantFromServiceAuth(
          request({ 'x-alga-tenant': 'tenant-svc', 'x-runner-auth': 'service-secret' }),
        ),
      ).resolves.toBe('tenant-svc');
    });

    it('returns the legacy header tenant for compatibility with a valid token', async () => {
      getSessionMock.mockResolvedValue(null);
      vi.stubEnv('RUNNER_SERVICE_TOKEN', 'service-secret');

      await expect(
        getTenantFromServiceAuth(
          request({ 'x-tenant-id': 'tenant-legacy', 'x-runner-auth': 'service-secret' }),
        ),
      ).resolves.toBe('tenant-legacy');
    });

    it('rejects with missing_tenant when no tenant header is present', async () => {
      getSessionMock.mockResolvedValue(null);
      vi.stubEnv('RUNNER_SERVICE_TOKEN', 'service-secret');

      await expectTenantAuthError(
        getTenantFromServiceAuth(request({ 'x-runner-auth': 'service-secret' })),
        'missing_tenant',
      );
    });

    it('rejects with tenant_mismatch when canonical and legacy headers conflict', async () => {
      getSessionMock.mockResolvedValue(null);
      vi.stubEnv('RUNNER_SERVICE_TOKEN', 'service-secret');

      await expectTenantAuthError(
        getTenantFromServiceAuth(
          request({
            'x-alga-tenant': 'tenant-a',
            'x-tenant-id': 'tenant-b',
            'x-runner-auth': 'service-secret',
          }),
        ),
        'tenant_mismatch',
      );
    });

    it('rejects with mixed_auth when any session is present with otherwise valid service credentials', async () => {
      getSessionMock.mockResolvedValue({ user: { tenant: 'tenant-a' } });
      vi.stubEnv('RUNNER_SERVICE_TOKEN', 'service-secret');

      await expectTenantAuthError(
        getTenantFromServiceAuth(
          request({
            'x-alga-tenant': 'tenant-svc',
            'x-runner-auth': 'service-secret',
          }),
        ),
        'mixed_auth',
      );
    });

    it('rejects with mixed_auth when a partial session is present', async () => {
      getSessionMock.mockResolvedValue({ user: {} });
      vi.stubEnv('RUNNER_SERVICE_TOKEN', 'service-secret');

      await expectTenantAuthError(
        getTenantFromServiceAuth(
          request({ 'x-alga-tenant': 'tenant-svc', 'x-runner-auth': 'service-secret' }),
        ),
        'mixed_auth',
      );
    });

    it('rejects a known default service token in production via runner-auth validation', async () => {
      getSessionMock.mockResolvedValue(null);
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('RUNNER_SERVICE_TOKEN', 'local-runner-key');

      await expectTenantAuthError(
        getTenantFromServiceAuth(
          request({ 'x-alga-tenant': 'tenant-svc', 'x-runner-auth': 'local-runner-key' }),
        ),
        'invalid_service_auth',
      );
    });
  });

  describe('DEV_TENANT_ID has no effect', () => {
    it('does not resolve a tenant from DEV_TENANT_ID for the session resolver', async () => {
      getSessionMock.mockResolvedValue(null);
      vi.stubEnv('DEV_TENANT_ID', 'dev-tenant');

      await expectTenantAuthError(
        getTenantFromSessionAuth(request()),
        'unauthenticated',
      );
    });

    it('does not resolve a tenant from DEV_TENANT_ID for the service resolver', async () => {
      getSessionMock.mockResolvedValue(null);
      vi.stubEnv('DEV_TENANT_ID', 'dev-tenant');
      vi.stubEnv('RUNNER_SERVICE_TOKEN', 'service-secret');

      await expectTenantAuthError(
        getTenantFromServiceAuth(request({ 'x-runner-auth': 'service-secret' })),
        'missing_tenant',
      );
    });
  });

  it('TenantAuthError carries the expected status codes', () => {
    expect(new TenantAuthError('tenant_mismatch', 'x').status).toBe(403);
    expect(new TenantAuthError('unauthenticated', 'x').status).toBe(401);
    expect(new TenantAuthError('invalid_session', 'x').status).toBe(401);
    expect(new TenantAuthError('invalid_service_auth', 'x').status).toBe(401);
    expect(new TenantAuthError('missing_tenant', 'x').status).toBe(401);
    expect(new TenantAuthError('mixed_auth', 'x').status).toBe(401);
  });
});
