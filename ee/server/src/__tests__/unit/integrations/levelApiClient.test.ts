import { describe, expect, it, vi } from 'vitest';
import {
  LevelIoApiClient,
  LevelIoApiError,
} from '../../../lib/integrations/levelio/levelApiClient';

function jsonResponse(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
}

describe('LevelIoApiClient', () => {
  it('sends the API key in the Authorization header and device include flags', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [], has_more: false }));
    const client = new LevelIoApiClient({ apiKey: 'lvl-key', fetchImpl: fetchMock as unknown as typeof fetch });

    await client.listDevices();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('https://api.level.io/v2/devices');
    expect(url).toContain('include_operating_system=true');
    expect(url).toContain('include_security=true');
    expect(url).toContain('limit=100');
    expect((options.headers as Record<string, string>).Authorization).toBe('lvl-key');
  });

  it('paginates with starting_after until has_more is false', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'dev-1' }, { id: 'dev-2' }], has_more: true }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'dev-3' }], has_more: false }));
    const client = new LevelIoApiClient({ apiKey: 'lvl-key', fetchImpl: fetchMock as unknown as typeof fetch });

    const devices = await client.listDevices();

    expect(devices.map((d) => d.id)).toEqual(['dev-1', 'dev-2', 'dev-3']);
    const secondUrl = String(fetchMock.mock.calls[1][0]);
    expect(secondUrl).toContain('starting_after=dev-2');
  });

  it('throws an actionable error on 401', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'unauthorized' }, { status: 401 }));
    const client = new LevelIoApiClient({ apiKey: 'bad-key', fetchImpl: fetchMock as unknown as typeof fetch });

    await expect(client.testConnection()).rejects.toThrow(/API key/);
    await expect(client.testConnection()).rejects.toBeInstanceOf(LevelIoApiError);
  });

  it('retries once on 429 honoring Retry-After', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'g-1', name: 'Group 1' }], has_more: false }));
    const client = new LevelIoApiClient({ apiKey: 'lvl-key', fetchImpl: fetchMock as unknown as typeof fetch });

    const groups = await client.listGroups();

    expect(groups).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws on non-JSON responses', async () => {
    const fetchMock = vi.fn(async () => new Response('<html>login</html>', { status: 200 }));
    const client = new LevelIoApiClient({ apiKey: 'lvl-key', fetchImpl: fetchMock as unknown as typeof fetch });

    await expect(client.listGroups()).rejects.toThrow(/non-JSON/);
  });
});
