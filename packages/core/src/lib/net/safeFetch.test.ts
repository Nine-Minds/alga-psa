import { describe, expect, it, vi } from 'vitest';
import {
  UnsafeUrlError,
  assertPublicUrl,
  fetchPublicBytes,
  isPublicAddress,
  type SafeRequestFn,
  type SafeResponse,
} from './safeFetch';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function response(over: Partial<SafeResponse> & { chunks?: Buffer[] } = {}): SafeResponse {
  const chunks = over.chunks ?? [PNG];
  return {
    status: 200,
    headers: { 'content-type': 'image/png' },
    body: (async function* () {
      for (const c of chunks) yield c;
    })(),
    destroy: () => undefined,
    ...over,
  };
}

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

describe('isPublicAddress / literal address table', () => {
  const blocked = [
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '255.255.255.255',
    '224.0.0.1',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '::ffff:10.0.0.1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::1',
    'not-an-ip',
  ];
  it.each(blocked)('%s is not public', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each(['8.8.8.8', '93.184.216.34', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    '%s is public',
    (ip) => {
      expect(isPublicAddress(ip)).toBe(true);
    }
  );

  it.each([...blocked.filter((b) => b !== 'not-an-ip'), '2130706433'])(
    'fetch of http://%s/ is refused before any connect',
    async (ip) => {
      const request = vi.fn();
      const host = ip.includes(':') ? `[${ip}]` : ip;
      await expect(fetchPublicBytes(`http://${host}/x.png`, { request })).rejects.toBeInstanceOf(UnsafeUrlError);
      expect(request).not.toHaveBeenCalled();
    }
  );

  it('rejects non-http schemes and embedded credentials', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertPublicUrl('ftp://example.com/x')).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(
      assertPublicUrl('http://user:pw@example.com/x', { lookup: publicLookup })
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});

describe('fetchPublicBytes', () => {
  it('fetches a hostname that resolves to a public address', async () => {
    const request = vi.fn<SafeRequestFn>(async () => response());
    const result = await fetchPublicBytes('https://img.example.com/a.png', { lookup: publicLookup, request });
    expect(result.bytes.equals(PNG)).toBe(true);
    expect(result.contentType).toBe('image/png');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].address).toBe('93.184.216.34');
  });

  it('refuses a hostname with mixed public and private answers', async () => {
    const request = vi.fn();
    const lookup = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ];
    await expect(fetchPublicBytes('https://mixed.example.com/a.png', { lookup, request })).rejects.toBeInstanceOf(
      UnsafeUrlError
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses localhost-style names resolving to loopback', async () => {
    const request = vi.fn();
    const lookup = async () => [{ address: '127.0.0.1', family: 4 }];
    await expect(fetchPublicBytes('http://localhost/a.png', { lookup, request })).rejects.toBeInstanceOf(
      UnsafeUrlError
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses a redirect from a public URL to 127.0.0.1 before connecting to it', async () => {
    const request = vi.fn<SafeRequestFn>(async () =>
      response({ status: 302, headers: { location: 'http://127.0.0.1:8080/secret' } })
    );
    await expect(
      fetchPublicBytes('https://img.example.com/a.png', { lookup: publicLookup, request })
    ).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.every(([r]) => r.url.hostname !== '127.0.0.1')).toBe(true);
  });

  it('validates a redirect to a hostname that resolves privately', async () => {
    const lookup = vi.fn(async (host: string) =>
      host === 'internal.example.com'
        ? [{ address: '192.168.0.9', family: 4 }]
        : [{ address: '93.184.216.34', family: 4 }]
    );
    const request = vi.fn<SafeRequestFn>(async () =>
      response({ status: 301, headers: { location: 'https://internal.example.com/x' } })
    );
    await expect(fetchPublicBytes('https://img.example.com/a.png', { lookup, request })).rejects.toBeInstanceOf(
      UnsafeUrlError
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('follows a public redirect and stops after 3 redirects', async () => {
    let n = 0;
    const request = vi.fn<SafeRequestFn>(async () =>
      response({ status: 302, headers: { location: `/hop${++n}` } })
    );
    await expect(
      fetchPublicBytes('https://img.example.com/a.png', { lookup: publicLookup, request })
    ).rejects.toThrow(/redirect/i);
    expect(request).toHaveBeenCalledTimes(4);

    const ok = vi
      .fn<SafeRequestFn>()
      .mockResolvedValueOnce(response({ status: 302, headers: { location: '/b.png' } }))
      .mockResolvedValueOnce(response());
    const result = await fetchPublicBytes('https://img.example.com/a.png', { lookup: publicLookup, request: ok });
    expect(result.finalUrl).toBe('https://img.example.com/b.png');
  });

  it('aborts a body over maxBytes', async () => {
    const destroy = vi.fn();
    const request: SafeRequestFn = async () =>
      response({ chunks: [Buffer.alloc(600), Buffer.alloc(600)], destroy });
    await expect(
      fetchPublicBytes('https://img.example.com/a.png', { lookup: publicLookup, request, maxBytes: 1000 })
    ).rejects.toThrow(/exceeds/);
    expect(destroy).toHaveBeenCalled();
  });

  it('refuses text/html for inlining', async () => {
    const request: SafeRequestFn = async () => response({ headers: { 'content-type': 'text/html; charset=utf-8' } });
    await expect(
      fetchPublicBytes('https://img.example.com/a.png', { lookup: publicLookup, request })
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('pins the connection: a second DNS answer is never used (rebinding)', async () => {
    const lookup = vi
      .fn<(h: string) => Promise<{ address: string; family: number }[]>>()
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    const request = vi.fn<SafeRequestFn>(async () => response());
    await fetchPublicBytes('https://rebind.example.com/a.png', { lookup, request });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0].address).toBe('93.184.216.34');
  });
});
