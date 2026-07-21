/**
 * T010 — email open (pixel) and click (redirect) tracking routes.
 *
 * Direct-handler tests for:
 *   GET /api/marketing/track/open/[tenant]/[enrollmentId]/[stepId]
 *   GET /api/marketing/track/click/[tenant]/[enrollmentId]/[stepId]?u=<url>
 *
 * The marketing recorders (@alga-psa/marketing/lib), tenant resolution
 * (@/lib/marketing/publicEndpoints), and PostHog (@/lib/analytics/server) are
 * mocked at the module boundary. Asserts:
 *   - open: 200 image/gif 1px with cache-control no-store; recorder + PostHog
 *     fire; recorder failure is swallowed (pixel + PostHog still happen);
 *   - click: 302 to the destination; 400 on javascript:/relative/missing u;
 *     PostHog receives the destination HOST only, never the full URL;
 *     recorder failure is swallowed (redirect still happens);
 *   - unknown tenant -> generic 404, no recorder/PostHog call, nothing leaks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
// The global next/server stub (src/test/stubs/next-server.ts) provides
// NextRequest.nextUrl, which the click route reads for the `u` param.
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  recordSequenceOpenInternal: vi.fn(),
  recordSequenceClickInternal: vi.fn(),
  analyticsCapture: vi.fn(),
  resolvePublicMarketingTenant: vi.fn(),
}));

vi.mock('@alga-psa/marketing/lib', async (importOriginal) => ({
  // Keep the real signing helpers — the click route verifies real HMACs.
  ...await importOriginal<typeof import('@alga-psa/marketing/lib')>(),
  recordSequenceOpenInternal: mocks.recordSequenceOpenInternal,
  recordSequenceClickInternal: mocks.recordSequenceClickInternal,
}));

vi.mock('@/lib/marketing/signingSecret', () => ({
  getMarketingSigningSecret: vi.fn(async () => 'unit-test-signing-secret'),
}));

vi.mock('@/lib/analytics/server', () => ({
  analytics: { capture: mocks.analyticsCapture },
}));

vi.mock('@/lib/marketing/publicEndpoints', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/marketing/publicEndpoints')>(),
  resolvePublicMarketingTenant: mocks.resolvePublicMarketingTenant,
}));

import { GET as trackOpen } from '../../../app/api/marketing/track/open/[tenant]/[enrollmentId]/[stepId]/route';
import { GET as trackClick } from '../../../app/api/marketing/track/click/[tenant]/[enrollmentId]/[stepId]/route';
import { signTrackingDestination } from '../../../../../packages/marketing/src/lib/signing';

const SIGNING_SECRET = 'unit-test-signing-secret';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ENROLLMENT_ID = '22222222-2222-2222-2222-222222222222';
const STEP_ID = '33333333-3333-3333-3333-333333333333';
const FAKE_KNEX = {};

function params() {
  return { params: Promise.resolve({ tenant: TENANT_ID, enrollmentId: ENROLLMENT_ID, stepId: STEP_ID }) };
}

function signFor(u: string): string {
  return signTrackingDestination(SIGNING_SECRET, {
    tenant: TENANT_ID,
    enrollmentId: ENROLLMENT_ID,
    stepId: STEP_ID,
    url: u,
  });
}

function clickRequest(u?: string, signature?: string | null) {
  // signature: undefined -> sign correctly; null -> omit `s` entirely.
  let url = `http://localhost/api/marketing/track/click/${TENANT_ID}/${ENROLLMENT_ID}/${STEP_ID}`;
  if (u !== undefined) {
    url += `?u=${encodeURIComponent(u)}`;
    const s = signature === undefined ? signFor(u) : signature;
    if (s !== null) url += `&s=${s}`;
  }
  return new NextRequest(url) as any;
}

function openRequest() {
  return new NextRequest(`http://localhost/api/marketing/track/open/${TENANT_ID}/${ENROLLMENT_ID}/${STEP_ID}`) as any;
}

describe('T010: track/open pixel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolvePublicMarketingTenant.mockResolvedValue({ knex: FAKE_KNEX, tenantId: TENANT_ID });
    mocks.recordSequenceOpenInternal.mockResolvedValue(undefined);
    mocks.analyticsCapture.mockResolvedValue(undefined);
  });

  it('returns the 1px gif with no-store and records the open + PostHog event', async () => {
    const response = await trackOpen(openRequest(), params());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/gif');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = Buffer.from(await response.arrayBuffer());
    // Exactly the 1x1 transparent gif (same payload the route serves).
    const expectedGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    expect(body.equals(expectedGif)).toBe(true);
    expect(body.subarray(0, 6).toString('ascii')).toBe('GIF89a');

    expect(mocks.recordSequenceOpenInternal).toHaveBeenCalledWith(FAKE_KNEX, TENANT_ID, ENROLLMENT_ID, STEP_ID);
    expect(mocks.analyticsCapture).toHaveBeenCalledWith('marketing_email_opened', {
      tenant: TENANT_ID,
      enrollmentId: ENROLLMENT_ID,
      stepId: STEP_ID,
    });
  });

  it('still serves the pixel and fires PostHog when the recorder throws (best-effort)', async () => {
    mocks.recordSequenceOpenInternal.mockRejectedValue(new Error('database is down'));

    const response = await trackOpen(openRequest(), params());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/gif');
    expect(mocks.analyticsCapture).toHaveBeenCalledWith('marketing_email_opened', expect.anything());
  });

  it('answers a generic 404 for an unknown tenant without recording anything', async () => {
    mocks.resolvePublicMarketingTenant.mockResolvedValue(null);

    const response = await trackOpen(openRequest(), params());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: 'Not found' });
    expect(mocks.recordSequenceOpenInternal).not.toHaveBeenCalled();
    expect(mocks.analyticsCapture).not.toHaveBeenCalled();
  });
});

describe('T010: track/click redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolvePublicMarketingTenant.mockResolvedValue({ knex: FAKE_KNEX, tenantId: TENANT_ID });
    mocks.recordSequenceClickInternal.mockResolvedValue(undefined);
    mocks.analyticsCapture.mockResolvedValue(undefined);
  });

  it('302s to the destination, records the click, and sends PostHog the host only', async () => {
    const destination = 'https://blog.example.com/path/to/article?campaign=spring&email=lead@example.com';
    const response = await trackClick(clickRequest(destination), params());

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(new URL(destination).toString());

    expect(mocks.recordSequenceClickInternal).toHaveBeenCalledWith(
      FAKE_KNEX, TENANT_ID, ENROLLMENT_ID, STEP_ID, destination,
    );
    expect(mocks.analyticsCapture).toHaveBeenCalledWith('marketing_email_clicked', {
      tenant: TENANT_ID,
      enrollmentId: ENROLLMENT_ID,
      stepId: STEP_ID,
      destination_host: 'blog.example.com',
    });
    // Never the full URL: no query string / PII leaves via analytics.
    const captureProps = mocks.analyticsCapture.mock.calls[0][1];
    expect(JSON.stringify(captureProps)).not.toContain('lead@example.com');
    expect(JSON.stringify(captureProps)).not.toContain('/path/to/article');
  });

  it('still redirects when the recorder throws (best-effort)', async () => {
    mocks.recordSequenceClickInternal.mockRejectedValue(new Error('database is down'));

    const response = await trackClick(clickRequest('https://example.com/landing'), params());

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://example.com/landing');
    expect(mocks.analyticsCapture).toHaveBeenCalledWith('marketing_email_clicked', expect.anything());
  });

  it.each([
    ['javascript:alert(1)'],
    ['/relative/path'],
    ['ftp://example.com/file'],
  ])('400s on a non-http(s) destination: %s', async (u) => {
    const response = await trackClick(clickRequest(u), params());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'Invalid destination URL' });
    expect(mocks.recordSequenceClickInternal).not.toHaveBeenCalled();
    expect(mocks.analyticsCapture).not.toHaveBeenCalled();
  });

  it('400s when u is missing', async () => {
    const response = await trackClick(clickRequest(undefined), params());

    expect(response.status).toBe(400);
    expect(mocks.recordSequenceClickInternal).not.toHaveBeenCalled();
  });

  it('M5: refuses a destination with a tampered signature — no open redirect', async () => {
    // Signature minted for a different URL: swapping in an attacker URL fails.
    const response = await trackClick(
      clickRequest('https://evil.example.com/phish', signFor('https://legit.example.com/article')),
      params(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'Invalid destination URL' });
    expect(mocks.recordSequenceClickInternal).not.toHaveBeenCalled();
    expect(mocks.analyticsCapture).not.toHaveBeenCalled();
  });

  it('M5: refuses a destination with no signature at all', async () => {
    const response = await trackClick(clickRequest('https://example.com/landing', null), params());

    expect(response.status).toBe(400);
    expect(mocks.recordSequenceClickInternal).not.toHaveBeenCalled();
  });

  it('answers a generic 404 for an unknown tenant without recording or redirecting', async () => {
    mocks.resolvePublicMarketingTenant.mockResolvedValue(null);

    const response = await trackClick(clickRequest('https://example.com/landing'), params());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: 'Not found' });
    expect(mocks.recordSequenceClickInternal).not.toHaveBeenCalled();
    expect(mocks.analyticsCapture).not.toHaveBeenCalled();
  });
});
