import { describe, expect, it } from 'vitest';
import { NEXT_PROXY_MAX_BODY_BYTES } from '@alga-psa/storage/ingest/bufferedCap';
import { bodySizeGuardResponse, oversizedDeclaredBody, PAYLOAD_TOO_LARGE } from '../../../middleware/bodySizeGuard';

const headers = (contentLength?: string) => new Headers(contentLength === undefined ? {} : { 'content-length': contentLength });

describe('bodySizeGuard (Next truncates a body past proxyClientMaxBodySize without an error)', () => {
  it('lets a body at the cap through and refuses one byte over it', () => {
    expect(oversizedDeclaredBody(headers(String(NEXT_PROXY_MAX_BODY_BYTES)))).toBeNull();
    expect(oversizedDeclaredBody(headers(String(NEXT_PROXY_MAX_BODY_BYTES + 1)))).toBe(NEXT_PROXY_MAX_BODY_BYTES + 1);
  });

  it('cannot judge a missing or malformed Content-Length, so it does not refuse it', () => {
    expect(oversizedDeclaredBody(headers())).toBeNull();
    expect(oversizedDeclaredBody(headers('abc'))).toBeNull();
    expect(oversizedDeclaredBody(headers('-5'))).toBeNull();
  });

  it('answers 413 in the v1 error contract, naming the limit and the chunked session API', async () => {
    const response = bodySizeGuardResponse({ headers: headers(String(NEXT_PROXY_MAX_BODY_BYTES + 1)) });
    expect(response?.status).toBe(413);
    const body = await response!.json();
    expect(body.error.code).toBe(PAYLOAD_TOO_LARGE);
    expect(body.error.details).toEqual({ limit: NEXT_PROXY_MAX_BODY_BYTES, declared: NEXT_PROXY_MAX_BODY_BYTES + 1 });
    expect(body.error.message).toContain('100 MB');
    expect(body.error.message).toContain('/api/documents/uploads');
  });

  it('returns null when the request may proceed', () => {
    expect(bodySizeGuardResponse({ headers: headers('1024') })).toBeNull();
  });
});
