import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const assertSessionProductAccessMock = vi.fn();
const getTenantFromSessionAuthMock = vi.fn();
const getTenantInstallMock = vi.fn();
const resolveVersionMock = vi.fn();
const getCurrentUserMock = vi.fn();
const createTenantKnexMock = vi.fn();

vi.mock('@/lib/api/standaloneProductGuards', () => ({
  assertSessionProductAccess: (...args: unknown[]) => assertSessionProductAccessMock(...args),
}));

vi.mock('server/src/lib/extensions/gateway/auth', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    getTenantFromSessionAuth: (...args: unknown[]) => getTenantFromSessionAuthMock(...args),
  };
});

vi.mock('server/src/lib/extensions/gateway/registry', () => ({
  getTenantInstall: (...args: unknown[]) => getTenantInstallMock(...args),
  resolveVersion: (...args: unknown[]) => resolveVersionMock(...args),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: (...args: unknown[]) => createTenantKnexMock(...args),
}));

const { GET, OPTIONS } = await import('./route');

function buildRequest(headers: Record<string, string> = {}) {
  return new NextRequest('https://example.test/api/ext/demo/ext/action', { headers });
}

function buildContext() {
  return { params: Promise.resolve({ extensionId: 'demo', path: ['ext', 'action'] }) };
}

function deniedResponse(status: number) {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GET /api/ext/{extensionId}/{path}', () => {
  const fetchSpy = vi.spyOn(global, 'fetch');

  beforeEach(() => {
    vi.clearAllMocks();
    createTenantKnexMock.mockRejectedValue(new Error('no database in route test'));
  });

  it('returns 401 before tenant resolution/install lookup/runner fetch when there is no session', async () => {
    assertSessionProductAccessMock.mockResolvedValue(deniedResponse(401));

    const response = await GET(buildRequest({ 'x-alga-tenant': 'attacker-tenant' }), buildContext());

    expect(response.status).toBe(401);
    expect(getTenantFromSessionAuthMock).not.toHaveBeenCalled();
    expect(getTenantInstallMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stops before install lookup when the session is partial (guard rejects)', async () => {
    assertSessionProductAccessMock.mockResolvedValue(deniedResponse(401));

    const response = await GET(buildRequest(), buildContext());

    expect(response.status).toBe(401);
    expect(getTenantFromSessionAuthMock).not.toHaveBeenCalled();
    expect(getTenantInstallMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 403 and stops downstream on a tenant mismatch', async () => {
    const { TenantAuthError } = await import('server/src/lib/extensions/gateway/auth');
    assertSessionProductAccessMock.mockResolvedValue(null);
    getTenantFromSessionAuthMock.mockRejectedValue(
      new TenantAuthError('tenant_mismatch', 'x-alga-tenant header does not match the session tenant'),
    );

    const response = await GET(buildRequest({ 'x-alga-tenant': 'tenant-b' }), buildContext());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'tenant_mismatch' });
    expect(getTenantInstallMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('forwards a valid session request to the runner', async () => {
    const { TenantAuthError } = await import('server/src/lib/extensions/gateway/auth');
    assertSessionProductAccessMock.mockResolvedValue(null);
    getTenantFromSessionAuthMock.mockResolvedValue('tenant-a');
    getTenantInstallMock.mockResolvedValue({
      install_id: 'install-1',
      version_id: 'version-1',
      tenant_id: 'tenant-a',
    });
    resolveVersionMock.mockResolvedValue({
      install_id: 'install-1',
      version_id: 'version-1',
      content_hash: 'sha256:abc123',
    });
    getCurrentUserMock.mockResolvedValue({
      user_id: 'user-1',
      email: 'u@example.com',
      first_name: 'Unit',
      last_name: 'Tester',
      tenant: 'tenant-a',
      user_type: 'internal',
    });
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ body_b64: Buffer.from('runner-ok').toString('base64'), status: 200 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const response = await GET(buildRequest(), buildContext());

    expect(TenantAuthError).toBeDefined();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('runner-ok');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/v1/execute');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.context.tenant_id).toBe('tenant-a');
    expect(body.user.user_id).toBe('user-1');
  });

  it('does not advertise x-alga-tenant in the CORS allow-list', async () => {
    const preflight = new NextRequest('https://example.test/api/ext/demo/ext/action', {
      method: 'OPTIONS',
      headers: { origin: 'https://example.test' },
    });

    const response = await OPTIONS(preflight, buildContext());

    expect(response.status).toBe(204);
    const allowHeaders = response.headers.get('access-control-allow-headers') ?? '';
    expect(allowHeaders.toLowerCase()).not.toContain('x-alga-tenant');
  });
});
