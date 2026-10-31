import { describe, expect, it, vi } from 'vitest';
import {
  FetchHostNotAllowedError,
  UnsafeUrlError,
  createHostPolicy,
  hostMatchesPattern,
  UrlFetchError,
  createPinnedLookup,
  isBlockedAddress,
  safeFetch,
  type ResolvedAddress,
} from '../safeFetch';

const PUBLIC: ResolvedAddress = { address: '93.184.216.34', family: 4 };
const lookupPublic = async () => [PUBLIC];

function bodyResponse(chunks: Uint8Array[], init: ResponseInit = {}): Response {
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]!);
      else controller.close();
    },
  });
  return new Response(stream, { status: 200, ...init });
}

const okFetch = (body = 'hello') =>
  vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } }));

const opts = { maxBytes: 1024 };

describe('safeFetch URL policy', () => {
  it.each([
    ['http scheme', 'http://example.com/a.pdf'],
    ['localhost', 'https://localhost/a'],
    ['sub.localhost', 'https://api.localhost/a'],
    ['127.0.0.1', 'https://127.0.0.1/a'],
    ['cloud metadata', 'https://169.254.169.254/latest/meta-data'],
    ['10.x', 'https://10.1.2.3/a'],
    ['[::1]', 'https://[::1]/a'],
    ['::ffff:127.0.0.1', 'https://[::ffff:127.0.0.1]/a'],
    ['::ffff:7f00:1 (hex form)', 'https://[::ffff:7f00:1]/a'],
    ['fc00::1', 'https://[fc00::1]/a'],
    ['decimal-encoded loopback', 'https://2130706433/a'],
    ['userinfo', 'https://user:pw@example.com/a'],
    ['non-default port', 'https://example.com:8443/a'],
    ['non-url', 'not a url'],
  ])('rejects %s without fetching', async (_label, url) => {
    const fetch = okFetch();
    await expect(safeFetch(url, opts, { lookup: lookupPublic, fetch })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts an explicit :443', async () => {
    const res = await safeFetch('https://example.com:443/a', opts, { lookup: lookupPublic, fetch: okFetch() });
    expect(res.bytes.toString()).toBe('hello');
  });

  it('rejects a hostname resolving to public and private addresses at once', async () => {
    const fetch = okFetch();
    const lookup = async () => [PUBLIC, { address: '10.0.0.5', family: 4 }];
    await expect(safeFetch('https://mixed.example.com/a', opts, { lookup, fetch })).rejects.toThrow(
      /private or reserved/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed when DNS resolution fails', async () => {
    const lookup = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(safeFetch('https://nope.example.com/a', opts, { lookup, fetch: okFetch() })).rejects.toMatchObject({
      name: 'UrlFetchError',
      reason: 'network',
    });
  });

  it('never leaks the URL path or query in error messages', async () => {
    const secret = 'https://127.0.0.1/files/SECRET-TOKEN?sig=SECRET-SIG';
    const err = await safeFetch(secret, opts, { lookup: lookupPublic, fetch: okFetch() }).catch((e) => e);
    expect(String(err.message)).not.toMatch(/SECRET/);
    const failing = vi.fn(async () => new Response('no', { status: 403 }));
    const err2 = await safeFetch('https://example.com/p/SECRET-TOKEN?sig=SECRET-SIG', opts, {
      lookup: lookupPublic,
      fetch: failing,
    }).catch((e) => e);
    expect(String(err2.message)).not.toMatch(/SECRET/);
  });
});

describe('isBlockedAddress', () => {
  it.each([
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.0.0.1', '192.0.2.1', '192.168.1.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1',
    '240.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1',
    '64:ff9b::1', '2001:db8::1', '::ffff:10.0.0.1', '::ffff:a00:1', '::127.0.0.1',
  ])('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:2800:220:1:248:1893:25c8:1946', '::ffff:8.8.8.8'])(
    'allows %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );
});

describe('safeFetch pinning', () => {
  it('connects to the vetted address even if a second lookup would return another IP', async () => {
    let calls = 0;
    const lookup = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? [PUBLIC] : [{ address: '127.0.0.1', family: 4 }];
    });
    const fetch = vi.fn(async (_u: string, _i: unknown, _pin: ResolvedAddress) => new Response('ok'));
    await safeFetch('https://rebind.example.com/a', opts, { lookup, fetch });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![2]).toEqual(PUBLIC);
    // The URL (hence SNI / cert check) keeps the hostname, not the IP.
    expect(fetch.mock.calls[0]![0]).toBe('https://rebind.example.com/a');
  });

  it('pinned lookup answers only with the vetted address (both callback shapes)', () => {
    const lookup = createPinnedLookup(PUBLIC);
    const single = vi.fn();
    lookup('anything.example.com', {}, single);
    expect(single).toHaveBeenCalledWith(null, PUBLIC.address, 4);
    const all = vi.fn();
    lookup('anything.example.com', { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [{ address: PUBLIC.address, family: 4 }]);
  });

  it('sends only a minimal GET without cookies or auth', async () => {
    const fetch = vi.fn(async (_u: string, _i: any, _pin: ResolvedAddress) => new Response('ok'));
    await safeFetch('https://example.com/a', opts, { lookup: lookupPublic, fetch });
    const init = fetch.mock.calls[0]![1];
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('manual');
    expect(Object.keys(init.headers).map((h: string) => h.toLowerCase())).not.toContain('cookie');
    expect(Object.keys(init.headers).map((h: string) => h.toLowerCase())).not.toContain('authorization');
  });
});

describe('safeFetch redirects', () => {
  const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });

  it('follows a redirect and re-validates the next hop', async () => {
    const lookup = vi.fn(lookupPublic);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(redirect('https://cdn.example.com/real.pdf'))
      .mockResolvedValueOnce(new Response('bytes'));
    const res = await safeFetch('https://example.com/a', opts, { lookup, fetch });
    expect(res.bytes.toString()).toBe('bytes');
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('resolves relative redirects against the current URL', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(redirect('/other')).mockResolvedValueOnce(new Response('x'));
    await safeFetch('https://example.com/a', opts, { lookup: lookupPublic, fetch });
    expect(fetch.mock.calls[1]![0]).toBe('https://example.com/other');
  });

  it('rejects a redirect to a private host', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(redirect('https://169.254.169.254/latest'));
    await expect(safeFetch('https://example.com/a', opts, { lookup: lookupPublic, fetch })).rejects.toBeInstanceOf(
      UnsafeUrlError,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a redirect whose hostname resolves privately', async () => {
    const lookup = vi.fn(async (host: string) =>
      host === 'internal.example.com' ? [{ address: '10.0.0.9', family: 4 }] : [PUBLIC],
    );
    const fetch = vi.fn().mockResolvedValueOnce(redirect('https://internal.example.com/x'));
    await expect(safeFetch('https://example.com/a', opts, { lookup, fetch })).rejects.toThrow(/private or reserved/);
  });

  it('rejects more than 3 redirects', async () => {
    const fetch = vi.fn(async () => redirect('https://example.com/loop'));
    await expect(safeFetch('https://example.com/a', opts, { lookup: lookupPublic, fetch })).rejects.toMatchObject({
      reason: 'too_many_redirects',
    });
    expect(fetch).toHaveBeenCalledTimes(4); // initial + 3 followed
  });

  it('allows exactly 3 redirects', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(redirect('https://example.com/1'))
      .mockResolvedValueOnce(redirect('https://example.com/2'))
      .mockResolvedValueOnce(redirect('https://example.com/3'))
      .mockResolvedValueOnce(new Response('done'));
    const res = await safeFetch('https://example.com/a', opts, { lookup: lookupPublic, fetch });
    expect(res.bytes.toString()).toBe('done');
  });

  it('rejects an https -> http downgrade', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(redirect('http://example.com/a'));
    await expect(safeFetch('https://example.com/a', opts, { lookup: lookupPublic, fetch })).rejects.toThrow(
      /downgrade/,
    );
  });

  it('rejects a redirect without Location', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302 }));
    await expect(safeFetch('https://example.com/a', opts, { lookup: lookupPublic, fetch })).rejects.toMatchObject({
      reason: 'bad_redirect',
    });
  });
});

describe('safeFetch limits and status', () => {
  it('reports a non-2xx upstream status as UrlFetchError carrying that status', async () => {
    const fetch = vi.fn(async () => new Response('denied', { status: 403 }));
    const err = await safeFetch('https://example.com/a', opts, { lookup: lookupPublic, fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(UrlFetchError);
    expect(err.reason).toBe('status');
    expect(err.upstreamStatus).toBe(403);
    expect(err.message).toMatch(/403/);
  });

  it('rejects an oversize body using Content-Length without reading it', async () => {
    const fetch = vi.fn(async () => new Response('x', { status: 200, headers: { 'content-length': '5000' } }));
    await expect(safeFetch('https://example.com/a', opts, { lookup: lookupPublic, fetch })).rejects.toMatchObject({
      reason: 'too_large',
    });
  });

  it('rejects an oversize body with no Content-Length while streaming', async () => {
    const chunk = new Uint8Array(400);
    const pulled = vi.fn();
    const fetch = vi.fn(async () => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled();
          controller.enqueue(chunk);
        },
      });
      return new Response(stream, { status: 200 });
    });
    await expect(safeFetch('https://example.com/a', opts, { lookup: lookupPublic, fetch })).rejects.toMatchObject({
      reason: 'too_large',
    });
    expect(pulled.mock.calls.length).toBeLessThan(10); // aborted, not drained forever
  });

  it('rejects a body that exceeds the cap despite a lying Content-Length', async () => {
    const fetch = vi.fn(async () =>
      bodyResponse([new Uint8Array(700), new Uint8Array(700)], { headers: { 'content-length': '10' } }),
    );
    await expect(safeFetch('https://example.com/a', opts, { lookup: lookupPublic, fetch })).rejects.toMatchObject({
      reason: 'too_large',
    });
  });

  it('accepts a body exactly at the cap', async () => {
    const fetch = vi.fn(async () => bodyResponse([new Uint8Array(1024)]));
    const res = await safeFetch('https://example.com/a', opts, { lookup: lookupPublic, fetch });
    expect(res.bytes.length).toBe(1024);
  });

  it('times out when headers never arrive', async () => {
    const fetch = vi.fn(
      (_u: string, init: { signal: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    await expect(
      safeFetch('https://example.com/a', { ...opts, connectTimeoutMs: 20, totalTimeoutMs: 1000 }, { lookup: lookupPublic, fetch }),
    ).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('times out when the body stalls past the total budget', async () => {
    const fetch = vi.fn(async (_u: string, init: { signal: AbortSignal }) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal.addEventListener('abort', () => controller.error(new Error('aborted')));
        },
      });
      return new Response(stream, { status: 200 });
    });
    await expect(
      safeFetch('https://example.com/a', { ...opts, connectTimeoutMs: 1000, totalTimeoutMs: 30 }, { lookup: lookupPublic, fetch }),
    ).rejects.toMatchObject({ reason: 'timeout' });
  });
});

describe('safeFetch host policy', () => {
  const allow = createHostPolicy(['files.oaiusercontent.com', '*.files.acme.com']);

  it('refuses a host outside the policy with zero lookup calls and zero fetches', async () => {
    const lookup = vi.fn(lookupPublic);
    const fetch = okFetch();
    const err = await safeFetch('https://evil.example.net/x?sig=SECRET', { ...opts, hostPolicy: allow }, { lookup, fetch }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(FetchHostNotAllowedError);
    expect(err.hostname).toBe('evil.example.net');
    expect(err.message).not.toContain('SECRET');
    expect(lookup).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches an allowed host', async () => {
    const res = await safeFetch('https://files.oaiusercontent.com/a.pdf', { ...opts, hostPolicy: allow }, {
      lookup: lookupPublic,
      fetch: okFetch(),
    });
    expect(res.bytes.toString()).toBe('hello');
  });

  it('rejects an allowed host that redirects to a host outside the policy, before looking it up', async () => {
    const lookup = vi.fn(lookupPublic);
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://attacker.example.net/c?d=1' } }));
    const err = await safeFetch('https://files.oaiusercontent.com/a', { ...opts, hostPolicy: allow }, { lookup, fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(FetchHostNotAllowedError);
    expect(err.viaRedirect).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1); // only the first, allowed hop
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('follows a redirect between two allowed hosts', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://a.files.acme.com/z' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const res = await safeFetch('https://files.oaiusercontent.com/a', { ...opts, hostPolicy: allow }, { lookup: lookupPublic, fetch });
    expect(res.bytes.toString()).toBe('ok');
  });

  it('still rejects an allowed host that resolves to a private address', async () => {
    const fetch = okFetch();
    const lookup = async () => [{ address: '10.0.0.7', family: 4 }];
    await expect(
      safeFetch('https://files.oaiusercontent.com/a', { ...opts, hostPolicy: allow }, { lookup, fetch }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('still enforces https-only and the IP literal rules when a policy is present', async () => {
    const policy = createHostPolicy(['files.oaiusercontent.com']);
    const fetch = okFetch();
    await expect(
      safeFetch('http://files.oaiusercontent.com/a', { ...opts, hostPolicy: policy }, { lookup: lookupPublic, fetch }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(
      safeFetch('https://127.0.0.1/a', { ...opts, hostPolicy: () => true }, { lookup: lookupPublic, fetch }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('matches wildcards on one or more labels, never the base and never a look-alike', () => {
    expect(hostMatchesPattern('a.files.acme.com', '*.files.acme.com')).toBe(true);
    expect(hostMatchesPattern('a.b.files.acme.com', '*.files.acme.com')).toBe(true);
    expect(hostMatchesPattern('files.acme.com', '*.files.acme.com')).toBe(false);
    expect(hostMatchesPattern('evilfiles.acme.com', '*.files.acme.com')).toBe(false);
    expect(hostMatchesPattern('x.files.acme.com.evil.net', '*.files.acme.com')).toBe(false);
  });

  it('exact entries match only themselves', () => {
    expect(hostMatchesPattern('files.acme.com', 'files.acme.com')).toBe(true);
    expect(hostMatchesPattern('a.files.acme.com', 'files.acme.com')).toBe(false);
    expect(hostMatchesPattern('files.acme.com.evil.net', 'files.acme.com')).toBe(false);
  });

  it('normalises case, trailing dot and IDNA on both sides', () => {
    expect(hostMatchesPattern('FILES.Acme.COM', 'files.acme.com')).toBe(true);
    expect(hostMatchesPattern('files.acme.com.', 'files.acme.com')).toBe(true);
    expect(hostMatchesPattern('xn--bcher-kva.example', 'bücher.example')).toBe(true);
    expect(hostMatchesPattern('bücher.example', 'xn--bcher-kva.example')).toBe(true);
    expect(hostMatchesPattern('a.xn--bcher-kva.example', '*.bücher.example')).toBe(true);
  });

  it('applies the policy to mixed-case and IDNA URLs through safeFetch', async () => {
    const policy = createHostPolicy(['bücher.example']);
    const res = await safeFetch('https://BÜCHER.example/a', { ...opts, hostPolicy: policy }, {
      lookup: lookupPublic,
      fetch: okFetch(),
    });
    expect(res.bytes.toString()).toBe('hello');
  });
});
