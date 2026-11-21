import { describe, expect, it, vi } from 'vitest';
import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  RETRY_WINDOW_MS,
  UploadSessionClientError,
  reasonForApiError,
  uploadFileInSession,
  type UploadFailureReason,
} from './uploadSessionClient';

const MIB = 1024 * 1024;
const CHUNK = 8 * MIB;
const SESSION_URL = '/api/documents/uploads/sess-1';

const fileOf = (size: number, name = 'movie.mp4') => {
  const file = new File(['x'], name, { type: 'video/mp4' });
  Object.defineProperty(file, 'size', { value: size });
  // Only slice bounds matter to the fake server, not the bytes.
  Object.defineProperty(file, 'slice', { value: (start: number, end: number) => ({ start, end }) });
  return file;
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const apiError = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  json(status, { error: { code, message: code, ...extra } });

/**
 * A fake server that owns the committed offset. `script` can intercept a request first (to fail it,
 * or to commit bytes and then drop the response).
 */
function fakeServer(options: {
  chunkSize?: number;
  create?: () => Response;
  intercept?: (call: { method: string; url: string; init: RequestInit }, server: { committed: number }) => Response | Promise<Response> | undefined;
} = {}) {
  const state = { committed: 0 };
  const calls: Array<{ method: string; url: string; range?: string }> = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ method, url, range: headers['Content-Range'] });
    const intercepted = options.intercept?.({ method, url, init }, state);
    if (intercepted) return intercepted;
    if (method === 'POST' && url === '/api/documents/uploads') {
      return options.create?.() ?? json(201, { sessionId: 'sess-1', chunkSize: options.chunkSize ?? CHUNK, maxFileSize: 5 * 1024 * MIB, expiresAt: 'later' });
    }
    if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'Upload-Offset': String(state.committed) } });
    if (method === 'PUT') {
      const [, start, end] = /bytes (\d+)-(\d+)\//.exec(headers['Content-Range'])!;
      if (Number(start) !== state.committed) return apiError(409, 'OFFSET_MISMATCH');
      state.committed = Number(end) + 1;
      return json(200, { committedOffset: state.committed }, { 'Upload-Offset': String(state.committed) });
    }
    if (method === 'POST' && url.endsWith('/complete')) {
      return json(200, { document: { document_id: 'doc-1', file_id: 'f-1', document_name: 'movie.mp4', mime_type: 'video/mp4', file_size: state.committed }, alreadyCompleted: false });
    }
    if (method === 'DELETE') return new Response(null, { status: 204 });
    return apiError(500, 'INTERNAL_ERROR');
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls, state };
}

const noSleep = () => {
  const sleep = vi.fn(async () => undefined);
  return sleep;
};

const puts = (calls: Array<{ method: string; range?: string }>) => calls.filter((c) => c.method === 'PUT').map((c) => c.range);

describe('uploadFileInSession', () => {
  it('creates a session with the target, sends sequential chunks at the server chunk size, then completes', async () => {
    const server = fakeServer();
    const onProgress = vi.fn();
    const size = 20 * MIB;

    const document = await uploadFileInSession({
      file: fileOf(size),
      target: { entityType: 'ticket', entityId: 'tkt-1', folderPath: '/Clients/Acme' },
      onProgress,
      transport: { fetch: server.fetchFn, sleep: noSleep() },
    });

    const create = server.calls[0];
    expect(create).toMatchObject({ method: 'POST', url: '/api/documents/uploads' });
    const body = JSON.parse((vi.mocked(server.fetchFn).mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({
      fileName: 'movie.mp4', mimeType: 'video/mp4', size,
      entityType: 'ticket', entityId: 'tkt-1', folderPath: '/Clients/Acme',
    });
    expect(puts(server.calls)).toEqual([
      `bytes 0-${CHUNK - 1}/${size}`,
      `bytes ${CHUNK}-${2 * CHUNK - 1}/${size}`,
      `bytes ${2 * CHUNK}-${size - 1}/${size}`,
    ]);
    expect(server.calls.at(-1)).toMatchObject({ method: 'POST', url: `${SESSION_URL}/complete` });
    // Progress is the committed offset the server reported, in order, ending at the total.
    expect(onProgress.mock.calls.map(([p]) => p.committed)).toEqual([0, CHUNK, 2 * CHUNK, size]);
    expect(document).toMatchObject({ document_id: 'doc-1', file_id: 'f-1' });
  });

  it('omits the target for a document with no entity', async () => {
    const server = fakeServer();
    await uploadFileInSession({ file: fileOf(MIB), transport: { fetch: server.fetchFn, sleep: noSleep() } });
    const body = JSON.parse((vi.mocked(server.fetchFn).mock.calls[0][1] as RequestInit).body as string);
    expect(body).not.toHaveProperty('entityType');
    expect(body).not.toHaveProperty('entityId');
    expect(body).not.toHaveProperty('folderPath');
  });

  it('resumes after a dropped chunk by asking HEAD for the offset, without resending committed bytes', async () => {
    let failedOnce = false;
    const server = fakeServer({
      intercept: ({ method }) => {
        if (method === 'PUT' && !failedOnce && server.state.committed === CHUNK) {
          failedOnce = true;
          throw new TypeError('network down');
        }
      },
    });
    const sleep = noSleep();
    const size = 3 * CHUNK;

    await uploadFileInSession({ file: fileOf(size), transport: { fetch: server.fetchFn, sleep } });

    const methods = server.calls.map((c) => c.method);
    expect(methods.slice(0, 5)).toEqual(['POST', 'PUT', 'PUT', 'HEAD', 'PUT']); // the second PUT dropped
    expect(puts(server.calls)).toEqual([
      `bytes 0-${CHUNK - 1}/${size}`,
      `bytes ${CHUNK}-${2 * CHUNK - 1}/${size}`, // dropped
      `bytes ${CHUNK}-${2 * CHUNK - 1}/${size}`, // resent from the committed offset
      `bytes ${2 * CHUNK}-${size - 1}/${size}`,
    ]);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(BACKOFF_BASE_MS * 0.75);
    expect(sleep.mock.calls[0][0]).toBeLessThanOrEqual(BACKOFF_BASE_MS);
  });

  it('skips a chunk the server committed after the client lost the response', async () => {
    let dropped = false;
    const server = fakeServer({
      intercept: ({ method, init }, state) => {
        if (method === 'PUT' && !dropped && state.committed === CHUNK) {
          dropped = true;
          // The server stores the chunk, but the response never arrives.
          const range = (init.headers as Record<string, string>)['Content-Range'];
          state.committed = Number(/-(\d+)\//.exec(range)![1]) + 1;
          throw new TypeError('connection reset');
        }
      },
    });
    const size = 3 * CHUNK;

    await uploadFileInSession({ file: fileOf(size), transport: { fetch: server.fetchFn, sleep: noSleep() } });

    expect(puts(server.calls)).toEqual([
      `bytes 0-${CHUNK - 1}/${size}`,
      `bytes ${CHUNK}-${2 * CHUNK - 1}/${size}`, // committed server-side, response lost
      `bytes ${2 * CHUNK}-${size - 1}/${size}`, // the client moves on from the HEAD offset
    ]);
  });

  it.each([
    ['OFFSET_MISMATCH', 409],
    ['CHUNK_IN_PROGRESS', 409],
  ])('retries a %s refusal after a HEAD', async (code, status) => {
    let refused = false;
    const server = fakeServer({
      intercept: ({ method }) => {
        if (method === 'PUT' && !refused) {
          refused = true;
          return apiError(status, code);
        }
      },
    });
    await uploadFileInSession({ file: fileOf(MIB), transport: { fetch: server.fetchFn, sleep: noSleep() } });
    expect(server.calls.map((c) => c.method)).toEqual(['POST', 'PUT', 'HEAD', 'PUT', 'POST']);
  });

  it('retries a 5xx chunk with capped, jittered exponential backoff, and gives up as a network failure when the window runs out', async () => {
    const server = fakeServer({ intercept: ({ method }) => (method === 'PUT' ? apiError(503, 'UNAVAILABLE') : undefined) });
    const sleep = noSleep();

    const failure = await uploadFileInSession({ file: fileOf(MIB), transport: { fetch: server.fetchFn, sleep, random: () => 1 } })
      .catch((e) => e as UploadSessionClientError);

    expect(failure).toBeInstanceOf(UploadSessionClientError);
    expect(failure.reason).toBe('network');
    const waits = sleep.mock.calls.map(([ms]) => ms);
    expect(waits.slice(0, 5)).toEqual([BACKOFF_BASE_MS, 2000, 4000, 8000, BACKOFF_CAP_MS]);
    expect(Math.max(...waits)).toBe(BACKOFF_CAP_MS);
    // The window is at least a minute even with the most jitter (75 %).
    const minimumWindow = waits.reduce((a, b) => a + b, 0) * 0.75;
    expect(minimumWindow).toBeGreaterThanOrEqual(60_000);
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(RETRY_WINDOW_MS);
    expect(puts(server.calls)).toHaveLength(waits.length + 1);
    // The session is released rather than left active.
    expect(server.calls.at(-1)).toMatchObject({ method: 'DELETE', url: SESSION_URL });
  });

  it('applies jitter between 75 % and 100 % of the scheduled wait', async () => {
    const server = fakeServer({ intercept: ({ method }) => (method === 'PUT' ? apiError(503, 'UNAVAILABLE') : undefined) });
    const sleep = noSleep();
    await uploadFileInSession({ file: fileOf(MIB), transport: { fetch: server.fetchFn, sleep, random: () => 0 } }).catch(() => undefined);
    expect(sleep.mock.calls[0][0]).toBe(BACKOFF_BASE_MS * 0.75);
  });

  it('rides out an outage far longer than the old 3.5 s and resumes from the HEAD offset', async () => {
    let outageAttempts = 6; // six failed requests with backoff in between: well over a 3.5 s outage
    const server = fakeServer({
      intercept: ({ method }, state) => {
        if (state.committed >= CHUNK && outageAttempts > 0 && (method === 'PUT' || method === 'HEAD')) {
          outageAttempts -= 1;
          throw new TypeError('network down');
        }
      },
    });
    const sleep = noSleep();
    const size = 3 * CHUNK;

    await uploadFileInSession({ file: fileOf(size), transport: { fetch: server.fetchFn, sleep, random: () => 1 } });

    const waited = sleep.mock.calls.reduce((total, [ms]) => total + ms, 0);
    expect(waited).toBeGreaterThan(3500);
    expect(puts(server.calls).filter((r) => r === `bytes ${CHUNK}-${2 * CHUNK - 1}/${size}`).length).toBeGreaterThan(1);
    expect(server.state.committed).toBe(size);
    expect(server.calls.at(-1)).toMatchObject({ url: `${SESSION_URL}/complete` });
  });

  it('waits for the browser to come back online before the next HEAD, without spending retries', async () => {
    let online = false;
    let release: () => void = () => {};
    const waitForOnline = vi.fn(async () => {
      if (online) return false;
      await new Promise<void>((resolve) => { release = resolve; });
      return true;
    });
    let dropped = false;
    const server = fakeServer({
      intercept: ({ method }, state) => {
        if (method === 'PUT' && !dropped && state.committed === CHUNK) {
          dropped = true;
          throw new TypeError('offline');
        }
      },
    });
    const sleep = noSleep();
    const size = 3 * CHUNK;

    const upload = uploadFileInSession({ file: fileOf(size), transport: { fetch: server.fetchFn, sleep, waitForOnline } });
    await vi.waitFor(() => expect(waitForOnline).toHaveBeenCalled());
    // Parked offline: no HEAD yet, and the upload is not finished.
    expect(server.calls.some((c) => c.method === 'HEAD')).toBe(false);
    online = true;
    release();
    await upload;

    expect(sleep).not.toHaveBeenCalled(); // offline time is neither backoff nor a retry
    expect(server.calls.map((c) => c.method).slice(0, 5)).toEqual(['POST', 'PUT', 'PUT', 'HEAD', 'PUT']);
    expect(server.state.committed).toBe(size);
  });

  it('sends DELETE when cancelled while waiting offline', async () => {
    const controller = new AbortController();
    const waitForOnline = vi.fn((signal?: AbortSignal) => new Promise<boolean>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new UploadSessionClientError('cancelled', 'Upload cancelled')));
      queueMicrotask(() => controller.abort());
    }));
    const server = fakeServer({ intercept: ({ method }) => { if (method === 'PUT') throw new TypeError('offline'); } });

    const failure = await uploadFileInSession({
      file: fileOf(MIB),
      signal: controller.signal,
      transport: { fetch: server.fetchFn, sleep: noSleep(), waitForOnline },
    }).catch((e) => e as UploadSessionClientError);

    expect(failure.reason).toBe('cancelled');
    expect(server.calls.at(-1)).toMatchObject({ method: 'DELETE', url: SESSION_URL });
    expect(server.calls.some((c) => c.method === 'HEAD')).toBe(false);
  });

  it('spends a retry when the offset check itself fails, and still runs out as a network failure', async () => {
    const server = fakeServer({
      intercept: ({ method }) => {
        if (method === 'PUT') throw new TypeError('offline');
        if (method === 'HEAD') throw new TypeError('offline');
      },
    });
    const sleep = noSleep();
    const failure = await uploadFileInSession({ file: fileOf(MIB), transport: { fetch: server.fetchFn, sleep } })
      .catch((e) => e as UploadSessionClientError);
    expect(failure.reason).toBe('network');
    expect(server.calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
    expect(server.calls.filter((c) => c.method === 'HEAD').length).toBe(sleep.mock.calls.length);
    expect(sleep.mock.calls.length).toBeGreaterThanOrEqual(8);
  });

  it('treats a 410 on the offset check as terminal and does not send a DELETE', async () => {
    let first = true;
    const server = fakeServer({
      intercept: ({ method }) => {
        if (method === 'PUT' && first) { first = false; throw new TypeError('offline'); }
        if (method === 'HEAD') return new Response(null, { status: 410 });
      },
    });
    const failure = await uploadFileInSession({ file: fileOf(MIB), transport: { fetch: server.fetchFn, sleep: noSleep() } })
      .catch((e) => e as UploadSessionClientError);
    expect(failure.reason).toBe('sessionGone');
    expect(server.calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('retries complete when it fails transiently', async () => {
    let failures = 2;
    const server = fakeServer({
      intercept: ({ url }) => (url.endsWith('/complete') && failures-- > 0 ? apiError(502, 'STORAGE_COMPLETE_FAILED') : undefined),
    });
    const document = await uploadFileInSession({ file: fileOf(MIB), transport: { fetch: server.fetchFn, sleep: noSleep() } });
    expect(document.document_id).toBe('doc-1');
    expect(server.calls.filter((c) => c.url.endsWith('/complete'))).toHaveLength(3);
  });

  it('aborts the request in flight and sends DELETE when cancelled', async () => {
    const controller = new AbortController();
    const server = fakeServer({
      intercept: ({ method, init }) => {
        if (method !== 'PUT') return undefined;
        return new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          controller.abort();
        });
      },
    });

    const failure = await uploadFileInSession({ file: fileOf(20 * MIB), signal: controller.signal, transport: { fetch: server.fetchFn, sleep: noSleep() } })
      .catch((e) => e as UploadSessionClientError);

    expect(failure.reason).toBe('cancelled');
    expect(server.calls.at(-1)).toMatchObject({ method: 'DELETE', url: SESSION_URL });
    expect(puts(server.calls)).toHaveLength(1);
  });

  it('does not create a session when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const server = fakeServer();
    const failure = await uploadFileInSession({ file: fileOf(MIB), signal: controller.signal, transport: { fetch: server.fetchFn } })
      .catch((e) => e as UploadSessionClientError);
    expect(failure.reason).toBe('cancelled');
    expect(server.calls).toHaveLength(0);
  });

  it('reports the API limit with an over-limit refusal on create, before any bytes are sent', async () => {
    const server = fakeServer({ create: () => apiError(413, 'UPLOAD_TOO_LARGE', { maxFileSize: 5 * 1024 * MIB }) });
    const failure = await uploadFileInSession({ file: fileOf(6 * 1024 * MIB), transport: { fetch: server.fetchFn, sleep: noSleep() } })
      .catch((e) => e as UploadSessionClientError);
    expect(failure).toMatchObject({ reason: 'tooLarge', details: { status: 413, maxFileSize: 5 * 1024 * MIB } });
    expect(server.calls.map((c) => c.method)).toEqual(['POST']);
  });

  it('reports a network failure on create without retrying it', async () => {
    const server = fakeServer({ intercept: () => { throw new TypeError('offline'); } });
    const failure = await uploadFileInSession({ file: fileOf(MIB), transport: { fetch: server.fetchFn, sleep: noSleep() } })
      .catch((e) => e as UploadSessionClientError);
    expect(failure.reason).toBe('network');
    expect(server.calls).toHaveLength(1);
  });
});

describe('reasonForApiError', () => {
  const cases: Array<[number, string, UploadFailureReason | null]> = [
    [413, 'UPLOAD_TOO_LARGE', 'tooLarge'],
    [415, 'UPLOAD_TYPE_NOT_ALLOWED', 'typeNotAllowed'],
    [415, 'UPLOAD_TYPE_REJECTED', 'typeNotAllowed'],
    [403, 'FORBIDDEN', 'permissionDenied'],
    [401, 'UNAUTHORIZED', 'permissionDenied'],
    [410, 'UPLOAD_EXPIRED', 'sessionGone'],
    [410, 'UPLOAD_ABORTED', 'sessionGone'],
    [404, 'UPLOAD_NOT_FOUND', 'sessionGone'],
    [409, 'OFFSET_MISMATCH', null],
    [409, 'CHUNK_IN_PROGRESS', null],
    [409, 'COMPLETE_IN_PROGRESS', null],
    [502, 'STORAGE_COMPLETE_FAILED', null],
    [500, 'INTERNAL_ERROR', null],
    [413, 'CHUNK_TOO_LARGE', 'unknown'],
    [409, 'CHUNK_REJECTED', 'unknown'],
    [409, 'UPLOAD_INCOMPLETE', 'unknown'],
    [409, 'UPLOAD_COMPLETED', 'unknown'],
    [422, 'SIZE_MISMATCH', 'unknown'],
  ];
  it.each(cases)('maps %i %s to %s', (status, code, reason) => {
    expect(reasonForApiError(status, code)).toBe(reason);
  });
});
