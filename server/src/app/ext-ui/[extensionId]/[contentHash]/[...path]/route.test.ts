import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getTenantFromSessionAuthMock = vi.fn();
const getTenantInstallMock = vi.fn();
const resolveVersionMock = vi.fn();
const ensureUiCachedMock = vi.fn();
const serveFromMock = vi.fn();

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

vi.mock('server/src/lib/extensions/assets/cache', () => ({
  ensureUiCached: (...args: unknown[]) => ensureUiCachedMock(...args),
}));

vi.mock('server/src/lib/extensions/assets/serve', () => ({
  serveFrom: (...args: unknown[]) => serveFromMock(...args),
}));

const { GET } = await import('./route');

const ORIGINAL_EXT_UI_HOST_MODE = process.env.EXT_UI_HOST_MODE;

function buildRequest(headers: Record<string, string> = {}) {
  return new NextRequest('https://example.test/ext-ui/demo/sha256:abc123/index.html', {
    headers,
  });
}

function buildContext() {
  return {
    params: Promise.resolve({
      extensionId: 'demo',
      contentHash: 'sha256:abc123',
      path: ['index.html'],
    }),
  };
}

describe('GET /ext-ui/{extensionId}/{contentHash}/{path} (legacy nextjs mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EXT_UI_HOST_MODE = 'nextjs';
    delete process.env.DEV_TENANT_ID;
    serveFromMock.mockResolvedValue(new Response('ui-asset', { status: 200 }));
  });

  afterEach(() => {
    if (ORIGINAL_EXT_UI_HOST_MODE === undefined) {
      delete process.env.EXT_UI_HOST_MODE;
    } else {
      process.env.EXT_UI_HOST_MODE = ORIGINAL_EXT_UI_HOST_MODE;
    }
    delete process.env.DEV_TENANT_ID;
  });

  it('returns an indistinguishable 404 with no session and a forged tenant header', async () => {
    const { TenantAuthError } = await import('server/src/lib/extensions/gateway/auth');
    getTenantFromSessionAuthMock.mockRejectedValue(
      new TenantAuthError('unauthenticated', 'No authenticated session found'),
    );

    const response = await GET(
      buildRequest({ 'x-alga-tenant': 'attacker-tenant' }),
      buildContext(),
    );

    expect(response.status).toBe(404);
    expect(getTenantInstallMock).not.toHaveBeenCalled();
    expect(resolveVersionMock).not.toHaveBeenCalled();
    expect(ensureUiCachedMock).not.toHaveBeenCalled();
    expect(serveFromMock).not.toHaveBeenCalled();
  });

  it('returns a 404 for a partial session without reaching install/cache lookups', async () => {
    const { TenantAuthError } = await import('server/src/lib/extensions/gateway/auth');
    getTenantFromSessionAuthMock.mockRejectedValue(
      new TenantAuthError('invalid_session', 'Session is missing a tenant'),
    );

    const response = await GET(buildRequest(), buildContext());

    expect(response.status).toBe(404);
    expect(getTenantInstallMock).not.toHaveBeenCalled();
    expect(resolveVersionMock).not.toHaveBeenCalled();
    expect(ensureUiCachedMock).not.toHaveBeenCalled();
    expect(serveFromMock).not.toHaveBeenCalled();
  });

  it('returns a 404 when only DEV_TENANT_ID is set', async () => {
    const { TenantAuthError } = await import('server/src/lib/extensions/gateway/auth');
    process.env.DEV_TENANT_ID = 'dev-tenant';
    getTenantFromSessionAuthMock.mockRejectedValue(
      new TenantAuthError('unauthenticated', 'No authenticated session found'),
    );

    const response = await GET(buildRequest(), buildContext());

    expect(response.status).toBe(404);
    expect(getTenantInstallMock).not.toHaveBeenCalled();
    expect(ensureUiCachedMock).not.toHaveBeenCalled();
    expect(serveFromMock).not.toHaveBeenCalled();
  });

  it('serves the asset for a complete session with a matching content hash', async () => {
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
    ensureUiCachedMock.mockResolvedValue('/tmp/ui-cache/abc123');

    const response = await GET(buildRequest(), buildContext());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ui-asset');
    expect(serveFromMock).toHaveBeenCalledTimes(1);
  });

  it('returns a 404 when the content hash does not match the active install', async () => {
    getTenantFromSessionAuthMock.mockResolvedValue('tenant-a');
    getTenantInstallMock.mockResolvedValue({
      install_id: 'install-1',
      version_id: 'version-1',
      tenant_id: 'tenant-a',
    });
    resolveVersionMock.mockResolvedValue({
      install_id: 'install-1',
      version_id: 'version-1',
      content_hash: 'sha256:def456',
    });

    const response = await GET(buildRequest(), buildContext());

    expect(response.status).toBe(404);
    expect(ensureUiCachedMock).not.toHaveBeenCalled();
    expect(serveFromMock).not.toHaveBeenCalled();
  });
});
