import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  hasPermission: vi.fn(),
  getTenantEmailSettings: vi.fn(),
  testConnection: vi.fn(),
  runDiagnostics: vi.fn(),
  invalidate: vi.fn(),
  tableCalls: [] as string[],
  sessionUser: { user_id: 'user-1', user_type: 'internal' as 'internal' | 'client', tenant: 'tenant-123' },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  tenantDb: () => ({
    table: (table: string) => {
      mocks.tableCalls.push(table);
      throw new Error(`unexpected DB access: ${table}`);
    },
  }),
}));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => async (...args: any[]) =>
    fn({ ...mocks.sessionUser }, { tenant: mocks.sessionUser.tenant }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@alga-psa/email', () => ({
  TenantEmailService: {
    getTenantEmailSettings: mocks.getTenantEmailSettings,
    invalidateTenantSettings: mocks.invalidate,
    testConnection: mocks.testConnection,
  },
  resolveTenantCompanyName: vi.fn(async () => 'MSP'),
  resolveDefaultFromAddress: vi.fn(() => ({ email: 'n@example.test' })),
  runOutboundEmailDiagnostics: mocks.runDiagnostics,
}));
vi.mock('@alga-psa/email/providerConfig', () => ({ createDefaultProviderConfig: vi.fn() }));

// Grants exactly the listed "resource:action" permissions.
function grant(...perms: string[]) {
  mocks.hasPermission.mockImplementation(async (_u: any, resource: string, action: string) =>
    perms.includes(`${resource}:${action}`));
}

const liveReport = (status: 'pass' | 'fail', message?: string) => ({
  steps: [{ id: 'live_send_test', status, ...(message ? { error: { message } } : {}) }],
});

beforeEach(() => {
  vi.clearAllMocks();
  // Not a vi.fn, so clearAllMocks leaves it; stale entries break order-shuffled runs.
  mocks.tableCalls.length = 0;
  mocks.createTenantKnex.mockResolvedValue({ knex: {} });
  mocks.sessionUser.user_type = 'internal';
  mocks.testConnection.mockResolvedValue({ success: true, message: 'SMTP connection verified.' });
  mocks.invalidate.mockResolvedValue(undefined);
  grant('ticket_settings:update');
});

describe('updateEmailSettings authorization', () => {
  it('rejects a client user holding settings:update before any settings read or write', async () => {
    mocks.sessionUser.user_type = 'client';
    grant('settings:update', 'ticket_settings:update');

    const { updateEmailSettings } = await import('./emailSettingsActions');
    const result: any = await updateEmailSettings({ defaultFromDomain: 'x.test' });

    expect(result).toMatchObject({ actionError: expect.any(String), messageKey: 'errors.permissionDenied' });
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    expect(mocks.getTenantEmailSettings).not.toHaveBeenCalled();
    expect(mocks.tableCalls).toEqual([]);
  });

  it('rejects an MSP user with settings:update but without ticket_settings:update', async () => {
    grant('settings:update');

    const { updateEmailSettings } = await import('./emailSettingsActions');
    const result: any = await updateEmailSettings({ defaultFromDomain: 'x.test' });

    expect(result).toMatchObject({ actionError: expect.any(String), messageKey: 'errors.permissionDenied' });
    expect(mocks.getTenantEmailSettings).not.toHaveBeenCalled();
    expect(mocks.tableCalls).toEqual([]);
  });

  it('lets an MSP user with ticket_settings:update past the gate', async () => {
    mocks.getTenantEmailSettings.mockResolvedValue(null);

    const { updateEmailSettings } = await import('./emailSettingsActions');
    await updateEmailSettings({ defaultFromDomain: 'x.test' }).catch(() => undefined);

    expect(mocks.hasPermission).toHaveBeenCalledWith(expect.anything(), 'ticket_settings', 'update', expect.anything());
    expect(mocks.getTenantEmailSettings).toHaveBeenCalled();
  });
});

describe('testOutboundEmail authorization and routing', () => {
  it('rejects client users before any permission lookup or send', async () => {
    mocks.sessionUser.user_type = 'client';

    const { testOutboundEmail } = await import('./emailSettingsActions');
    const result = await testOutboundEmail('victim@example.com');

    expect(result).toEqual({ success: false, error: 'Permission denied' });
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    expect(mocks.testConnection).not.toHaveBeenCalled();
    expect(mocks.runDiagnostics).not.toHaveBeenCalled();
  });

  it('rejects an MSP user without ticket_settings:update', async () => {
    grant();

    const { testOutboundEmail } = await import('./emailSettingsActions');
    const result = await testOutboundEmail('victim@example.com');

    expect(result).toEqual({ success: false, error: 'Permission denied: Cannot manage outbound email' });
    expect(mocks.testConnection).not.toHaveBeenCalled();
    expect(mocks.runDiagnostics).not.toHaveBeenCalled();
  });

  it('rejects an invalid recipient without sending', async () => {
    const { testOutboundEmail } = await import('./emailSettingsActions');
    const result = await testOutboundEmail('not-an-email');

    expect(result.success).toBe(false);
    expect(mocks.runDiagnostics).not.toHaveBeenCalled();
    expect(mocks.testConnection).not.toHaveBeenCalled();
  });

  it('routes a valid recipient through diagnostics live-send with the acting user', async () => {
    mocks.runDiagnostics.mockResolvedValue(liveReport('pass'));

    const { testOutboundEmail } = await import('./emailSettingsActions');
    const result = await testOutboundEmail(' admin@example.com ');

    expect(result).toMatchObject({ success: true });
    expect(mocks.runDiagnostics).toHaveBeenCalledWith({
      tenant: 'tenant-123',
      knex: expect.anything(),
      options: { liveSendTest: true, recipient: 'admin@example.com', actingUserId: 'user-1' },
    });
    expect(mocks.testConnection).not.toHaveBeenCalled();
  });

  it('maps a failed live send to the diagnostics redacted error text', async () => {
    mocks.runDiagnostics.mockResolvedValue(liveReport('fail', 'Tenant is suspended; outbound email is disabled'));

    const { testOutboundEmail } = await import('./emailSettingsActions');
    const result = await testOutboundEmail('admin@example.com');

    expect(result).toEqual({ success: false, error: 'Tenant is suspended; outbound email is disabled' });
  });

  it('verifies configuration only when no recipient is given', async () => {
    const { testOutboundEmail } = await import('./emailSettingsActions');
    const result = await testOutboundEmail(undefined);

    expect(result).toEqual({ success: true, message: 'SMTP connection verified.' });
    expect(mocks.testConnection).toHaveBeenCalledWith('tenant-123');
    expect(mocks.runDiagnostics).not.toHaveBeenCalled();
  });
});
