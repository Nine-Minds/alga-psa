import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  hasPermission: vi.fn(),
  sessionUser: { user_id: 'user-1', user_type: 'internal' as 'internal' | 'client' },
  tableCalls: [] as string[],
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  tenantDb: () => ({
    table: (name: string) => {
      mocks.tableCalls.push(name);
      throw new Error(`unexpected provider data access: ${name}`);
    },
  }),
  auditLog: vi.fn(),
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...args: any[]) => unknown) => (...args: any[]) =>
    fn({ ...mocks.sessionUser }, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));

const providerData = {
  tenant: 'tenant-1', providerType: 'imap', providerName: 'Mailbox', mailbox: 'a@example.test', isActive: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tableCalls.length = 0;
  mocks.sessionUser.user_type = 'internal';
  mocks.createTenantKnex.mockResolvedValue({ knex: {} });
  mocks.hasPermission.mockResolvedValue(false);
});

describe('email provider action authorization', () => {
  it('rejects clients before permission lookup or any provider data access across all ten actions', async () => {
    mocks.sessionUser.user_type = 'client';
    const actions = await import('./emailProviderActions');
    const calls: Array<Promise<unknown>> = [
      actions.getEmailProviders(),
      actions.upsertEmailProvider(providerData as any, true),
      actions.createEmailProvider(providerData as any, true),
      actions.updateEmailProvider('provider-1', providerData as any, true),
      actions.deleteEmailProvider('provider-1'),
      actions.resyncImapProvider('provider-1'),
      actions.testEmailProviderConnection('provider-1'),
      actions.retryMicrosoftSubscriptionRenewal('provider-1'),
      actions.runGmailDiagnostics('provider-1'),
      actions.runMicrosoft365Diagnostics('provider-1'),
    ];
    const results = await Promise.all(calls);

    expect(results[0]).toEqual({ providers: [] });
    expect(results.slice(1, 5)).toEqual(Array.from({ length: 4 }, () =>
      expect.objectContaining({ actionError: expect.any(String), messageKey: 'errors.permissionDenied' })
    ));
    expect(results[5]).toEqual({ success: false, error: 'Permission denied', errorCode: 'unexpected' });
    expect(results[6]).toEqual({ success: false, error: 'Permission denied', errorCode: 'unexpected' });
    expect(results[7]).toEqual({ success: false, message: 'Permission denied' });
    expect(results[8]).toEqual({ success: false, error: 'Permission denied' });
    expect(results[9]).toEqual({ success: false, error: 'Permission denied' });
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    expect(mocks.tableCalls).toEqual([]);
  });

  it('rejects MSP users without ticket_settings:update before provider data access', async () => {
    const actions = await import('./emailProviderActions');
    const results = await Promise.all([
      actions.getEmailProviders(),
      actions.upsertEmailProvider(providerData as any, true),
      actions.createEmailProvider(providerData as any, true),
      actions.updateEmailProvider('provider-1', providerData as any, true),
      actions.deleteEmailProvider('provider-1'),
      actions.resyncImapProvider('provider-1'),
      actions.testEmailProviderConnection('provider-1'),
      actions.retryMicrosoftSubscriptionRenewal('provider-1'),
      actions.runGmailDiagnostics('provider-1'),
      actions.runMicrosoft365Diagnostics('provider-1'),
    ]);

    expect(results[0]).toEqual({ providers: [] });
    expect(results.slice(1, 5).every((result: any) => result.messageKey === 'errors.permissionDenied')).toBe(true);
    expect(results.slice(5, 7).every((result: any) => result.errorCode === 'unexpected')).toBe(true);
    expect(results[7]).toEqual({ success: false, message: 'Permission denied: Cannot manage outbound email' });
    expect(results[8]).toEqual({ success: false, error: 'Permission denied: Cannot manage outbound email' });
    expect(results[9]).toEqual({ success: false, error: 'Permission denied: Cannot manage outbound email' });
    expect(mocks.hasPermission).toHaveBeenCalledTimes(10);
    expect(mocks.hasPermission).toHaveBeenCalledWith(expect.anything(), 'ticket_settings', 'update', expect.anything());
    expect(mocks.tableCalls).toEqual([]);
  });

  it('lets an authorized MSP caller reach provider data access', async () => {
    mocks.hasPermission.mockResolvedValue(true);
    const actions = await import('./emailProviderActions');

    await expect(actions.resyncImapProvider('provider-1')).rejects.toThrow('unexpected provider data access');
    expect(mocks.hasPermission).toHaveBeenCalledWith(expect.anything(), 'ticket_settings', 'update', expect.anything());
    expect(mocks.tableCalls).toEqual(['email_providers']);
  });
});
