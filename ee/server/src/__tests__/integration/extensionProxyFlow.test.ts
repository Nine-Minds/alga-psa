
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bootstrapIframe } from '../../lib/extensions/ui/iframeBridge';

// Mocks for the Gateway test
// We need to mock the dependencies of handler.ts
vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(),
}));
vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(),
}));
vi.mock('server/src/lib/extensions/gateway/auth', () => ({
  getTenantFromAuth: vi.fn(),
}));
vi.mock('../../../../../packages/product-ext-proxy/ee/install-config-cache', () => ({
  loadInstallConfigCached: vi.fn(),
}));
vi.mock('../../../../../packages/product-ext-proxy/ee/runner-backend', () => ({
  getRunnerBackend: vi.fn(),
  RunnerConfigError: class extends Error {},
  RunnerRequestError: class extends Error {},
}));

// We need to dynamically import the handler to apply mocks
// const { GET } = await import('../../../../../packages/product-ext-proxy/ee/handler');

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
    // We will implement this test to verify the second half of the chain
    // regardless of the first half failing.
    it('should forward request to RunnerBackend and propagate response headers/body', async () => {
      // Import dependencies
      const { GET } = await import('../../../../../packages/product-ext-proxy/ee/handler');
      const { getCurrentUser } = await import('@alga-psa/users/actions');
      const { hasPermission } = await import('server/src/lib/auth/rbac');
      const { getTenantFromAuth } = await import('server/src/lib/extensions/gateway/auth');
      const { loadInstallConfigCached } = await import('../../../../../packages/product-ext-proxy/ee/install-config-cache');
      const { getRunnerBackend } = await import('../../../../../packages/product-ext-proxy/ee/runner-backend');

      // Setup mocks
      const tenantId = 'tenant-1';
      const installId = 'install-1';
      vi.mocked(getTenantFromAuth).mockResolvedValue(tenantId);
      vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1', tenant: tenantId } as any);
      vi.mocked(hasPermission).mockResolvedValue(true);
      vi.mocked(loadInstallConfigCached).mockResolvedValue({
        installId,
        versionId: 'v1',
        contentHash: 'hash',
        config: {},
        providers: [],
      });

      const mockBody = Buffer.from('binary-response');
      const mockExecute = vi.fn().mockResolvedValue({
        status: 201,
        headers: { 'x-custom-header': 'value', 'content-type': 'application/json' },
        body: mockBody,
      });
      vi.mocked(getRunnerBackend).mockReturnValue({
        execute: mockExecute,
      } as any);

      // Construct Request
      const req = new Request(`http://localhost:3000/api/ext-proxy/${extensionId}/tickets?limit=10`, {
        method: 'GET',
        headers: { 'x-request-id': 'req-123' },
      });

      // Call Handler
      const params = { extensionId, path: ['tickets'] };
      const response = await GET(req as any, { params: Promise.resolve(params) });

      // Assertions
      expect(response.status).toBe(201);
      expect(response.headers.get('x-custom-header')).toBe('value');
      expect(response.headers.get('content-type')).toBe('application/json');
      
      // Verify body propagation
      const bodyText = await response.text();
      expect(bodyText).toBe('binary-response');

      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            extension_id: extensionId,
            tenant_id: tenantId,
          }),
          http: expect.objectContaining({
            path: '/tickets',
            method: 'GET',
          }),
        }),
        expect.any(Object)
      );
    });

    it('should handle Runner errors gracefully', async () => {
      const { GET } = await import('../../../../../packages/product-ext-proxy/ee/handler');
      const { getRunnerBackend, RunnerRequestError } = await import('../../../../../packages/product-ext-proxy/ee/runner-backend');
      const { getCurrentUser } = await import('@alga-psa/users/actions');
      const { hasPermission } = await import('server/src/lib/auth/rbac');
      const { getTenantFromAuth } = await import('server/src/lib/extensions/gateway/auth');
      const { loadInstallConfigCached } = await import('../../../../../packages/product-ext-proxy/ee/install-config-cache');

      // Setup Auth & Config Mocks
      const tenantId = 'tenant-1';
      const installId = 'install-1';
      vi.mocked(getTenantFromAuth).mockResolvedValue(tenantId);
      vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1', tenant: tenantId } as any);
      vi.mocked(hasPermission).mockResolvedValue(true);
      vi.mocked(loadInstallConfigCached).mockResolvedValue({
        installId,
        versionId: 'v1',
        contentHash: 'hash',
        config: {},
        providers: [],
      });
      
      // Mock Runner error
      const mockExecute = vi.fn().mockRejectedValue(new RunnerRequestError('Runner failed', 'docker', 502));
      vi.mocked(getRunnerBackend).mockReturnValue({
        execute: mockExecute,
      } as any);

      // Construct Request
      const req = new Request(`http://localhost:3000/api/ext-proxy/${extensionId}/error-path`, {
        method: 'GET',
      });

      // Call Handler
      const params = { extensionId, path: ['error-path'] };
      const response = await GET(req as any, { params: Promise.resolve(params) });

      expect(response.status).toBe(502); // Should reflect the error status or gateway error
      const json = await response.json();
      expect(json).toEqual(expect.objectContaining({ error: 'Runner error' }));
    });
  });
});
