
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bootstrapIframe } from '../../lib/extensions/ui/iframeBridge';

// Gateway Handler tests: the ext-proxy handler consumes the package-local
// gateway/auth module (which re-exports the canonical server access resolver),
// a fresh install-config hydration (cache is bypassed), and the shared
// execution audit. All of those seams are mocked here so the handler's
// ordering and terminal-path behavior can be exercised at the boundary.
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
  class RunnerConfigError extends Error {}
  class RunnerRequestError extends Error {
    status?: number;
    backend: string;
    constructor(message: string, backend: string, status?: number) {
      super(message);
      this.name = 'RunnerRequestError';
      this.backend = backend;
      this.status = status;
    }
  }
  return {
    getTenantFromAuth: vi.fn(),
    getUserInfoFromAuth: vi.fn(),
    assertAccess: vi.fn(),
    getInstallConfig: vi.fn(),
    startExtensionExecution: vi.fn(),
    finishExtensionExecution: vi.fn(),
    getRunnerBackend: vi.fn(),
    AccessError,
    RunnerConfigError,
    RunnerRequestError,
  };
});

vi.mock('../../../../../packages/product-ext-proxy/ee/gateway/auth', () => ({
  getTenantFromAuth: mocks.getTenantFromAuth,
  getUserInfoFromAuth: mocks.getUserInfoFromAuth,
  assertAccess: mocks.assertAccess,
  ExtensionGatewayAccessError: mocks.AccessError,
}));

vi.mock('@ee/lib/extensions/installConfig', () => ({
  getInstallConfig: mocks.getInstallConfig,
}));

vi.mock('../../../../../packages/product-ext-proxy/ee/gateway/executionAudit', () => ({
  startExtensionExecution: mocks.startExtensionExecution,
  finishExtensionExecution: mocks.finishExtensionExecution,
}));

vi.mock('../../../../../packages/product-ext-proxy/ee/runner-backend', () => ({
  getRunnerBackend: mocks.getRunnerBackend,
  RunnerConfigError: mocks.RunnerConfigError,
  RunnerRequestError: mocks.RunnerRequestError,
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

function installConfigFixture(overrides: Record<string, unknown> = {}) {
  return {
    installId: 'install-1',
    versionId: 'version-1',
    contentHash: 'hash',
    config: { apiKey: 'config-value' },
    providers: ['http'],
    secretEnvelope: { ciphertext_b64: 'SECRET-CIPHERTEXT', algorithm: 'inline/base64' },
    configVersion: 'cv1',
    secretsVersion: 'sv1',
    ...overrides,
  };
}

function userInfoFixture(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'user-1',
    user_email: 'user@example.com',
    user_name: 'User One',
    user_type: 'internal',
    client_name: '',
    client_id: undefined,
    additional_fields: {},
    ...overrides,
  };
}

describe('Extension Proxy Flow Integration', () => {
  const extensionId = 'test-extension-id';
  const origin = 'http://localhost:3000';

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset window events
    window.location = { origin } as any;
  });

  describe('Host Bridge (Client -> Host)', () => {
    it('should forward "apiproxy" message to Gateway and return response to Client', async () => {
      const iframe = document.createElement('iframe');
      iframe.src = `http://localhost:3000/ext-ui/${extensionId}/hash/index.html`;
      document.body.appendChild(iframe);

      // Mock postMessage on the iframe's contentWindow
      // Note: In jsdom, contentWindow is a proxy, but we can try to spy on it if we attach it first
      // Or we can spy on the prototype if needed, but let's try attaching a mock function
      const postMessageSpy = vi.fn();
      // @ts-ignore - Overwrite postMessage for testing
      iframe.contentWindow.postMessage = postMessageSpy;

      // Spy on fetch to return success
      const responseBody = new Uint8Array([1, 2, 3]); // Binary data
      const blob = new Blob([responseBody]);
      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => ({
        ok: true,
        blob: async () => blob,
      } as any));

      // Initialize bridge
      // @ts-ignore
      bootstrapIframe({ iframe, extensionId });

      // Simulate SDK sending apiproxy message
      const requestId = 'req-123';
      const route = '/tickets';
      const payload = { route, body: 'aGVsbG8=' }; // Valid base64 for "hello"
      const message = {
        alga: true,
        version: '1',
        type: 'apiproxy',
        request_id: requestId,
        payload,
      };

      // Dispatch message from "iframe"
      const event = new MessageEvent('message', {
        data: message,
        origin: origin,
        source: iframe.contentWindow,
      });
      window.dispatchEvent(event);

      // Wait for async operations
      await new Promise(r => setTimeout(r, 50));

      // Verify Fetch Call
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining(`/api/ext-proxy/${extensionId}${route}`),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'content-type': 'application/octet-stream' }),
        })
      );

      // Verify Response Message to Client
      // The response body should be base64 encoded.
      // FileReader reads blob as data url: "data:application/octet-stream;base64,AQID"
      // Our code splits at ',' -> "AQID"
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          alga: true,
          type: 'apiproxy_response',
          request_id: requestId,
          payload: expect.objectContaining({
            body: expect.any(String), // We expect base64 string
          }),
        }),
        '*'
      );
    });

    it('should forward explicit proxy method from iframe payload', async () => {
      const iframe = document.createElement('iframe');
      iframe.src = `http://localhost:3000/ext-ui/${extensionId}/hash/index.html`;
      document.body.appendChild(iframe);

      const postMessageSpy = vi.fn();
      // @ts-ignore
      iframe.contentWindow.postMessage = postMessageSpy;

      const blob = new Blob([new Uint8Array([9, 9, 9])]);
      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => ({
        ok: true,
        blob: async () => blob,
      } as any));

      // @ts-ignore
      bootstrapIframe({ iframe, extensionId });

      const requestId = 'req-get-method';
      const event = new MessageEvent('message', {
        data: {
          alga: true,
          version: '1',
          type: 'apiproxy',
          request_id: requestId,
          payload: { route: '/user', method: 'GET' },
        },
        origin: origin,
        source: iframe.contentWindow,
      });
      window.dispatchEvent(event);

      await new Promise((r) => setTimeout(r, 50));

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining(`/api/ext-proxy/${extensionId}/user`),
        expect.objectContaining({
          method: 'GET',
        }),
      );

      const [, fetchOptions] = fetchSpy.mock.calls[0];
      expect(fetchOptions?.body).toBeUndefined();

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          alga: true,
          type: 'apiproxy_response',
          request_id: requestId,
        }),
        '*'
      );
    });

    it('should handle Gateway errors and return error message to Client', async () => {
      const iframe = document.createElement('iframe');
      iframe.src = `http://localhost:3000/ext-ui/${extensionId}/hash/index.html`;
      document.body.appendChild(iframe);

      const postMessageSpy = vi.fn();
      // @ts-ignore
      iframe.contentWindow.postMessage = postMessageSpy;

      // Spy on fetch to return error
      vi.spyOn(global, 'fetch').mockImplementation(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Something went wrong',
      } as any));

      // @ts-ignore
      bootstrapIframe({ iframe, extensionId });

      const requestId = 'req-error';
      const message = {
        alga: true,
        version: '1',
        type: 'apiproxy',
        request_id: requestId,
        payload: { route: '/error-route' },
      };

      const event = new MessageEvent('message', {
        data: message,
        origin: origin,
        source: iframe.contentWindow,
      });
      window.dispatchEvent(event);

      await new Promise(r => setTimeout(r, 50));

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          alga: true,
          type: 'apiproxy_response',
          request_id: requestId,
          payload: expect.objectContaining({
            error: expect.stringContaining('Proxy error 500: Something went wrong'),
          }),
        }),
        '*'
      );
    });
  });

  describe('Gateway Handler (Host -> Runner)', () => {
    beforeEach(() => {
      mocks.getTenantFromAuth.mockResolvedValue('tenant-1');
      mocks.assertAccess.mockResolvedValue(accessFixture());
      mocks.getUserInfoFromAuth.mockResolvedValue(userInfoFixture());
      mocks.getInstallConfig.mockResolvedValue(installConfigFixture());
      mocks.startExtensionExecution.mockResolvedValue('log-1');
      mocks.getRunnerBackend.mockReturnValue({
        kind: 'docker',
        getPublicBase: () => null,
        execute: vi.fn().mockResolvedValue({
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: Buffer.from('{}'),
        }),
      } as any);
    });

    async function callHandler(rawMethod: string, url: string, init: RequestInit = {}) {
      const handler = await import('../../../../../packages/product-ext-proxy/ee/handler');
      const fn = (handler as any)[rawMethod];
      const req = new Request(url, { method: rawMethod, ...init });
      const params = { extensionId, path: new URL(url).pathname.split('/').filter(Boolean).slice(2) };
      return fn(req as any, { params: Promise.resolve(params) });
    }

    function getBackendExecute() {
      return mocks.getRunnerBackend.mock.results[0]?.value?.execute;
    }

    it('1. authorizes, starts audit, hydrates the exact active install, then dispatches with canonical IDs and the secret envelope', async () => {
      const { GET } = await import('../../../../../packages/product-ext-proxy/ee/handler');

      const req = new Request(`http://localhost:3000/api/ext-proxy/${extensionId}/tickets?limit=10`, {
        method: 'GET',
        headers: { 'x-request-id': 'req-123' },
      });
      const response = await GET(req as any, { params: Promise.resolve({ extensionId, path: ['tickets'] }) });

      expect(response.status).toBe(200);
      const execute = mocks.getRunnerBackend.mock.results[0]?.value?.execute;
      expect(mocks.assertAccess).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        extensionId,
        method: 'GET',
        path: '/tickets',
      });
      expect(mocks.startExtensionExecution).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        registryId: 'registry-1',
        versionId: 'version-1',
        requestId: 'req-123',
        method: 'GET',
        path: '/tickets',
        endpointTemplate: '/tickets',
        principalKind: 'msp',
        userId: 'user-1',
      });
      expect(mocks.getInstallConfig).toHaveBeenCalledWith({ tenantId: 'tenant-1', extensionId: 'registry-1' });
      // Audit start precedes secret-bearing hydration.
      const startOrder = mocks.startExtensionExecution.mock.invocationCallOrder[0];
      const hydrateOrder = mocks.getInstallConfig.mock.invocationCallOrder[0];
      expect(startOrder).toBeLessThan(hydrateOrder);

      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            extension_id: 'registry-1',
            tenant_id: 'tenant-1',
            install_id: 'install-1',
            version_id: 'version-1',
          }),
          secret_envelope: { ciphertext_b64: 'SECRET-CIPHERTEXT', algorithm: 'inline/base64' },
          http: expect.objectContaining({ path: '/tickets', method: 'GET' }),
        }),
        expect.objectContaining({
          requestId: 'req-123',
          headers: expect.objectContaining({
            'x-alga-extension': 'registry-1',
            'x-ext-install-id': 'install-1',
            'x-ext-version-id': 'version-1',
            'x-ext-registry-id': 'registry-1',
          }),
        })
      );
      expect(mocks.finishExtensionExecution).toHaveBeenCalledWith(
        'log-1',
        'tenant-1',
        expect.objectContaining({ outcome: 'ok', status: 200 }),
      );
    });

    it('2. unauthenticated, RBAC-denied, client-not-opted-in, inactive-install, undeclared-endpoint, rate-limited, and audit-insert-failure never hydrate or dispatch', async () => {
      const { GET } = await import('../../../../../packages/product-ext-proxy/ee/handler');

      const scenarios: Array<{
        name: string;
        setup: () => void;
        expectedStatus: number;
        expectedBody?: Record<string, unknown>;
      }> = [
        {
          name: 'unauthenticated',
          setup: () => mocks.assertAccess.mockRejectedValueOnce(new mocks.AccessError('unauthenticated', 401, 'no session')),
          expectedStatus: 401,
        },
        {
          name: 'rbac-denied',
          setup: () => mocks.assertAccess.mockRejectedValueOnce(new mocks.AccessError('forbidden', 403, 'no permission')),
          expectedStatus: 403,
        },
        {
          name: 'client-not-opted-in',
          setup: () => mocks.assertAccess.mockRejectedValueOnce(new mocks.AccessError('forbidden', 403, 'not opted in')),
          expectedStatus: 403,
        },
        {
          name: 'inactive-install',
          setup: () => mocks.assertAccess.mockRejectedValueOnce(new mocks.AccessError('extension_not_available', 404, 'not available')),
          expectedStatus: 404,
        },
        {
          name: 'undeclared-endpoint',
          setup: () => mocks.assertAccess.mockRejectedValueOnce(new mocks.AccessError('endpoint_not_found', 404, 'no endpoint')),
          expectedStatus: 404,
        },
        {
          name: 'rate-limited',
          setup: () => mocks.assertAccess.mockRejectedValueOnce(new mocks.AccessError('rate_limited', 429, 'slow down', 4)),
          expectedStatus: 429,
        },
        {
          name: 'audit-insert-failure',
          setup: () => mocks.startExtensionExecution.mockRejectedValueOnce(new Error('audit table unavailable')),
          expectedStatus: 503,
          expectedBody: { error: 'access_policy_unavailable' },
        },
      ];

      for (const scenario of scenarios) {
        mocks.getInstallConfig.mockClear();
        mocks.getRunnerBackend.mockClear();
        scenario.setup();

        const req = new Request(`http://localhost:3000/api/ext-proxy/${extensionId}/tickets`, {
          method: 'GET',
          headers: { 'x-request-id': 'req-deny' },
        });
        const response = await GET(req as any, { params: Promise.resolve({ extensionId, path: ['tickets'] }) });
        const body = await response.json().catch(() => ({}));

        expect(response.status, scenario.name).toBe(scenario.expectedStatus);
        if (scenario.expectedBody) {
          expect(body).toEqual(expect.objectContaining(scenario.expectedBody));
        }
        expect(mocks.getInstallConfig, scenario.name).not.toHaveBeenCalled();
        expect(mocks.getRunnerBackend, scenario.name).not.toHaveBeenCalled();

        if (scenario.name === 'rate-limited') {
          expect(response.headers.get('retry-after')).toBe('4');
        }
        if (scenario.name === 'audit-insert-failure') {
          expect(mocks.finishExtensionExecution).not.toHaveBeenCalled();
        }
      }
    });

    it('3. an install/version mismatch between authorization and hydration is rejected before dispatch', async () => {
      const { GET } = await import('../../../../../packages/product-ext-proxy/ee/handler');
      mocks.assertAccess.mockResolvedValue(accessFixture());
      mocks.getInstallConfig.mockResolvedValue(installConfigFixture({ installId: 'install-2', versionId: 'version-2' }));

      const req = new Request(`http://localhost:3000/api/ext-proxy/${extensionId}/tickets`, { method: 'GET' });
      const response = await GET(req as any, { params: Promise.resolve({ extensionId, path: ['tickets'] }) });

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'access_policy_unavailable' });
      expect(mocks.finishExtensionExecution).toHaveBeenCalledWith(
        'log-1',
        'tenant-1',
        expect.objectContaining({ outcome: 'policy_denied' }),
      );
      expect(mocks.getRunnerBackend).not.toHaveBeenCalled();
    });

    it('4. method override authorizes as the effective method and strips transport-only __method', async () => {
      const { POST } = await import('../../../../../packages/product-ext-proxy/ee/handler');
      mocks.assertAccess.mockResolvedValue(accessFixture({
        endpoint: { method: 'DELETE', path: '/tickets', handler: 'handlers.delete' },
      }));

      const req = new Request(`http://localhost:3000/api/ext-proxy/${extensionId}/tickets?__method=DELETE&limit=10`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ __method: 'DELETE', reason: 'cleanup' }),
      });
      const response = await POST(req as any, { params: Promise.resolve({ extensionId, path: ['tickets'] }) });

      expect(response.status).toBe(200);
      expect(mocks.assertAccess).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        extensionId,
        method: 'DELETE',
        path: '/tickets',
      });

      const execute = getBackendExecute();
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          http: expect.objectContaining({
            method: 'DELETE',
            path: '/tickets',
            query: { limit: '10' },
          }),
        }),
        expect.any(Object)
      );
      const executePayload = execute.mock.calls[0]?.[0] as { http?: { body_b64?: string } };
      const forwardedBodyRaw = executePayload.http?.body_b64
        ? Buffer.from(executePayload.http.body_b64, 'base64').toString('utf8')
        : '';
      expect(forwardedBodyRaw).toContain('"reason":"cleanup"');
      expect(forwardedBodyRaw).not.toContain('__method');
    });

    it('5. success, runner-error, timeout, empty/invalid runner responses finish the audit row with a terminal status and no secrets in audit data', async () => {
      const { GET } = await import('../../../../../packages/product-ext-proxy/ee/handler');
      const { RunnerRequestError } = mocks;

      // Establish a success start record, then assert its args never carry secrets/config.
      const seedReq = new Request(`http://localhost:3000/api/ext-proxy/${extensionId}/tickets`, { method: 'GET' });
      await GET(seedReq as any, { params: Promise.resolve({ extensionId, path: ['tickets'] }) });
      const startCall = mocks.startExtensionExecution.mock.calls[0][0];
      expect(startCall).not.toHaveProperty('config');
      expect(startCall).not.toHaveProperty('secretEnvelope');
      expect(startCall).not.toHaveProperty('providers');

      async function runWithBackendError(error: Error, expectedStatus: number, expectedOutcome: string) {
        mocks.getRunnerBackend.mockReturnValue({
          kind: 'docker',
          getPublicBase: () => null,
          execute: vi.fn().mockRejectedValue(error),
        } as any);
        mocks.finishExtensionExecution.mockClear();
        const req = new Request(`http://localhost:3000/api/ext-proxy/${extensionId}/error-path`, { method: 'GET' });
        const response = await GET(req as any, { params: Promise.resolve({ extensionId, path: ['error-path'] }) });
        expect(response.status).toBe(expectedStatus);
        expect(mocks.finishExtensionExecution).toHaveBeenCalledWith(
          'log-1',
          'tenant-1',
          expect.objectContaining({ outcome: expectedOutcome }),
        );
        const finishArgs = mocks.finishExtensionExecution.mock.calls[0][2] as Record<string, unknown>;
        expect(finishArgs).not.toHaveProperty('secretEnvelope');
        expect(finishArgs).not.toHaveProperty('config');
        expect(finishArgs).not.toHaveProperty('providers');
      }

      await runWithBackendError(new RunnerRequestError('Runner failed', 'docker', 502), 502, 'error');
      const timeoutError = new Error('aborted');
      timeoutError.name = 'AbortError';
      await runWithBackendError(timeoutError, 504, 'timeout');
      await runWithBackendError(new RunnerRequestError('Runner returned empty body', 'docker'), 502, 'error');
      await runWithBackendError(new RunnerRequestError('Runner returned invalid JSON', 'docker'), 502, 'error');
    });

    it('6. client success forwards the exact authorized client_id; missing client context denies before hydration', async () => {
      const { GET } = await import('../../../../../packages/product-ext-proxy/ee/handler');

      mocks.assertAccess.mockResolvedValue(accessFixture({
        principal: { kind: 'client', userId: 'client-user', clientId: 'client-42' },
      }));
      mocks.getUserInfoFromAuth.mockResolvedValue(userInfoFixture({
        user_id: 'client-user',
        user_type: 'client',
        client_id: 'client-42',
      }));

      const okReq = new Request(`http://localhost:3000/api/ext-proxy/${extensionId}/tickets`, { method: 'GET' });
      const okResponse = await GET(okReq as any, { params: Promise.resolve({ extensionId, path: ['tickets'] }) });
      expect(okResponse.status).toBe(200);
      const execute = getBackendExecute();
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          user: expect.objectContaining({ user_type: 'client', client_id: 'client-42' }),
        }),
        expect.any(Object)
      );

      // Missing/mismatched client context denies before install hydration.
      mocks.getInstallConfig.mockClear();
      mocks.getRunnerBackend.mockClear();
      mocks.getUserInfoFromAuth.mockResolvedValue(userInfoFixture({ user_type: 'internal' }));
      const badReq = new Request(`http://localhost:3000/api/ext-proxy/${extensionId}/tickets`, { method: 'GET' });
      const badResponse = await GET(badReq as any, { params: Promise.resolve({ extensionId, path: ['tickets'] }) });
      expect(badResponse.status).toBe(403);
      expect(await badResponse.json()).toEqual({ error: 'forbidden' });
      expect(mocks.getInstallConfig).not.toHaveBeenCalled();
      expect(mocks.getRunnerBackend).not.toHaveBeenCalled();
    });

    it('7. an extension-level 4xx/5xx from the runner is audited as upstream_error with the true status, not ok', async () => {
      const { GET } = await import('../../../../../packages/product-ext-proxy/ee/handler');

      mocks.getRunnerBackend.mockReturnValue({
        kind: 'docker',
        getPublicBase: () => null,
        execute: vi.fn().mockResolvedValue({
          status: 503,
          headers: { 'content-type': 'application/json' },
          body: Buffer.from('{"error":"ext temporarily unavailable"}'),
        }),
      } as any);
      mocks.finishExtensionExecution.mockClear();

      const req = new Request(`http://localhost:3000/api/ext-proxy/${extensionId}/tickets`, { method: 'GET' });
      const response = await GET(req as any, { params: Promise.resolve({ extensionId, path: ['tickets'] }) });

      // The HTTP response stays a pass-through as today; only the audit
      // classification changes from ok to upstream_error.
      expect(response.status).toBe(503);
      expect(mocks.finishExtensionExecution).toHaveBeenCalledWith(
        'log-1',
        'tenant-1',
        expect.objectContaining({ outcome: 'upstream_error', status: 503 }),
      );
      const finishArgs = mocks.finishExtensionExecution.mock.calls[0][2] as Record<string, unknown>;
      expect(finishArgs).not.toHaveProperty('secretEnvelope');
      expect(finishArgs).not.toHaveProperty('config');
    });

    it('8. a runner transport error returns a generic body with requestId only — no runner detail', async () => {
      const { GET } = await import('../../../../../packages/product-ext-proxy/ee/handler');
      const { RunnerRequestError } = mocks;

      mocks.getRunnerBackend.mockReturnValue({
        kind: 'docker',
        getPublicBase: () => null,
        execute: vi.fn().mockRejectedValue(
          new RunnerRequestError('Runner responded with non-success status 500: SECRET-STACK-TRACE', 'docker', 500)
        ),
      } as any);

      const req = new Request(`http://localhost:3000/api/ext-proxy/${extensionId}/tickets`, { method: 'GET' });
      const response = await GET(req as any, { params: Promise.resolve({ extensionId, path: ['tickets'] }) });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({ error: 'bad_gateway', requestId: expect.any(String) });
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('Runner');
      expect(serialized).not.toContain('SECRET-STACK-TRACE');
      expect(serialized).not.toContain('detail');
      expect(mocks.finishExtensionExecution).toHaveBeenCalledWith(
        'log-1',
        'tenant-1',
        expect.objectContaining({ outcome: 'error', status: 500 }),
      );
    });
  });
});
