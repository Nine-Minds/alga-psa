import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendVendorSupportRequestEmail: vi.fn(),
  isConfigured: vi.fn(),
  isSelfHostLicensing: vi.fn(),
  tenantFirst: vi.fn(),
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

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-1' })),
  tenantDb: () => ({
    table: () => ({ first: mocks.tenantFirst }),
  }),
}));

vi.mock('@/lib/utils/version', () => ({
  getAppVersion: () => '9.9.9',
}));

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

describe('submitVendorSupportRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isConfigured.mockResolvedValue(true);
    mocks.isSelfHostLicensing.mockResolvedValue(false);
    mocks.tenantFirst.mockResolvedValue({ client_name: 'Emerald City MSP' });
    mocks.sendVendorSupportRequestEmail.mockResolvedValue(undefined);
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

    expect(mocks.sendVendorSupportRequestEmail).not.toHaveBeenCalled();
  });

  it('rate-limits a second submission from the same user', async () => {
    const user = makeUser();

    expect(await rawSubmit(user, ctx, validInput)).toEqual({ success: true });
    expect(await rawSubmit(user, ctx, validInput)).toEqual({ success: false, error: 'rate_limited' });
    expect(mocks.sendVendorSupportRequestEmail).toHaveBeenCalledOnce();
  });

  it('maps an unconfigured system email provider to email_not_configured', async () => {
    mocks.isConfigured.mockResolvedValue(false);

    expect(await rawSubmit(makeUser(), ctx, validInput))
      .toEqual({ success: false, error: 'email_not_configured' });
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
