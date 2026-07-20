import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  aiGatewayFetchAccount: vi.fn(),
  aiGatewayGrantConsent: vi.fn(),
  aiGatewayRevokeConsent: vi.fn(),
  checkAccountManagementPermission: vi.fn(),
  getSession: vi.fn(),
  isSelfHostLicensing: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  getSession: mocks.getSession,
}));

vi.mock('@alga-psa/auth/actions', () => ({
  checkAccountManagementPermission: mocks.checkAccountManagementPermission,
}));

vi.mock('@alga-psa/licensing', () => ({
  isSelfHostLicensing: mocks.isSelfHostLicensing,
}));

vi.mock('../../lib/aiGateway/client', () => ({
  aiGatewayFetchAccount: mocks.aiGatewayFetchAccount,
  aiGatewayGrantConsent: mocks.aiGatewayGrantConsent,
  aiGatewayRevokeConsent: mocks.aiGatewayRevokeConsent,
}));

const actions = await import('../../lib/actions/aiConsentActions');

describe('AI consent actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: {
        tenant: 'tenant-appliance',
        email: 'admin@example.test',
        username: 'appliance-admin',
      },
    });
    mocks.isSelfHostLicensing.mockResolvedValue(true);
    mocks.checkAccountManagementPermission.mockResolvedValue(true);
    mocks.aiGatewayFetchAccount.mockResolvedValue({
      consentStatus: 'granted',
    });
    mocks.aiGatewayGrantConsent.mockResolvedValue(undefined);
    mocks.aiGatewayRevokeConsent.mockResolvedValue(undefined);
  });

  it('exports only the consent action contract', () => {
    expect(Object.keys(actions).sort()).toEqual([
      'getAiConsentStatus',
      'grantAiConsent',
      'revokeAiConsent',
    ]);
  });

  it('returns gateway consent status with pending detail fields', async () => {
    await expect(actions.getAiConsentStatus()).resolves.toEqual({
      status: 'granted',
      termsVersion: null,
      grantedAt: null,
    });
    expect(mocks.aiGatewayFetchAccount).toHaveBeenCalledWith('tenant-appliance');
    expect(mocks.checkAccountManagementPermission).not.toHaveBeenCalled();
  });

  it('surfaces an unreachable gateway account error', async () => {
    mocks.aiGatewayFetchAccount.mockRejectedValue(new Error('gateway unavailable'));

    await expect(actions.getAiConsentStatus()).rejects.toThrow('gateway unavailable');
  });

  it('grants consent with the session email and normalized terms version', async () => {
    await actions.grantAiConsent(' 2026-07 ');

    expect(mocks.checkAccountManagementPermission).toHaveBeenCalledOnce();
    expect(mocks.aiGatewayGrantConsent).toHaveBeenCalledWith(
      'tenant-appliance',
      'admin@example.test',
      '2026-07',
    );
  });

  it('falls back to the session username as the consent identity', async () => {
    mocks.getSession.mockResolvedValue({
      user: {
        tenant: 'tenant-appliance',
        email: '',
        username: 'appliance-admin',
      },
    });

    await actions.grantAiConsent('2026-07');

    expect(mocks.aiGatewayGrantConsent).toHaveBeenCalledWith(
      'tenant-appliance',
      'appliance-admin',
      '2026-07',
    );
  });

  it('revokes consent for the session tenant', async () => {
    await actions.revokeAiConsent();

    expect(mocks.checkAccountManagementPermission).toHaveBeenCalledOnce();
    expect(mocks.aiGatewayRevokeConsent).toHaveBeenCalledWith('tenant-appliance');
  });

  it('rejects consent mutations without account-management permission', async () => {
    mocks.checkAccountManagementPermission.mockResolvedValue(false);

    await expect(actions.grantAiConsent('2026-07')).rejects.toThrow(
      'You do not have permission to manage AI consent',
    );
    await expect(actions.revokeAiConsent()).rejects.toThrow(
      'You do not have permission to manage AI consent',
    );
    expect(mocks.aiGatewayGrantConsent).not.toHaveBeenCalled();
    expect(mocks.aiGatewayRevokeConsent).not.toHaveBeenCalled();
  });

  it('rejects the consent flow on hosted installs', async () => {
    mocks.isSelfHostLicensing.mockResolvedValue(false);

    await expect(actions.getAiConsentStatus()).rejects.toThrow(
      'AI consent is only available on self-hosted appliance installs',
    );
    await expect(actions.grantAiConsent('2026-07')).rejects.toThrow(
      'AI consent is only available on self-hosted appliance installs',
    );
    await expect(actions.revokeAiConsent()).rejects.toThrow(
      'AI consent is only available on self-hosted appliance installs',
    );
  });
});
