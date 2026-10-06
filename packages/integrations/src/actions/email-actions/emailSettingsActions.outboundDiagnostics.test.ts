import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createTenantKnexMock,
  runDiagnosticsMock,
  hasPermissionMock,
  sessionUser,
} = vi.hoisted(() => ({
  createTenantKnexMock: vi.fn(),
  runDiagnosticsMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  sessionUser: {
    user_id: 'user-1',
    user_type: 'internal' as 'internal' | 'client',
    tenant: 'tenant-123',
  },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => conn(table).where({ tenant }),
  }),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => async (...args: any[]) =>
    fn({ ...sessionUser }, { tenant: sessionUser.tenant }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock,
}));

vi.mock('@alga-psa/email', () => ({
  TenantEmailService: {
    getTenantEmailSettings: vi.fn(),
    invalidateTenantSettings: vi.fn(),
  },
  resolveTenantCompanyName: vi.fn(async () => 'Example MSP'),
  resolveDefaultFromAddress: vi.fn(() => ({ email: 'notifications@example.test', name: 'Example MSP' })),
  runOutboundEmailDiagnostics: runDiagnosticsMock,
}));

vi.mock('@alga-psa/email/providerConfig', () => ({
  createDefaultProviderConfig: (providerType: string, { isEnabled }: { isEnabled: boolean }) => ({
    providerId: `${providerType}-provider`,
    providerType,
    isEnabled,
    config: {},
  }),
}));

describe('runOutboundEmailDiagnostics action authorization', () => {
  beforeEach(() => {
    createTenantKnexMock.mockReset().mockResolvedValue({ knex: {} });
    runDiagnosticsMock.mockReset().mockResolvedValue({
      createdAt: '2026-09-13T00:00:00.000Z',
      summary: { providerType: 'smtp', checkedCapabilities: [], liveSendRequested: false, liveSendPerformed: false, overallStatus: 'pass' },
      steps: [],
      recommendations: [],
      supportBundle: {},
    });
    hasPermissionMock.mockReset().mockResolvedValue(true);
    sessionUser.user_type = 'internal';
  });

  it('rejects client-portal callers before any tenant read or provider work', async () => {
    sessionUser.user_type = 'client';

    const { runOutboundEmailDiagnostics } = await import('./emailSettingsActions');
    const result = await runOutboundEmailDiagnostics({});

    expect(result).toEqual({ success: false, error: 'Permission denied' });
    expect(createTenantKnexMock).not.toHaveBeenCalled();
    expect(runDiagnosticsMock).not.toHaveBeenCalled();
  });

  it('requires the email-settings management permission before reads or network', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const { runOutboundEmailDiagnostics } = await import('./emailSettingsActions');
    const result = await runOutboundEmailDiagnostics({});

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Permission denied/);
    expect(createTenantKnexMock).toHaveBeenCalledTimes(1);
    expect(runDiagnosticsMock).not.toHaveBeenCalled();
  });

  it('rejects live send with a missing or invalid recipient before invoking the runner', async () => {
    const { runOutboundEmailDiagnostics } = await import('./emailSettingsActions');

    const missing = await runOutboundEmailDiagnostics({ liveSendTest: true });
    expect(missing.success).toBe(false);
    expect(runDiagnosticsMock).not.toHaveBeenCalled();

    const invalid = await runOutboundEmailDiagnostics({ liveSendTest: true, recipient: 'not-an-email' });
    expect(invalid.success).toBe(false);
    expect(runDiagnosticsMock).not.toHaveBeenCalled();
  });

  it('derives the tenant from the session and forwards validated options', async () => {
    const { runOutboundEmailDiagnostics } = await import('./emailSettingsActions');
    const result = await runOutboundEmailDiagnostics({
      liveSendTest: true,
      recipient: 'admin@example.test',
      includeIdentifiers: true,
    });

    expect(hasPermissionMock).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1' }), 'ticket_settings', 'update', expect.anything());
    expect(runDiagnosticsMock).toHaveBeenCalledWith({
      tenant: 'tenant-123',
      knex: expect.anything(),
      options: { liveSendTest: true, recipient: 'admin@example.test', includeIdentifiers: true },
    });
    expect(result.success).toBe(true);
    expect(result.report).toBeDefined();
  });
});
