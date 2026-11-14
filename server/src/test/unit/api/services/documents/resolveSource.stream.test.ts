import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/storage/config/storage', () => ({
  getStorageConfig: async () => ({ defaultProvider: 'local', providers: { local: { maxFileSize: 500 * 1024 * 1024 } } }),
}));
vi.mock('server/src/lib/api/services/documents/fetchHostSettings', () => ({
  loadEffectiveFetchHosts: async () => ['files.example.com'],
}));

import { Readable } from 'node:stream';
import { PayloadTooLargeError, ValidationError } from 'server/src/lib/api/middleware/apiErrors';
import { UrlFetchError } from 'server/src/lib/net/safeFetch';
import {
  MAX_BASE64_SOURCE_BYTES,
  base64EncodedLength,
  mapFetchError,
  resolveSource,
} from 'server/src/lib/api/services/documents/resolveSource';

const tenantCtx = { knex: {} as any, tenant: 'tenant-1' };
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

/** A fake `fetch` dep: 200 with the given body chunks; the body errors when the request is aborted. */
function fetchDep(chunks: Uint8Array[], opts: { hang?: boolean; neverResolve?: boolean; headers?: Record<string, string> } = {}) {
  return vi.fn(async (_url: string, init: { signal: AbortSignal }) => {
    if (opts.neverResolve) {
      return new Promise<Response>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        init.signal.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
      },
      pull(controller) {
        if (i < chunks.length) {
          controller.enqueue(chunks[i++]!);
        } else if (!opts.hang) {
          controller.close();
        }
        // hang: never close, never enqueue
      },
    });
    return new Response(body, { status: 200, headers: opts.headers });
  });
}

async function drain(stream: Readable): Promise<number> {
  let total = 0;
  for await (const chunk of stream) total += (chunk as Buffer).length;
  return total;
}

afterEach(() => vi.restoreAllMocks());

describe('resolveSource: base64', () => {
  it('rejects a body over its named cap with a 413 that points at the large-file routes, before decoding', async () => {
    const fromSpy = vi.spyOn(Buffer, 'from');
    const encodedOver = 'A'.repeat(base64EncodedLength(MAX_BASE64_SOURCE_BYTES) + 4096);
    const error = await resolveSource(
      { source: { type: 'base64', content: encodedOver }, fileName: 'big.bin' },
    ).catch((e) => e);

    expect(error).toBeInstanceOf(PayloadTooLargeError);
    expect(error.statusCode).toBe(413);
    expect(error.message).toMatch(/url source/);
    expect(error.message).toMatch(/\/api\/documents\/uploads/);
    expect((fromSpy.mock.calls as unknown[][]).some(([, encoding]) => encoding === 'base64')).toBe(false);
  });

  it('is clamped to the provider max when that is lower than the named cap', async () => {
    const error = await resolveSource(
      { source: { type: 'base64', content: 'AAAA'.repeat(100) }, fileName: 'a.bin' },
      { maxBytes: 100 },
    ).catch((e) => e);
    expect(error).toBeInstanceOf(PayloadTooLargeError);
  });

  it('still decodes a body under the cap', async () => {
    const file = await resolveSource({
      source: { type: 'base64', content: Buffer.from('hello').toString('base64') },
      fileName: 'a.txt',
    });
    expect(Buffer.isBuffer(file.body) && file.body.toString()).toBe('hello');
    expect(file.mimeType).toBe('text/plain');
  });
});

describe('resolveSource: base64 exact cap', () => {
  const b64 = (n: number) => Buffer.alloc(n, 1).toString('base64');

  it('accepts exactly the cap and 413s one decoded byte over it, though both encode to the same length', async () => {
    const ok = await resolveSource({ source: { type: 'base64', content: b64(10) }, fileName: 'a.bin' }, { maxBytes: 10 });
    expect((ok.body as Buffer).length).toBe(10);
    // 11 bytes encode to 16 chars, the same as 10 or 12: only the decoded size tells them apart.
    const error = await resolveSource({ source: { type: 'base64', content: b64(11) }, fileName: 'a.bin' }, { maxBytes: 10 }).catch((e) => e);
    expect(error).toBeInstanceOf(PayloadTooLargeError);
  });
});

describe('resolveSource: url (streaming)', () => {
  const url = 'https://files.example.com/video.mp4';

  it('returns the response as a stream, not a buffer', async () => {
    const file = await resolveSource(
      { source: { type: 'url', url } },
      { maxBytes: 1024, fetchDeps: { lookup: publicLookup, fetch: fetchDep([new Uint8Array(10), new Uint8Array(20)], { headers: { 'content-type': 'video/mp4' } }) as any } },
      tenantCtx,
    );
    expect(file.body).toBeInstanceOf(Readable);
    expect(file.fileName).toBe('video.mp4');
    expect(file.mimeType).toBe('video/mp4');
    expect(await drain(file.body as Readable)).toBe(30);
  });

  it('aborts the transfer once the byte cap is exceeded, even without a Content-Length', async () => {
    const file = await resolveSource(
      { source: { type: 'url', url } },
      { maxBytes: 50, fetchDeps: { lookup: publicLookup, fetch: fetchDep([new Uint8Array(30), new Uint8Array(30), new Uint8Array(30)]) as any } },
      tenantCtx,
    );
    const error = await drain(file.body as Readable).catch((e) => e);
    expect(error).toBeInstanceOf(UrlFetchError);
    expect(error.reason).toBe('too_large');
    expect(mapFetchError(error, 'tenant-1', 50)).toBeInstanceOf(PayloadTooLargeError);
  });

  it('refuses on a declared Content-Length over the cap without reading the body', async () => {
    const error = await resolveSource(
      { source: { type: 'url', url } },
      { maxBytes: 50, fetchDeps: { lookup: publicLookup, fetch: fetchDep([new Uint8Array(10)], { headers: { 'content-length': '5000' } }) as any } },
      tenantCtx,
    ).catch((e) => e);
    expect(error).toBeInstanceOf(PayloadTooLargeError);
  });

  it('fires the total timeout while the body is still streaming', async () => {
    const file = await resolveSource(
      { source: { type: 'url', url } },
      {
        maxBytes: 1024,
        urlTimeouts: { totalTimeoutMs: 50 },
        fetchDeps: { lookup: publicLookup, fetch: fetchDep([new Uint8Array(10)], { hang: true }) as any },
      },
      tenantCtx,
    );
    const error = await drain(file.body as Readable).catch((e) => e);
    expect(error).toBeInstanceOf(UrlFetchError);
    expect(error.reason).toBe('timeout');
    expect(mapFetchError(error, 'tenant-1', 1024)).toBeInstanceOf(ValidationError);
  });

  it('fires the connect timeout when no response arrives', async () => {
    const error = await resolveSource(
      { source: { type: 'url', url } },
      {
        maxBytes: 1024,
        urlTimeouts: { connectTimeoutMs: 30, totalTimeoutMs: 5000 },
        fetchDeps: { lookup: publicLookup, fetch: fetchDep([], { neverResolve: true }) as any },
      },
      tenantCtx,
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect(JSON.stringify(error.details)).toMatch(/Timed out/);
  });

  it('keeps the host allowlist: a host not on the tenant list is refused before any fetch', async () => {
    const fetchSpy = fetchDep([]);
    const error = await resolveSource(
      { source: { type: 'url', url: 'https://evil.example.org/a.bin' } },
      { maxBytes: 1024, fetchDeps: { lookup: publicLookup, fetch: fetchSpy as any } },
      tenantCtx,
    ).catch((e) => e);
    expect(error.code).toBe('FETCH_HOST_NOT_ALLOWED');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
