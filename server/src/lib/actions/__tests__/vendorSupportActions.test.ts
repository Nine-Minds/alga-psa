import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendVendorSupportRequestEmail: vi.fn(),
  isConfigured: vi.fn(),
  isSelfHostLicensing: vi.fn(),
  tenantFirst: vi.fn(),
  getAppSecret: vi.fn<(name: string) => Promise<string | undefined>>(),
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: any) => action,
}));

vi.mock('@alga-psa/email', () => ({
  getSystemEmailService: async () => ({ isConfigured: mocks.isConfigured }),
  sendVendorSupportRequestEmail: mocks.sendVendorSupportRequestEmail,
}));

vi.mock('@alga-psa/licensing', () => ({
  isSelfHostLicensing: mocks.isSelfHostLicensing,
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: mocks.getAppSecret }),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-1' })),
  tenantDb: () => ({
    table: () => ({ first: mocks.tenantFirst }),
  }),
}));

vi.mock('@/lib/utils/version', () => ({
  getAppVersion: () => '9.9.9',
}));

import { INTAKE_SIGNATURE_HEADER } from '@/lib/vendorSupport/intake';
import { submitVendorSupportRequest } from '../vendorSupportActions';

// withAuth is mocked to return the raw action; the real wrapper type only
// accepts the trailing args, so the action is invoked through a raw alias.
type RawAction = (user: any, ctx: any, ...args: any[]) => Promise<any>;
const rawSubmit = submitVendorSupportRequest as unknown as RawAction;

const ctx = { tenant: '11111111-2222-3333-4444-555555555555' };

let userCounter = 0;
// The limiter keys on user_id and the module-level map persists across tests,
// so each case uses a fresh identity unless it is exercising the limiter.
const makeUser = () => ({
  user_id: `user-${++userCounter}`,
  user_type: 'internal',
  first_name: 'Glinda',
  last_name: 'Good',
  username: 'glinda',
  email: 'glinda@emeraldcity.oz',
  tenant: ctx.tenant,
});

const validInput = {
  category: 'bug' as const,
  subject: 'Invoices will not finalize',
  description: 'Finalizing an invoice spins forever and never completes at all.',
  pageUrl: '/msp/billing',
};

const fetchMock = vi.fn<typeof fetch>();

const intakeAccepted = (ticketNumber = 'alga-2026-0003329') =>
  new Response(JSON.stringify({ ok: true, ticketNumber }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const intakeFailed = (status: number) =>
  new Response(JSON.stringify({ ok: false, error: 'boom' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function lastIntakeRequest() {
  const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { headers: init.headers as Record<string, string>, body: init.body as string };
}

describe('submitVendorSupportRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isConfigured.mockResolvedValue(true);
    mocks.isSelfHostLicensing.mockResolvedValue(false);
    mocks.tenantFirst.mockResolvedValue({ client_name: 'Emerald City MSP' });
    mocks.sendVendorSupportRequestEmail.mockResolvedValue(undefined);
    mocks.getAppSecret.mockResolvedValue(undefined);
    // The intake endpoint is the primary transport; the default here is the
    // pre-launch world where it is unreachable and email carries the request.
    fetchMock.mockResolvedValue(intakeFailed(503));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects invalid input without sending', async () => {
    const user = makeUser();

    expect(await rawSubmit(user, ctx, { ...validInput, subject: 'no' }))
      .toEqual({ success: false, error: 'invalid_input' });
    expect(await rawSubmit(user, ctx, { ...validInput, description: 'too short' }))
      .toEqual({ success: false, error: 'invalid_input' });
    expect(await rawSubmit(user, ctx, { ...validInput, category: 'rant' }))
      .toEqual({ success: false, error: 'invalid_input' });
    expect(await rawSubmit(user, ctx, { ...validInput, subject: 'x'.repeat(121) }))
      .toEqual({ success: false, error: 'invalid_input' });
    expect(await rawSubmit(user, ctx, { ...validInput, description: 'y'.repeat(5001) }))
      .toEqual({ success: false, error: 'invalid_input' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.sendVendorSupportRequestEmail).not.toHaveBeenCalled();
  });

  it('creates the ticket through the intake API without sending email', async () => {
    fetchMock.mockResolvedValue(intakeAccepted());
    const user = makeUser();

    expect(await rawSubmit(user, ctx, validInput))
      .toEqual({ success: true, ticketNumber: 'alga-2026-0003329' });

    expect(mocks.sendVendorSupportRequestEmail).not.toHaveBeenCalled();
    expect(JSON.parse(lastIntakeRequest().body)).toEqual({
      source: 'in_app',
      tenantId: ctx.tenant,
      tenantName: 'Emerald City MSP',
      userName: 'Glinda Good',
      userEmail: 'glinda@emeraldcity.oz',
      category: 'bug',
      subject: validInput.subject,
      description: validInput.description,
      edition: process.env.NEXT_PUBLIC_EDITION === 'enterprise' ? 'EE' : 'CE',
      onPrem: false,
      appVersion: '9.9.9',
      pageUrl: '/msp/billing',
    });

    // The limiter is armed by an API success just as it is by a sent email.
    expect(await rawSubmit(user, ctx, validInput)).toEqual({ success: false, error: 'rate_limited' });
  });

  it('succeeds through the intake API even when email is unconfigured', async () => {
    fetchMock.mockResolvedValue(intakeAccepted('alga-2026-0003330'));
    mocks.isConfigured.mockResolvedValue(false);

    expect(await rawSubmit(makeUser(), ctx, validInput))
      .toEqual({ success: true, ticketNumber: 'alga-2026-0003330' });
    expect(mocks.sendVendorSupportRequestEmail).not.toHaveBeenCalled();
  });

  it('omits the ticket number when the API does not return one', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    expect(await rawSubmit(makeUser(), ctx, validInput)).toEqual({ success: true });
  });

  it('sends the request unsigned when no signing secret is provisioned', async () => {
    fetchMock.mockResolvedValue(intakeAccepted());

    expect(await rawSubmit(makeUser(), ctx, validInput))
      .toEqual({ success: true, ticketNumber: 'alga-2026-0003329' });
    expect(lastIntakeRequest().headers[INTAKE_SIGNATURE_HEADER]).toBeUndefined();
  });

  it('signs the request when a signing secret is provisioned', async () => {
    fetchMock.mockResolvedValue(intakeAccepted());
    mocks.getAppSecret.mockResolvedValue('hosted-intake-secret');

    expect(await rawSubmit(makeUser(), ctx, validInput))
      .toEqual({ success: true, ticketNumber: 'alga-2026-0003329' });

    const { headers, body } = lastIntakeRequest();
    const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(headers[INTAKE_SIGNATURE_HEADER]);
    expect(match).not.toBeNull();

    const [, timestamp, signature] = match!;
    expect(Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp))).toBeLessThan(300);
    expect(signature).toBe(
      crypto.createHmac('sha256', 'hosted-intake-secret').update(`${timestamp}.${body}`, 'utf8').digest('hex'),
    );
  });

  it('falls back to email when the intake API returns 500', async () => {
    fetchMock.mockResolvedValue(intakeFailed(500));

    expect(await rawSubmit(makeUser(), ctx, validInput)).toEqual({ success: true });
    expect(mocks.sendVendorSupportRequestEmail).toHaveBeenCalledOnce();
  });

  it('falls back to email when the intake request times out or the network fails', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    fetchMock.mockRejectedValueOnce(timeout);

    expect(await rawSubmit(makeUser(), ctx, validInput)).toEqual({ success: true });

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await rawSubmit(makeUser(), ctx, validInput)).toEqual({ success: true });

    expect(mocks.sendVendorSupportRequestEmail).toHaveBeenCalledTimes(2);
  });

  it('rate-limits a second submission from the same user', async () => {
    const user = makeUser();

    expect(await rawSubmit(user, ctx, validInput)).toEqual({ success: true });
    expect(await rawSubmit(user, ctx, validInput)).toEqual({ success: false, error: 'rate_limited' });
    expect(mocks.sendVendorSupportRequestEmail).toHaveBeenCalledOnce();
  });

  it('returns email_not_configured only when the API failed and email is unconfigured', async () => {
    mocks.isConfigured.mockResolvedValue(false);

    expect(await rawSubmit(makeUser(), ctx, validInput))
      .toEqual({ success: false, error: 'email_not_configured' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.sendVendorSupportRequestEmail).not.toHaveBeenCalled();
  });

  it('maps a send failure to send_failed and leaves the limiter free to retry', async () => {
    const user = makeUser();
    mocks.sendVendorSupportRequestEmail.mockRejectedValueOnce(new Error('smtp down'));

    expect(await rawSubmit(user, ctx, validInput)).toEqual({ success: false, error: 'send_failed' });

    // A provider rejection reaches the action as a throw as well: sendEmail
    // resolves { success: false } and sendVendorSupportRequestEmail raises it
    // (see packages/email/src/__tests__/sendVendorSupportRequestEmail.test.ts).
    mocks.sendVendorSupportRequestEmail.mockRejectedValueOnce(new Error('SMTP 535 authentication failed'));
    expect(await rawSubmit(user, ctx, validInput)).toEqual({ success: false, error: 'send_failed' });

    expect(await rawSubmit(user, ctx, validInput)).toEqual({ success: true });
  });

  it('forwards tenant, user, edition and page context to the email builder', async () => {
    mocks.isSelfHostLicensing.mockResolvedValue(true);
    const user = makeUser();

    expect(await rawSubmit(user, ctx, validInput)).toEqual({ success: true });

    expect(mocks.sendVendorSupportRequestEmail).toHaveBeenCalledWith({
      tenantName: 'Emerald City MSP',
      tenantId: ctx.tenant,
      userName: 'Glinda Good',
      userEmail: 'glinda@emeraldcity.oz',
      category: 'bug',
      subject: validInput.subject,
      description: validInput.description,
      edition: process.env.NEXT_PUBLIC_EDITION === 'enterprise' ? 'EE' : 'CE',
      isOnPrem: true,
      appVersion: '9.9.9',
      pageUrl: '/msp/billing',
    });
  });
});
