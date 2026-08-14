import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// Boundary tests for the direct `/api/ext` gateway route. The route consumes
// the canonical assertAccess, the shared execution audit, and the active-state
// install hydration; all external seams are mocked so the ordering (audit
// before hydration, hydration before dispatch) and terminal audit outcomes can
// be asserted without a runner.
const mocks = vi.hoisted(() => {
  class AccessError extends Error {
    code: string;
    status: number;
    retryAfterSeconds?: number;
    constructor(code: string, status: number, message: string, retryAfterSeconds?: number) {
      super(message);
      this.name = 'ExtensionGatewayAccessError';
      this.code = code;
      this.status = status;
      this.retryAfterSeconds = retryAfterSeconds;
    }
  }
  return {
    assertSessionProductAccess: vi.fn(),
    getTenantFromAuth: vi.fn(),
    assertAccess: vi.fn(),
    startExtensionExecution: vi.fn(),
    finishExtensionExecution: vi.fn(),
    getTenantInstall: vi.fn(),
    resolveVersion: vi.fn(),
    getCurrentUser: vi.fn(),
    createTenantKnex: vi.fn(),
    tenantDb: vi.fn(),
    getInstallConfig: vi.fn(),
    AccessError,
  };
});

vi.mock('@/lib/api/standaloneProductGuards', () => ({
  assertSessionProductAccess: mocks.assertSessionProductAccess,
}));

vi.mock('server/src/lib/extensions/gateway/auth', () => ({
  getTenantFromAuth: mocks.getTenantFromAuth,
  assertAccess: mocks.assertAccess,
  ExtensionGatewayAccessError: mocks.AccessError,
}));

vi.mock('server/src/lib/extensions/gateway/executionAudit', () => ({
  startExtensionExecution: mocks.startExtensionExecution,
  finishExtensionExecution: mocks.finishExtensionExecution,
}));

vi.mock('server/src/lib/extensions/gateway/registry', () => ({
  getTenantInstall: mocks.getTenantInstall,
  resolveVersion: mocks.resolveVersion,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: mocks.tenantDb,
}));

vi.mock('@enterprise/lib/extensions/installConfig', () => ({
  getInstallConfig: mocks.getInstallConfig,
}));

function accessFixture(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-1',
    installId: 'install-1',
    registryId: 'registry-1',
    versionId: 'version-1',
    endpoint: { method: 'GET', path: '/tickets', handler: 'handlers.list' },
    principal: { kind: 'msp', userId: 'user-1' },
    ...overrides,
  };
}

function configFixture(overrides: Record<string, unknown> = {}) {
  return {
    installId: 'install-1',
    versionId: 'version-1',
    contentHash: 'hash',
    config: { apiKey: 'config-value' },
    providers: ['http'],
    secretEnvelope: { ciphertext_b64: 'SECRET-CIPHERTEXT', algorithm: 'inline/base64' },
    ...overrides,
  };
}

function userFixture(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'user-1',
    tenant: 'tenant-1',
    user_type: 'internal',
    email: 'user@example.com',
    first_name: 'User',
    last_name: 'One',
    ...overrides,
  };
}

function runnerResponse(body: string, status = 200) {
  return {
    status,
    text: async () => body,
    headers: new Headers({ 'content-type': 'application/json' }),
  } as any;
}

describe('direct /api/ext gateway boundary', () => {
  // Caller-supplied URL alias (slug form) must never be used for install
  // hydration or runner identity after authorization; the canonical
  // access.registryId is used instead.
  const extensionId = 'publisher.agreements';

  beforeEach(() => {
    process.env.EDITION = 'ee';
    process.env.RUNNER_BASE_URL = 'http://runner.test';
    vi.clearAllMocks();
    mocks.assertSessionProductAccess.mockResolvedValue(null);
    mocks.getTenantFromAuth.mockResolvedValue('tenant-1');
    mocks.assertAccess.mockResolvedValue(accessFixture());
    mocks.startExtensionExecution.mockResolvedValue('log-1');
    mocks.getCurrentUser.mockResolvedValue(userFixture() as any);
    mocks.createTenantKnex.mockRejectedValue(new Error('db unavailable'));
    mocks.getInstallConfig.mockResolvedValue(configFixture());
  });

  afterEach(() => {
    delete process.env.EDITION;
    delete process.env.RUNNER_BASE_URL;
    vi.restoreAllMocks();
  });

  async function callHandler(method: string, path: string, init: RequestInit = {}) {
    const { GET, POST, PUT, PATCH, DELETE } = await import('server/src/app/api/ext/[extensionId]/[[...path]]/route');
    const fn = { GET, POST, PUT, PATCH, DELETE }[method];
    const req = new NextRequest(`http://localhost:3000/api/ext/${extensionId}/${path}`, {
      method,
      ...init,
    });
    return fn(req as any, { params: Promise.resolve({ extensionId, path: path.split('/').filter(Boolean) }) });
  }

  it('1. authorizes, starts the audit before hydration, and dispatches with the secret envelope and canonical IDs', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      runnerResponse(JSON.stringify({ status: 200, body_b64: Buffer.from('hello').toString('base64') }))
    );

    const response = await callHandler('GET', 'tickets');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello');

    expect(mocks.assertAccess).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      extensionId,
      method: 'GET',
      path: '/tickets',
    });
    // Install hydration and runner identity must use the canonical registry ID,
    // never the caller-supplied slug.
    expect(mocks.getInstallConfig).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      extensionId: 'registry-1',
    });
    expect(mocks.startExtensionExecution).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      registryId: 'registry-1',
      versionId: 'version-1',
      requestId: expect.any(String),
      method: 'GET',
      path: '/tickets',
      endpointTemplate: '/tickets',
      principalKind: 'msp',
      userId: 'user-1',
    });
    const auditStartOrder = mocks.startExtensionExecution.mock.invocationCallOrder[0];
    const hydrateOrder = mocks.getInstallConfig.mock.invocationCallOrder[0];
    expect(auditStartOrder).toBeLessThan(hydrateOrder);

    const fetchBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(fetchBody.context).toEqual(
      expect.objectContaining({
        install_id: 'install-1',
        version_id: 'version-1',
        tenant_id: 'tenant-1',
        extension_id: 'registry-1',
      })
    );
    expect(fetchBody.http.headers['x-alga-extension']).toBe('registry-1');
    expect((fetchSpy.mock.calls[0][1] as RequestInit).headers).toEqual(
      expect.objectContaining({ 'x-alga-extension': 'registry-1' })
    );
    expect(fetchBody.secret_envelope).toEqual({
      ciphertext_b64: 'SECRET-CIPHERTEXT',
      algorithm: 'inline/base64',
    });

    expect(mocks.finishExtensionExecution).toHaveBeenCalledWith(
      'log-1',
      'tenant-1',
      expect.objectContaining({ outcome: 'ok', status: 200 }),
    );
    expect(mocks.finishExtensionExecution.mock.calls[0][2]).not.toHaveProperty('secretEnvelope');
  });

  it('2. unauthenticated, forbidden, unavailable-install, endpoint-missing, rate-limited, and audit-failure never hydrate or dispatch', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');

    const scenarios: Array<{
      name: string;
      setup: () => void;
      expectedStatus: number;
      expectRetryAfter?: boolean;
    }> = [
      { name: 'unauthenticated', setup: () => mocks.assertAccess.mockRejectedValueOnce(new mocks.AccessError('unauthenticated', 401, 'no session')), expectedStatus: 401 },
      { name: 'rbac-denied', setup: () => mocks.assertAccess.mockRejectedValueOnce(new mocks.AccessError('forbidden', 403, 'no permission')), expectedStatus: 403 },
      { name: 'client-not-opted-in', setup: () => mocks.assertAccess.mockRejectedValueOnce(new mocks.AccessError('forbidden', 403, 'not opted in')), expectedStatus: 403 },
      { name: 'inactive-install', setup: () => mocks.assertAccess.mockRejectedValueOnce(new mocks.AccessError('extension_not_available', 404, 'n/a')), expectedStatus: 404 },
      { name: 'endpoint-missing', setup: () => mocks.assertAccess.mockRejectedValueOnce(new mocks.AccessError('endpoint_not_found', 404, 'no endpoint')), expectedStatus: 404 },
      { name: 'rate-limited', setup: () => mocks.assertAccess.mockRejectedValueOnce(new mocks.AccessError('rate_limited', 429, 'slow down', 5)), expectedStatus: 429, expectRetryAfter: true },
      { name: 'audit-failure', setup: () => mocks.startExtensionExecution.mockRejectedValueOnce(new Error('audit unavailable')), expectedStatus: 503 },
    ];

    for (const scenario of scenarios) {
      mocks.getInstallConfig.mockClear();
      scenario.setup();

      const response = await callHandler('GET', 'tickets');
      expect(response.status, scenario.name).toBe(scenario.expectedStatus);
      expect(mocks.getInstallConfig, scenario.name).not.toHaveBeenCalled();
      expect(fetchSpy, scenario.name).not.toHaveBeenCalled();

      if (scenario.expectRetryAfter) {
        expect(response.headers.get('retry-after')).toBe('5');
      }
      if (scenario.name === 'audit-failure') {
        expect(mocks.finishExtensionExecution).not.toHaveBeenCalled();
      }
    }
  });

  it('3. an install/version mismatch between authorization and hydration is rejected with a policy_denied audit row', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    mocks.getInstallConfig.mockResolvedValue(configFixture({ installId: 'install-2', versionId: 'version-2' }));

    const response = await callHandler('GET', 'tickets');

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'access_policy_unavailable' });
    expect(mocks.finishExtensionExecution).toHaveBeenCalledWith(
      'log-1',
      'tenant-1',
      expect.objectContaining({ outcome: 'policy_denied' }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('5. success, runner-error, timeout, empty-body, and invalid-response finish the audit row with the expected terminal status', async () => {
    const { GET } = await import('server/src/app/api/ext/[extensionId]/[[...path]]/route');

    async function assertOutcome(
      fetchImpl: () => Promise<unknown>,
      expectedResponseStatus: number,
      expectedOutcome: string,
      expectedAuditStatus: number,
    ) {
      mocks.finishExtensionExecution.mockClear();
      vi.spyOn(global, 'fetch').mockImplementation(fetchImpl as any);
      const req = new NextRequest(`http://localhost:3000/api/ext/${extensionId}/tickets`, { method: 'GET' });
      const response = await GET(req as any, { params: Promise.resolve({ extensionId, path: ['tickets'] }) });
      expect(response.status).toBe(expectedResponseStatus);
      expect(mocks.finishExtensionExecution).toHaveBeenCalledWith(
        'log-1',
        'tenant-1',
        expect.objectContaining({ outcome: expectedOutcome, status: expectedAuditStatus }),
      );
      const finishArgs = mocks.finishExtensionExecution.mock.calls[0][2] as Record<string, unknown>;
      expect(finishArgs).not.toHaveProperty('secretEnvelope');
      expect(finishArgs).not.toHaveProperty('config');
    }

    await assertOutcome(
      () => Promise.resolve(runnerResponse(JSON.stringify({ status: 200, body_b64: Buffer.from('x').toString('base64') }))),
      200,
      'ok',
      200,
    );
    await assertOutcome(
      () => Promise.reject(new Error('runner unreachable')),
      502,
      'error',
      502,
    );
    await assertOutcome(
      () => Promise.resolve(runnerResponse('')),
      502,
      'error',
      200,
    );
    await assertOutcome(
      () => Promise.resolve(runnerResponse('this is not json')),
      502,
      'error',
      200,
    );
    // A non-2xx transport status from the runner's /v1/execute is a runner
    // failure and must not be audited as success.
    await assertOutcome(
      () => Promise.resolve(runnerResponse(JSON.stringify({ error: 'runner exploded' }), 500)),
      502,
      'error',
      500,
    );
    // An extension-level payload 4xx/5xx (HTTP 200 transport) stays a
    // pass-through response but is audited as upstream_error, never ok.
    await assertOutcome(
      () => Promise.resolve(runnerResponse(JSON.stringify({ status: 503, body_b64: Buffer.from('ext unavailable').toString('base64') }))),
      503,
      'upstream_error',
      503,
    );

    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    await assertOutcome(
      () => Promise.reject(abortError),
      502,
      'timeout',
      502,
    );
  });

  it('7. runner failure responses carry a generic body with requestId only — no runner detail or body preview', async () => {
    const { GET } = await import('server/src/app/api/ext/[extensionId]/[[...path]]/route');

    vi.spyOn(global, 'fetch').mockResolvedValue(
      runnerResponse('runner blew up with SECRET-MATERIAL and stack frames', 500)
    );

    const req = new NextRequest(`http://localhost:3000/api/ext/${extensionId}/tickets`, { method: 'GET' });
    const response = await GET(req as any, { params: Promise.resolve({ extensionId, path: ['tickets'] }) });

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({ error: 'bad_gateway', requestId: expect.any(String) });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('runner');
    expect(serialized).not.toContain('SECRET-MATERIAL');
    expect(serialized).not.toContain('stack');
    expect(serialized).not.toContain('detail');
    expect(mocks.finishExtensionExecution).toHaveBeenCalledWith(
      'log-1',
      'tenant-1',
      expect.objectContaining({ outcome: 'error', status: 500 }),
    );
  });

  it('6. client success forwards the exact authorized client_id; missing client context denies before hydration', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      runnerResponse(JSON.stringify({ status: 200, body_b64: Buffer.from('ok').toString('base64') }))
    );

    mocks.assertAccess.mockResolvedValue(accessFixture({
      principal: { kind: 'client', userId: 'client-user', clientId: 'client-42' },
    }));
    mocks.getCurrentUser.mockResolvedValue(userFixture({ user_id: 'client-user', user_type: 'client' }) as any);

    const okResponse = await callHandler('GET', 'tickets');
    expect(okResponse.status).toBe(200);
    const fetchBody = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(fetchBody.user).toEqual(expect.objectContaining({ user_type: 'client', client_id: 'client-42' }));

    // Missing client context (emitted user is not a client) denies before hydration.
    mocks.getInstallConfig.mockClear();
    mocks.startExtensionExecution.mockClear();
    mocks.finishExtensionExecution.mockClear();
    fetchSpy.mockClear();
    mocks.getCurrentUser.mockResolvedValue(userFixture({ user_id: 'user-1', user_type: 'internal' }) as any);

    const badResponse = await callHandler('GET', 'tickets');
    expect(badResponse.status).toBe(403);
    expect(await badResponse.json()).toEqual({ error: 'forbidden' });
    expect(mocks.getInstallConfig).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.startExtensionExecution).not.toHaveBeenCalled();
  });
});
