import { afterEach, expect, it, vi } from 'vitest';
import { ApiTestClient } from '../e2e/utils/apiTestHelpers';

afterEach(() => vi.unstubAllGlobals());

it.each([
  { 'x-tenant-id': 'tenant-test' },
  new Headers({ 'x-tenant-id': 'tenant-test' }),
  [['x-tenant-id', 'tenant-test']],
] .map((headers) => ({ headers: headers as HeadersInit })))('preserves authentication and JSON headers with custom request headers %#', async ({ headers }) => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { success: true } }), {
    status: 202, headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  const controller = new AbortController();
  const client = new ApiTestClient({ baseUrl: 'https://application.test', apiKey: 'synthetic-test-key', headers: { 'x-fixture': 'retained' } });
  const result = await client.post('/api/v1/extensions/install', { registryId: 'registry', version: '1.0.0' }, { headers, signal: controller.signal });
  const [url, request] = fetchMock.mock.calls[0];
  const sent = new Headers(request.headers);
  expect(url).toBe('https://application.test/api/v1/extensions/install');
  expect(sent.get('x-api-key')).toBe('synthetic-test-key');
  expect(sent.get('x-tenant-id')).toBe('tenant-test');
  expect(sent.get('content-type')).toBe('application/json');
  expect(sent.get('x-fixture')).toBe('retained');
  expect(request.signal).toBe(controller.signal);
  expect(JSON.parse(request.body)).toEqual({ registryId: 'registry', version: '1.0.0' });
  expect(result).toMatchObject({ status: 202, ok: true, data: { data: { success: true } } });
});
