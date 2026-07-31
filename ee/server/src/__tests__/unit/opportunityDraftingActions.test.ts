import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  hasPermission: vi.fn(),
  logDraftSentData: vi.fn(),
  recipient: null as null | {
    opportunity_id: string;
    client_id: string;
    contact_id: string | null;
    email: string | null;
  },
  sendEmail: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (handler: (...args: any[]) => any) => (...args: any[]) => handler(
    { user_id: 'user-a' },
    { tenant: 'tenant-1' },
    ...args,
  ),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: mocks.hasPermission,
}));

vi.mock('@alga-psa/email', () => ({
  TenantEmailService: {
    getInstance: () => ({ sendEmail: mocks.sendEmail }),
  },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn().mockResolvedValue({ knex: {} }),
  tenantDb: () => ({
    table: () => ({
      where() { return this; },
      select() { return this; },
      first: async () => mocks.recipient,
    }),
    tenantJoin: vi.fn(),
  }),
  withTransaction: async (_knex: unknown, callback: (trx: unknown) => unknown) => callback({}),
}));

vi.mock('../../lib/opportunities/draftingAccess', () => ({
  assertOpportunityDraftingAccess: mocks.assertAccess,
}));

vi.mock('../../lib/opportunities/drafting', () => ({
  deleteOpportunityVoiceProfileData: vi.fn(),
  generateFollowUpDraftData: vi.fn(),
  getOpportunityVoiceProfileData: vi.fn(),
  logDraftSentData: mocks.logDraftSentData,
  saveOpportunityVoiceProfileData: vi.fn(),
}));

import { sendOpportunityFollowUp } from '../../lib/opportunities/draftingActions';

const opportunityId = '11111111-1111-4111-8111-111111111111';

describe('sendOpportunityFollowUp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasPermission.mockResolvedValue(true);
    mocks.recipient = {
      opportunity_id: opportunityId,
      client_id: '22222222-2222-4222-8222-222222222222',
      contact_id: '33333333-3333-4333-8333-333333333333',
      email: ' buyer@example.com ',
    };
  });

  it('does not log a sent interaction when the outbound provider rejects the email', async () => {
    mocks.sendEmail.mockResolvedValue({ success: false, error: 'SMTP unavailable' });

    await expect(sendOpportunityFollowUp(opportunityId, {
      subject: 'Reviewed proposal',
      body: 'Hello from the reviewed draft.',
    })).rejects.toThrow('SMTP unavailable');

    expect(mocks.sendEmail).toHaveBeenCalledOnce();
    expect(mocks.logDraftSentData).not.toHaveBeenCalled();
  });

  it('logs the interaction only after the provider confirms the send', async () => {
    mocks.sendEmail.mockResolvedValue({
      success: true,
      rfcMessageId: '<greenmail-message@example.com>',
    });

    await expect(sendOpportunityFollowUp(opportunityId, {
      subject: 'Reviewed proposal',
      body: 'Hello from the reviewed draft.',
    })).resolves.toEqual({
      recipient: 'buyer@example.com',
      messageId: '<greenmail-message@example.com>',
    });

    expect(mocks.sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      to: ['buyer@example.com'],
      subject: 'Reviewed proposal',
      entityType: 'opportunity',
      entityId: opportunityId,
      contactId: '33333333-3333-4333-8333-333333333333',
      userId: 'user-a',
    }));
    expect(mocks.logDraftSentData).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      opportunityId,
      'user-a',
      {
        subject: 'Reviewed proposal',
        summary: 'To: buyer@example.com\nMessage-ID: <greenmail-message@example.com>\n\nHello from the reviewed draft.',
      },
    );
    expect(mocks.sendEmail.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.logDraftSentData.mock.invocationCallOrder[0]);
  });

  it('rejects an opportunity whose linked contact has no primary email', async () => {
    mocks.recipient = { ...mocks.recipient!, email: null };

    await expect(sendOpportunityFollowUp(opportunityId, {
      subject: 'Reviewed proposal',
      body: 'Hello from the reviewed draft.',
    })).rejects.toThrow('linked contact has no primary email address');

    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.logDraftSentData).not.toHaveBeenCalled();
  });
});
