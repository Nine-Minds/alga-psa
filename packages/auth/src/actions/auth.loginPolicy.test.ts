import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUserByEmailAndTypeMock = vi.fn();
const findUsersByEmailAndTypeMock = vi.fn();
const verifyPasswordMock = vi.fn();
const loadTenantAuthPolicyMock = vi.fn();
const recordLoginRefusalMock = vi.fn();
const listBreakGlassCandidatesMock = vi.fn();

vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    findUserByEmailTenantAndType: vi.fn(),
    findUserByEmailAndType: (...args: unknown[]) => findUserByEmailAndTypeMock(...args),
    findUsersByEmailAndType: (...args: unknown[]) => findUsersByEmailAndTypeMock(...args),
    findUserByEmail: vi.fn(),
  },
}));
vi.mock('@alga-psa/db', () => ({ getTenantIdBySlug: vi.fn() }));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: async () => ({}) }));
vi.mock('../lib/PortalDomainModel', () => ({ getPortalDomainByHostname: vi.fn() }));
vi.mock('@alga-psa/core/encryption', () => ({
  verifyPassword: (...args: unknown[]) => verifyPasswordMock(...args),
}));
vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), system: vi.fn() },
}));
vi.mock('@alga-psa/core/features', () => ({ isEnterprise: false }));
vi.mock('../lib/winback/enterpriseWinbackEntry', () => ({
  loadEnterpriseInactiveLoginWinbackHook: async () => null,
}));
vi.mock('../lib/authPolicyStore', () => ({
  loadTenantAuthPolicy: (...args: unknown[]) => loadTenantAuthPolicyMock(...args),
  recordLoginRefusal: (...args: unknown[]) => recordLoginRefusalMock(...args),
  listBreakGlassCandidates: (...args: unknown[]) => listBreakGlassCandidatesMock(...args),
}));

import { authenticateUser } from './auth';

const TENANT = '11111111-1111-1111-1111-111111111111';
const OFF = {
  requireSsoForInternalUsers: false,
  require2faForInternalUsers: false,
  require2faForClientUsers: false,
  allowKnownDevice2faSkip: false,
  passwordBreakGlassUserIds: [] as string[],
  passwordAuthDisabledAt: null as string | null,
};

function user(userType: 'internal' | 'client', over: Record<string, unknown> = {}) {
  return {
    user_id: 'u1',
    email: 'pat@example.com',
    username: 'pat@example.com',
    hashed_password: 'hash',
    tenant: TENANT,
    user_type: userType,
    is_inactive: false,
    two_factor_enabled: false,
    ...over,
  };
}

describe('authenticateUser login policy gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyPasswordMock.mockResolvedValue(true);
  });

  it('with default settings behaves exactly as before (returns the user, audits nothing)', async () => {
    loadTenantAuthPolicyMock.mockResolvedValue(OFF);
    findUserByEmailAndTypeMock.mockResolvedValue(user('internal'));
    await expect(authenticateUser('pat@example.com', 'pw', 'internal')).resolves.toMatchObject({ user_id: 'u1' });
    expect(recordLoginRefusalMock).not.toHaveBeenCalled();
  });

  it('refuses an internal password login when SSO is required, with an audit record', async () => {
    loadTenantAuthPolicyMock.mockResolvedValue({ ...OFF, requireSsoForInternalUsers: true, passwordBreakGlassUserIds: ['bg'] });
    findUserByEmailAndTypeMock.mockResolvedValue(user('internal'));
    await expect(authenticateUser('pat@example.com', 'pw', 'internal')).rejects.toMatchObject({ code: 'SSO_REQUIRED' });
    expect(recordLoginRefusalMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenant: TENANT, userId: 'u1', reason: 'sso_required', surface: 'msp_login' }),
    );
  });

  it('does not reveal the SSO requirement when the password is wrong', async () => {
    loadTenantAuthPolicyMock.mockResolvedValue({ ...OFF, requireSsoForInternalUsers: true });
    findUserByEmailAndTypeMock.mockResolvedValue(user('internal'));
    verifyPasswordMock.mockResolvedValue(false);
    await expect(authenticateUser('pat@example.com', 'bad', 'internal')).resolves.toBeNull();
    expect(recordLoginRefusalMock).not.toHaveBeenCalled();
  });

  it('lets a break-glass user past the SSO denial', async () => {
    loadTenantAuthPolicyMock.mockResolvedValue({ ...OFF, requireSsoForInternalUsers: true, passwordBreakGlassUserIds: ['u1'] });
    findUserByEmailAndTypeMock.mockResolvedValue(user('internal', { two_factor_enabled: true }));
    listBreakGlassCandidatesMock.mockResolvedValue([
      { userId: 'u1', userType: 'internal', isInactive: false, isAdmin: true, twoFactorEnabled: true },
    ]);
    await expect(authenticateUser('pat@example.com', 'pw', 'internal')).resolves.toMatchObject({ user_id: 'u1' });
  });

  it('refuses a listed user who lost eligibility (2FA reset, demoted) instead of enrolling', async () => {
    loadTenantAuthPolicyMock.mockResolvedValue({ ...OFF, requireSsoForInternalUsers: true, passwordBreakGlassUserIds: ['u1'] });
    findUserByEmailAndTypeMock.mockResolvedValue(user('internal', { two_factor_enabled: false }));
    listBreakGlassCandidatesMock.mockResolvedValue([
      { userId: 'u1', userType: 'internal', isInactive: false, isAdmin: true, twoFactorEnabled: false },
    ]);
    await expect(authenticateUser('pat@example.com', 'pw', 'internal')).rejects.toMatchObject({ code: 'SSO_REQUIRED' });
    expect(recordLoginRefusalMock).toHaveBeenCalledWith(expect.objectContaining({ reason: 'sso_required' }));
  });

  it('fails closed when the break-glass eligibility lookup throws', async () => {
    loadTenantAuthPolicyMock.mockResolvedValue({ ...OFF, requireSsoForInternalUsers: true, passwordBreakGlassUserIds: ['u1'] });
    findUserByEmailAndTypeMock.mockResolvedValue(user('internal', { two_factor_enabled: true }));
    listBreakGlassCandidatesMock.mockRejectedValue(new Error('db down'));
    await expect(authenticateUser('pat@example.com', 'pw', 'internal')).rejects.toBeDefined();
  });

  it('never applies the SSO requirement to client users', async () => {
    loadTenantAuthPolicyMock.mockResolvedValue({ ...OFF, requireSsoForInternalUsers: true });
    findUsersByEmailAndTypeMock.mockResolvedValue([user('client')]);
    await expect(authenticateUser('pat@example.com', 'pw', 'client')).resolves.toMatchObject({ user_type: 'client' });
  });

  it('sends an unenrolled user to forced enrollment when the 2FA policy applies', async () => {
    loadTenantAuthPolicyMock.mockResolvedValue({ ...OFF, require2faForClientUsers: true });
    findUsersByEmailAndTypeMock.mockResolvedValue([user('client')]);
    await expect(authenticateUser('pat@example.com', 'pw', 'client')).rejects.toMatchObject({
      code: 'TWO_FACTOR_ENROLLMENT_REQUIRED',
    });
    expect(recordLoginRefusalMock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: '2fa_enrollment_required', surface: 'client_login' }),
    );
  });

  it('skips the policy for the reauthenticate purpose (no session is minted)', async () => {
    loadTenantAuthPolicyMock.mockResolvedValue({ ...OFF, requireSsoForInternalUsers: true });
    findUserByEmailAndTypeMock.mockResolvedValue(user('internal'));
    await expect(
      authenticateUser('pat@example.com', 'pw', 'internal', { purpose: 'reauthenticate' }),
    ).resolves.toMatchObject({ user_id: 'u1' });
    expect(loadTenantAuthPolicyMock).not.toHaveBeenCalled();
  });

  it('fails closed when the policy cannot be read', async () => {
    loadTenantAuthPolicyMock.mockRejectedValue(new Error('db down'));
    findUserByEmailAndTypeMock.mockResolvedValue(user('internal'));
    await expect(authenticateUser('pat@example.com', 'pw', 'internal')).rejects.toThrow();
  });
});
