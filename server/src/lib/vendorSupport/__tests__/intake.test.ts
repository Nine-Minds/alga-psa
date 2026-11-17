import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAppSecret: vi.fn<(name: string) => Promise<string | undefined>>(),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: mocks.getAppSecret }),
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import {
  INTAKE_SIGNATURE_HEADER,
  signVendorSupportIntake,
  submitVendorSupportIntake,
  type VendorSupportIntakePayload,
} from '../intake';

const DEFAULT_URL = 'https://www.nineminds.com/api/support/intake';

const payload: VendorSupportIntakePayload = {
  tenantId: '11111111-2222-3333-4444-555555555555',
  tenantName: 'Emerald City MSP',
  userName: 'Glinda Good',
  userEmail: 'glinda@emeraldcity.oz',
  category: 'bug',
  subject: 'Invoices will not finalize',
  description: 'Finalizing an invoice spins forever and never completes at all.',
  edition: 'CE',
  onPrem: false,
  appVersion: '9.9.9',
  pageUrl: '/msp/billing',
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const fetchMock = vi.fn<typeof fetch>();

function lastRequest() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string>, body: init.body as string };
}

describe('signVendorSupportIntake', () => {
  it('emits `t=<unix>,v1=<hex>` for a fixed vector', () => {
    const body = JSON.stringify({ source: 'in_app', tenantId: 't-1' });

    expect(signVendorSupportIntake('intake-secret', body, 1763337600)).toBe(
      't=1763337600,v1=4d02d148014712ce3b2375cca73c9d1364245837eba54b9c7a93750773f1dc9c',
    );
  });

  it('is the header nm-store reads', () => {
    expect(INTAKE_SIGNATURE_HEADER).toBe('X-Alga-Support-Signature');
  });
});

describe('submitVendorSupportIntake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.VENDOR_SUPPORT_INTAKE_URL;
    mocks.getAppSecret.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, ticketNumber: 'alga-2026-0003329' }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.VENDOR_SUPPORT_INTAKE_URL;
  });

  it('POSTs the contract body to the default endpoint and returns the ticket number', async () => {
    expect(await submitVendorSupportIntake(payload)).toEqual({
      ok: true,
      ticketNumber: 'alga-2026-0003329',
    });

    const { url, init, headers, body } = lastRequest();
    // The apex 301s to www, and a redirected POST is re-issued as a bodyless
    // GET, so the default has to be the host that answers directly.
    expect(url).toBe(DEFAULT_URL);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(body)).toEqual({
      source: 'in_app',
      tenantId: payload.tenantId,
      tenantName: payload.tenantName,
      userName: payload.userName,
      userEmail: payload.userEmail,
      category: 'bug',
      subject: payload.subject,
      description: payload.description,
      edition: 'CE',
      onPrem: false,
      appVersion: '9.9.9',
      pageUrl: '/msp/billing',
    });
  });

  it('honours VENDOR_SUPPORT_INTAKE_URL', async () => {
    process.env.VENDOR_SUPPORT_INTAKE_URL = 'https://staging.nineminds.com/api/support/intake';

    await submitVendorSupportIntake(payload);

    expect(lastRequest().url).toBe('https://staging.nineminds.com/api/support/intake');
  });

  it('gives up after 8 seconds', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    await submitVendorSupportIntake(payload);

    expect(timeout).toHaveBeenCalledWith(8000);
    expect(lastRequest().init.signal).toBeInstanceOf(AbortSignal);
    timeout.mockRestore();
  });

  it('sends unsigned when no secret is provisioned (on-prem)', async () => {
    await submitVendorSupportIntake(payload);

    expect(mocks.getAppSecret).toHaveBeenCalledWith('VENDOR_SUPPORT_INTAKE_SECRET');
    expect(lastRequest().headers[INTAKE_SIGNATURE_HEADER]).toBeUndefined();
  });

  it('sends unsigned when the secret provider throws', async () => {
    mocks.getAppSecret.mockRejectedValue(new Error('vault down'));

    expect(await submitVendorSupportIntake(payload)).toEqual({
      ok: true,
      ticketNumber: 'alga-2026-0003329',
    });
    expect(lastRequest().headers[INTAKE_SIGNATURE_HEADER]).toBeUndefined();
  });

  it('signs the exact bytes sent when a secret is available', async () => {
    mocks.getAppSecret.mockResolvedValue('hosted-intake-secret');
    const before = Math.floor(Date.now() / 1000);

    await submitVendorSupportIntake(payload);

    const { headers, body } = lastRequest();
    const header = headers[INTAKE_SIGNATURE_HEADER];
    const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
    expect(match).not.toBeNull();

    const [, timestamp, signature] = match!;
    expect(Number(timestamp)).toBeGreaterThanOrEqual(before);
    expect(Number(timestamp)).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    expect(signature).toBe(
      crypto
        .createHmac('sha256', 'hosted-intake-secret')
        .update(`${timestamp}.${body}`, 'utf8')
        .digest('hex'),
    );
  });

  it('treats a blank secret as absent', async () => {
    mocks.getAppSecret.mockResolvedValue('   ');

    await submitVendorSupportIntake(payload);

    expect(lastRequest().headers[INTAKE_SIGNATURE_HEADER]).toBeUndefined();
  });

  it('omits an empty or non-string ticket number', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, ticketNumber: '  ' }));
    expect(await submitVendorSupportIntake(payload)).toEqual({ ok: true });

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, ticketNumber: 42 }));
    expect(await submitVendorSupportIntake(payload)).toEqual({ ok: true });
  });

  it('reports http_<status> for a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: 'boom' }, 500));

    expect(await submitVendorSupportIntake(payload)).toEqual({ ok: false, reason: 'http_500' });
  });

  it('reports the rejection reason for a 200 with ok:false', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: 'unknown_tenant' }));

    expect(await submitVendorSupportIntake(payload)).toEqual({
      ok: false,
      reason: 'rejected:unknown_tenant',
    });
  });

  it('reports invalid_response when the body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>502</html>', { status: 200 }));

    expect(await submitVendorSupportIntake(payload)).toEqual({
      ok: false,
      reason: 'invalid_response',
    });
  });

  it('reports timeout when the request is aborted', async () => {
    const abort = new Error('The operation was aborted due to timeout');
    abort.name = 'TimeoutError';
    fetchMock.mockRejectedValueOnce(abort);

    expect(await submitVendorSupportIntake(payload)).toEqual({ ok: false, reason: 'timeout' });
  });

  it('reports a network failure without throwing', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    expect(await submitVendorSupportIntake(payload)).toEqual({
      ok: false,
      reason: 'network:fetch failed',
    });
  });

  it('names the cause so a redirected endpoint is loud, not silent', async () => {
    fetchMock.mockRejectedValueOnce(
      new TypeError('fetch failed', { cause: new Error('unexpected redirect') }),
    );

    expect(await submitVendorSupportIntake(payload)).toEqual({
      ok: false,
      reason: 'network:fetch failed (unexpected redirect)',
    });
  });
});
