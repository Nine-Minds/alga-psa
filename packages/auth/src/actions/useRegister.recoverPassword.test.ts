import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveSubjectsMock = vi.fn();
const limitMock = vi.fn();
const createTokenMock = vi.fn();
const sendMock = vi.fn();
const permittedMock = vi.fn();
const ownDomainMock = vi.fn();

vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerTranslation: async () => ({ t: (k: string) => k }),
}));
vi.mock('@alga-psa/db/models/user', () => ({ default: {} }));
vi.mock('@alga-psa/db/models/tenant', () => ({ default: {} }));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: async () => ({}) }));
vi.mock('@alga-psa/core/encryption', () => ({ hashPassword: async (p: string) => `hash:${p}` }));
vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), system: vi.fn() },
}));
vi.mock('@alga-psa/validation', () => ({ isValidEmail: (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) }));
vi.mock('../lib/tokenizer', () => ({
  getInfoFromToken: vi.fn(),
  createToken: (...a: unknown[]) => createTokenMock(...a),
}));
vi.mock('../lib/emailRegistry', () => ({
  getAuthEmailRegistry: () => ({ sendPasswordResetEmail: (...a: unknown[]) => sendMock(...a) }),
}));
vi.mock('../lib/security/rateLimiting', () => ({
  checkPasswordResetLimit: (...a: unknown[]) => limitMock(...a),
}));
vi.mock('../lib/portalDomainTenant', () => ({
  getActiveClientPortalDomainForTenant: (...a: unknown[]) => ownDomainMock(...a),
}));
vi.mock('../lib/passwordLoginGate', () => ({
  isPasswordResetPermitted: (...a: unknown[]) => permittedMock(...a),
}));
vi.mock('../lib/passwordReset', () => ({
  resolveResetSubjects: (...a: unknown[]) => resolveSubjectsMock(...a),
  resolveResetSubjectFromToken: vi.fn(),
}));

import { recoverPassword } from './useRegister';

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function resolved(tenant: string, id: string, userType: 'client' | 'internal' = 'client') {
  return {
    subject: { tenant, user_id: id, email: 'dual@example.com', user_type: userType },
    user: { user_id: id, tenant, email: 'dual@example.com', user_type: userType, first_name: id, last_name: '' },
  };
}

describe('recoverPassword (thin caller of the subject module)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3614';
    limitMock.mockResolvedValue({ success: true });
    permittedMock.mockResolvedValue(true);
    createTokenMock.mockImplementation(async (claims: { user_id: string }) => `token-${claims.user_id}`);
    sendMock.mockResolvedValue(undefined);
    ownDomainMock.mockResolvedValue(null);
    resolveSubjectsMock.mockResolvedValue([]);
  });

  it('returns true for no match, hint mismatch, single match, fan-out, over-limit and failures alike', async () => {
    const outcomes: unknown[] = [];
    resolveSubjectsMock.mockResolvedValueOnce([]);
    outcomes.push(await recoverPassword('x@example.com', 'client'));
    resolveSubjectsMock.mockResolvedValueOnce([resolved(TENANT_A, 'u-a')]);
    outcomes.push(await recoverPassword('x@example.com', 'client'));
    resolveSubjectsMock.mockResolvedValueOnce([resolved(TENANT_A, 'u-a'), resolved(TENANT_B, 'u-b')]);
    outcomes.push(await recoverPassword('x@example.com', 'client'));
    limitMock.mockResolvedValueOnce({ success: false });
    outcomes.push(await recoverPassword('x@example.com', 'client'));
    resolveSubjectsMock.mockRejectedValueOnce(new Error('db down'));
    outcomes.push(await recoverPassword('x@example.com', 'client'));
    sendMock.mockRejectedValueOnce(new Error('smtp'));
    resolveSubjectsMock.mockResolvedValueOnce([resolved(TENANT_A, 'u-a')]);
    outcomes.push(await recoverPassword('x@example.com', 'client'));
    outcomes.push(await recoverPassword('not-an-email', 'client'));
    expect(outcomes).toEqual(Array(7).fill(true));
  });

  it('spends the rate limit once per request, before resolution, and sends nothing over the limit', async () => {
    const order: string[] = [];
    limitMock.mockImplementation(async () => { order.push('limit'); return { success: false }; });
    resolveSubjectsMock.mockImplementation(async () => { order.push('resolve'); return [resolved(TENANT_A, 'u-a')]; });
    expect(await recoverPassword('Dual@Example.com', 'client')).toBe(true);
    expect(limitMock).toHaveBeenCalledTimes(1);
    expect(limitMock).toHaveBeenCalledWith('dual@example.com');
    expect(order).toEqual(['limit']);
    expect(sendMock).not.toHaveBeenCalled();
    expect(createTokenMock).not.toHaveBeenCalled();
  });

  it('a fan-out request consumes the limit once', async () => {
    resolveSubjectsMock.mockResolvedValue([resolved(TENANT_A, 'u-a'), resolved(TENANT_B, 'u-b')]);
    await recoverPassword('dual@example.com', 'client');
    expect(limitMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('binds each token to its own subject and sends through its own tenant', async () => {
    resolveSubjectsMock.mockResolvedValue([resolved(TENANT_A, 'u-a'), resolved(TENANT_B, 'u-b')]);
    ownDomainMock.mockImplementation(async (tenant: string) => (tenant === TENANT_A ? 'a.example.test' : 'b.example.test'));
    await recoverPassword('dual@example.com', 'client');
    expect(createTokenMock).toHaveBeenCalledWith(expect.objectContaining({ tenant: TENANT_A, user_id: 'u-a', user_type: 'client', email: 'dual@example.com' }));
    expect(createTokenMock).toHaveBeenCalledWith(expect.objectContaining({ tenant: TENANT_B, user_id: 'u-b' }));
    const byTenant = Object.fromEntries(sendMock.mock.calls.map(([p]) => [p.tenant, p.resetLink as string]));
    expect(byTenant[TENANT_A]).toContain('token=token-u-a');
    expect(byTenant[TENANT_A]).toContain('portalDomain=a.example.test');
    expect(byTenant[TENANT_B]).toContain('token=token-u-b');
    expect(byTenant[TENANT_B]).toContain('portalDomain=b.example.test');
  });

  it('a subject that fails a gate or a send does not suppress the others', async () => {
    resolveSubjectsMock.mockResolvedValue([resolved(TENANT_A, 'u-a'), resolved(TENANT_B, 'u-b')]);
    permittedMock.mockImplementation(async (user: { tenant: string }) => user.tenant !== TENANT_A);
    await recoverPassword('dual@example.com', 'client');
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].tenant).toBe(TENANT_B);

    sendMock.mockClear();
    permittedMock.mockResolvedValue(true);
    sendMock.mockRejectedValueOnce(new Error('tenant A provider down'));
    expect(await recoverPassword('dual@example.com', 'client')).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('with no trusted origin sends nothing for any subject', async () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    delete process.env.NEXTAUTH_URL;
    delete process.env.HOST;
    resolveSubjectsMock.mockResolvedValue([resolved(TENANT_A, 'u-a'), resolved(TENANT_B, 'u-b')]);
    expect(await recoverPassword('dual@example.com', 'client')).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('passes the options form (portalDomain, tenantSlug) to resolution as the hint; a bare string still means portalDomain', async () => {
    await recoverPassword('i@example.com', 'msp', { tenantSlug: 'aaaaaaaaaaaa' });
    expect(resolveSubjectsMock).toHaveBeenLastCalledWith('i@example.com', 'internal', { portalDomain: undefined, tenantSlug: 'aaaaaaaaaaaa' });
    await recoverPassword('c@example.com', 'client', { portalDomain: 'a.example.test' });
    expect(resolveSubjectsMock).toHaveBeenLastCalledWith('c@example.com', 'client', { portalDomain: 'a.example.test', tenantSlug: undefined });
    await recoverPassword('c@example.com', 'client', 'legacy.example.test');
    expect(resolveSubjectsMock).toHaveBeenLastCalledWith('c@example.com', 'client', { portalDomain: 'legacy.example.test', tenantSlug: undefined });
    await recoverPassword('i@example.com');
    expect(resolveSubjectsMock).toHaveBeenLastCalledWith('i@example.com', 'internal', { portalDomain: undefined, tenantSlug: undefined });
  });
});
