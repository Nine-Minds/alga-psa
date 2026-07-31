import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createTenantKnexMock,
  isSelfHostLicensingMock,
  assertHostedInstallMock,
} = vi.hoisted(() => ({
  createTenantKnexMock: vi.fn(),
  isSelfHostLicensingMock: vi.fn(async () => false),
  assertHostedInstallMock: vi.fn(async () => {}),
}));

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => async (...args: any[]) => fn({ id: 'user-1', user_type: 'internal', roles: [] }, { tenant: 'tenant-123' }, ...args),
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/licensing', () => ({
  assertHostedInstall: (...args: unknown[]) => assertHostedInstallMock(...args),
  isSelfHostLicensing: () => isSelfHostLicensingMock(),
}));

vi.mock('@/lib/email-domains/workflowClient', () => ({
  enqueueManagedEmailDomainWorkflow: vi.fn(async () => ({ enqueued: true, alreadyRunning: false })),
}));

vi.mock('server/src/lib/observability/logging', () => ({
  observabilityLogger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('managed domain hosting guard', () => {
  beforeEach(() => {
    vi.resetModules();
    createTenantKnexMock.mockReset();
    isSelfHostLicensingMock.mockReset();
    isSelfHostLicensingMock.mockResolvedValue(false);
    assertHostedInstallMock.mockReset();
    assertHostedInstallMock.mockResolvedValue(undefined);
  });

  it('returns no managed domains on self-host without opening the tenant database', async () => {
    isSelfHostLicensingMock.mockResolvedValue(true);

    const { getManagedEmailDomains } = await import('@/lib/actions/email-actions/managedDomainActions');
    const result = await getManagedEmailDomains();

    expect(result).toEqual([]);
    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });

  it('blocks managed-domain mutations on self-host before tenant data access', async () => {
    const hostingError = Object.assign(
      new Error('Managed email is only available on hosted installs.'),
      { name: 'HostingRequiredError', statusCode: 403, code: 'HOSTING_REQUIRED' }
    );
    assertHostedInstallMock.mockRejectedValue(hostingError);

    const { requestManagedEmailDomain } = await import('@/lib/actions/email-actions/managedDomainActions');

    await expect(requestManagedEmailDomain('example.com')).rejects.toMatchObject({
      code: 'HOSTING_REQUIRED',
      statusCode: 403,
    });
    expect(assertHostedInstallMock).toHaveBeenCalledWith('Managed email');
    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });
});
