import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/storage/config/storage', () => ({
  getStorageConfig: async () => ({ defaultProvider: 'local', providers: { local: { maxFileSize: 500 * 1024 * 1024 } } }),
}));

import { LengthRequiredError, PayloadTooLargeError, handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';
import {
  MAX_MULTIPART_REQUEST_BYTES,
  MULTIPART_ENVELOPE_BYTES,
  assertMultipartRequestWithinCap,
} from 'server/src/lib/api/services/documents/multipartCap';
import { JSON_ENVELOPE_BYTES, assertJsonBodyWithinCap, base64EncodedLength } from 'server/src/lib/api/services/documents/resolveSource';

const req = (contentLength?: string) => ({ headers: { get: (n: string) => (n === 'content-length' ? contentLength ?? null : null) } });

describe('multipart request cap', () => {
  it('passes at the transport cap', async () => {
    await expect(assertMultipartRequestWithinCap(req(String(MAX_MULTIPART_REQUEST_BYTES)))).resolves.toBeUndefined();
  });

  it('411s a request with no (or a non-numeric) Content-Length: formData() would buffer it unbounded', async () => {
    for (const header of [undefined, 'abc', '-5', '1e9']) {
      const error = await assertMultipartRequestWithinCap(req(header)).catch((e) => e);
      expect(error).toBeInstanceOf(LengthRequiredError);
      expect(error.statusCode).toBe(411);
      expect(error.message).toMatch(/\/api\/documents\/uploads/);
    }
  });

  it('413s past the cap, pointing at the session API', async () => {
    const error = await assertMultipartRequestWithinCap(req(String(MAX_MULTIPART_REQUEST_BYTES + 1))).catch((e) => e);
    expect(error).toBeInstanceOf(PayloadTooLargeError);
    expect(error.message).toMatch(/\/api\/documents\/uploads/);
  });

  it('a lower provider max lets a file exactly at it through (plus framing); the ingest enforces the per-file max', async () => {
    await expect(assertMultipartRequestWithinCap(req(String(1024 + 512)), 1024)).resolves.toBeUndefined();
    await expect(assertMultipartRequestWithinCap(req(String(1024 + MULTIPART_ENVELOPE_BYTES)), 1024)).resolves.toBeUndefined();
    const error = await assertMultipartRequestWithinCap(req(String(1024 + MULTIPART_ENVELOPE_BYTES + 1)), 1024).catch((e) => e);
    expect(error).toBeInstanceOf(PayloadTooLargeError);
  });

  it('fails fast on a provider max that is not a positive number', async () => {
    await expect(assertMultipartRequestWithinCap(req('10'), Number.NaN)).rejects.toThrow(/maxFileSize/);
  });
});

describe('JSON attach request cap', () => {
  const cap = 1024;

  it('411s without a numeric Content-Length instead of letting req.json() read it unbounded', () => {
    for (const header of [null, 'abc']) {
      expect(() => assertJsonBodyWithinCap(header, cap)).toThrow(LengthRequiredError);
    }
  });

  it('accepts a base64 file exactly at the cap plus the JSON envelope, and 413s past the margin', () => {
    const encoded = base64EncodedLength(cap);
    expect(() => assertJsonBodyWithinCap(String(encoded + JSON_ENVELOPE_BYTES), cap)).not.toThrow();
    expect(() => assertJsonBodyWithinCap(String(Math.ceil(encoded * 1.05) + JSON_ENVELOPE_BYTES + 1), cap)).toThrow(PayloadTooLargeError);
  });
});

describe('API error mapping', () => {
  it('handleApiError returns 413 PAYLOAD_TOO_LARGE for PayloadTooLargeError, not a 500', async () => {
    const response = handleApiError(new PayloadTooLargeError('too big', [{ path: ['file'], message: 'x' }]));
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('handleApiError returns 411 LENGTH_REQUIRED for LengthRequiredError', async () => {
    const response = handleApiError(new LengthRequiredError('need a length'));
    expect(response.status).toBe(411);
    expect((await response.json()).error.code).toBe('LENGTH_REQUIRED');
  });
});

describe('the proxy body limit the caps are derived from', () => {
  it('NEXT_PROXY_MAX_BODY_BYTES equals proxyClientMaxBodySize in next.config.mjs', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const { NEXT_PROXY_MAX_BODY_BYTES, parseByteSize } = await import('@alga-psa/storage/ingest/bufferedCap');
    const config = readFileSync(resolve(__dirname, '../../../../../../next.config.mjs'), 'utf8');
    const declared = /proxyClientMaxBodySize:\s*['"]([^'"]+)['"]/.exec(config)?.[1];
    expect(declared).toBeDefined();
    expect(parseByteSize(declared!)).toBe(NEXT_PROXY_MAX_BODY_BYTES);
    expect(MAX_MULTIPART_REQUEST_BYTES).toBe(NEXT_PROXY_MAX_BODY_BYTES);
  });
});
