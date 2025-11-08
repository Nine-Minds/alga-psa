import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const MODULE_PATH = '../../runner/backend';

const HASH_BODY = Buffer.from('ok').toString('base64');

function resetEnv() {
  delete process.env.RUNNER_BACKEND;
  delete process.env.RUNNER_BASE_URL;
  delete process.env.RUNNER_DOCKER_HOST;
  delete process.env.RUNNER_PUBLIC_BASE;
  delete process.env.RUNNER_SERVICE_TOKEN;
}

function mockFetch(response: Response | Promise<Response>) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function importBackendModule() {
  return await import(MODULE_PATH);
}

describe('runner/backend', () => {
  beforeEach(() => {
    vi.resetModules();
    resetEnv();
    process.env.RUNNER_BASE_URL = 'http://knative-runner:8080';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetEnv();
  });

  it('defaults to knative backend and calls execute endpoint', async () => {
    const fetchMock = mockFetch(
      new Response(
        JSON.stringify({ status: 201, headers: { 'content-type': 'text/plain' }, body_b64: HASH_BODY }),
        { status: 200 },
      ),
    );

    const { getRunnerBackend } = await importBackendModule();
    const backend = getRunnerBackend();
    expect(backend.kind).toBe('knative');

    const result = await backend.execute(
      {
        context: {},
        http: { method: 'GET', path: '/', query: {}, headers: {} },
        limits: { timeout_ms: 1000 },
      },
      { requestId: 'req-1', timeoutMs: 1000 },
    );

    expect(fetchMock).toHaveBeenCalledWith('http://knative-runner:8080/v1/execute', expect.objectContaining({
      method: 'POST',
    }));
    expect(result.status).toBe(201);
    expect(result.headers).toHaveProperty('content-type', 'text/plain');
    expect(result.body?.toString()).toBe('ok');
  });

  it('honours docker backend host override and service token', async () => {
    process.env.RUNNER_BACKEND = 'docker';
    process.env.RUNNER_DOCKER_HOST = 'http://docker-runner:9000';
    process.env.RUNNER_SERVICE_TOKEN = 'secret-token';

    const fetchMock = mockFetch(
      new Response(JSON.stringify({ status: 200, headers: {}, body_b64: HASH_BODY }), { status: 200 }),
    );

    const { getRunnerBackend } = await importBackendModule();
    const backend = getRunnerBackend();
    expect(backend.kind).toBe('docker');

    await backend.execute(
      {
        context: {},
        http: { method: 'POST', path: '/foo', query: {}, headers: {} },
        limits: { timeout_ms: 2000 },
      },
      { requestId: 'req-2', timeoutMs: 2000 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(fetchMock.mock.calls[0][0]).toBe('http://docker-runner:9000/v1/execute');
    expect(options?.headers).toMatchObject({
      'x-runner-service-token': 'secret-token',
    });
  });

  it('throws configuration error when base url missing', async () => {
    resetEnv();
    vi.resetModules();
    const { getRunnerBackend, RunnerConfigError } = await importBackendModule();
    expect(() => getRunnerBackend()).toThrow(RunnerConfigError);
  });

  it('filters hop-by-hop headers when proxying assets', async () => {
    process.env.RUNNER_BACKEND = 'docker';
    process.env.RUNNER_DOCKER_HOST = 'http://docker-runner:8080';

    const upstreamHeaders = new Headers({
      'content-type': 'text/html',
      connection: 'keep-alive',
    });
    const fetchMock = mockFetch(new Response('<html></html>', { status: 200, headers: upstreamHeaders }));

    const { getRunnerBackend } = await importBackendModule();
    const backend = getRunnerBackend();

    const requestHeaders = new Headers({
      Connection: 'keep-alive',
      Accept: 'text/html',
    });

    const resp = await backend.fetchStaticAsset({
      path: 'ext-ui/ext-1/foo',
      search: '?a=1',
      method: 'GET',
      headers: requestHeaders,
    });

    expect(fetchMock).toHaveBeenCalledWith('http://docker-runner:8080/ext-ui/ext-1/foo?a=1', expect.objectContaining({
      method: 'GET',
    }));
    const forwarded = fetchMock.mock.calls[0][1]?.headers as HeadersInit;
    if (forwarded instanceof Headers) {
      expect(forwarded.has('connection')).toBe(false);
      expect(forwarded.get('accept')).toBe('text/html');
    } else {
      const normalized = forwarded as Record<string, string>;
      expect(Object.keys(normalized)).not.toContain('connection');
      expect(normalized).toHaveProperty('accept', 'text/html');
    }
    expect(resp.status).toBe(200);
  });
});
