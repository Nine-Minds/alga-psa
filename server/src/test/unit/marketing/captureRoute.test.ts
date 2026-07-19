/**
 * T011 — public capture endpoint guards.
 *
 * Direct-handler tests for POST /api/marketing/capture/[tenant]/[slug] with
 * submitCaptureInternal (@alga-psa/marketing/lib) and tenant resolution
 * (@/lib/marketing/publicEndpoints) mocked at the module boundary. Asserts:
 *   1. Honeypot: a non-empty `website` field -> silent 200 {ok:true}, and
 *      submitCaptureInternal is never called.
 *   2. Malformed payloads (missing email, bad email, oversized fields,
 *      non-JSON body) -> 400, and submitCaptureInternal is never called.
 *   3. Rate limit: the 11th request within the window from the same
 *      ip:tenant -> 429. The route's module-level RateLimiterMemory keeps its
 *      state for the file, so each test uses a distinct x-forwarded-for IP to
 *      isolate buckets.
 *   4. Enumeration safety: a submission whose form does not exist
 *      (submitCaptureInternal throws) produces a byte-identical response to a
 *      successful submission — the caller cannot tell known/unknown slugs or
 *      suppressed emails apart.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  submitCaptureInternal: vi.fn(),
  resolvePublicMarketingTenant: vi.fn(),
}));

vi.mock('@alga-psa/marketing/lib', () => ({
  submitCaptureInternal: mocks.submitCaptureInternal,
}));

vi.mock('@/lib/marketing/publicEndpoints', async (importOriginal) => ({
  // Keep the real getClientIp (header precedence) so the rate-limit tests
  // exercise the same key derivation as production.
  ...await importOriginal<typeof import('@/lib/marketing/publicEndpoints')>(),
  resolvePublicMarketingTenant: mocks.resolvePublicMarketingTenant,
}));

import { POST as capturePost } from '../../../app/api/marketing/capture/[tenant]/[slug]/route';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const FAKE_KNEX = {};

function captureRequest(body: unknown, ip: string) {
  return new NextRequest(`http://localhost/api/marketing/capture/${TENANT_ID}/spring-webinar`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as any;
}

function params() {
  return { params: Promise.resolve({ tenant: TENANT_ID, slug: 'spring-webinar' }) };
}

const VALID_SUBMISSION = {
  name: 'Lee Lead',
  email: 'lee@example.com',
  company: 'Acme',
  message: 'Saw your webinar',
};

describe('T011: capture endpoint guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolvePublicMarketingTenant.mockResolvedValue({ knex: FAKE_KNEX, tenantId: TENANT_ID });
    mocks.submitCaptureInternal.mockResolvedValue({ contact_id: 'contact-1' });
  });

  it('silently accepts honeypot submissions without persisting anything', async () => {
    const response = await capturePost(
      captureRequest({ ...VALID_SUBMISSION, website: 'http://spam-bot.example' }, '10.0.0.1'),
      params(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.submitCaptureInternal).not.toHaveBeenCalled();
  });

  it.each([
    ['missing email', { name: 'Lee Lead' }],
    ['malformed email', { ...VALID_SUBMISSION, email: 'not-an-email' }],
    ['missing name', { email: 'lee@example.com' }],
    ['oversized name', { ...VALID_SUBMISSION, name: 'x'.repeat(201) }],
    ['oversized message', { ...VALID_SUBMISSION, message: 'x'.repeat(5001) }],
  ])('rejects invalid payloads (%s) without calling the capture flow', async (_label, body) => {
    const response = await capturePost(captureRequest(body, '10.0.0.2'), params());

    expect(response.status).toBe(400);
    expect((await response.json()).ok).toBe(false);
    expect(mocks.submitCaptureInternal).not.toHaveBeenCalled();
  });

  it('rejects a non-JSON body with 400', async () => {
    const response = await capturePost(captureRequest('this is not json{', '10.0.0.3'), params());

    expect(response.status).toBe(400);
    expect(mocks.submitCaptureInternal).not.toHaveBeenCalled();
  });

  it('rate limits the 11th request from the same ip:tenant within the window', async () => {
    const ip = '10.0.0.4';
    for (let i = 0; i < 10; i += 1) {
      const response = await capturePost(captureRequest(VALID_SUBMISSION, ip), params());
      expect(response.status, `request ${i + 1} should be allowed`).toBe(200);
    }
    expect(mocks.submitCaptureInternal).toHaveBeenCalledTimes(10);

    const eleventh = await capturePost(captureRequest(VALID_SUBMISSION, ip), params());
    expect(eleventh.status).toBe(429);
    expect((await eleventh.json()).ok).toBe(false);
    expect(mocks.submitCaptureInternal).toHaveBeenCalledTimes(10);

    // A different IP has its own bucket and is unaffected.
    const otherIp = await capturePost(captureRequest(VALID_SUBMISSION, '10.0.0.5'), params());
    expect(otherIp.status).toBe(200);
  });

  it('returns byte-identical responses whether the submission succeeds or the form is unknown', async () => {
    const success = await capturePost(captureRequest(VALID_SUBMISSION, '10.0.0.6'), params());
    const successBody = await success.text();

    mocks.submitCaptureInternal.mockRejectedValue(new Error('Capture form not found'));
    const unknownForm = await capturePost(captureRequest(VALID_SUBMISSION, '10.0.0.7'), params());
    const unknownFormBody = await unknownForm.text();

    mocks.submitCaptureInternal.mockRejectedValue(new Error('Contact is suppressed from marketing email'));
    const suppressed = await capturePost(captureRequest(VALID_SUBMISSION, '10.0.0.8'), params());
    const suppressedBody = await suppressed.text();

    expect(success.status).toBe(200);
    expect(unknownForm.status).toBe(200);
    expect(suppressed.status).toBe(200);
    expect(unknownFormBody).toBe(successBody);
    expect(suppressedBody).toBe(successBody);
    expect(successBody).toBe('{"ok":true}');
  });

  it('answers a generic 404 for an unknown tenant without touching the capture flow', async () => {
    mocks.resolvePublicMarketingTenant.mockResolvedValue(null);

    const response = await capturePost(captureRequest(VALID_SUBMISSION, '10.0.0.9'), params());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: 'Not found' });
    expect(mocks.submitCaptureInternal).not.toHaveBeenCalled();
  });
});
