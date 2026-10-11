import { describe, expect, it, vi } from 'vitest';
import { describeDevelopmentLoginFailure, verifyDevelopmentLogin } from '../../../../scripts/developmentLoginVerification.mjs';

describe('development login command verification', () => {
  it('re-reads the tenant-scoped row after recovery instead of checking the stale discovered hash', async () => {
    const discoveredUser = {
      user_id: 'seeded-user',
      tenant: 'seeded-tenant',
      email: 'glinda@emeraldcity.oz',
      hashed_password: 'old-mismatched-hash',
    };
    let persistedUser = { ...discoveredUser };
    const order: string[] = [];
    const verifyPassword = vi.fn(async (_password: string, hash: string) => hash === 'recovered-hash');
    const authenticateUser = vi.fn(async () => ({ user_id: 'seeded-user' }));

    await verifyDevelopmentLogin({
      user: discoveredUser,
      password: 'configured-password',
      recover: async () => {
        order.push('recover');
        persistedUser = { ...persistedUser, hashed_password: 'recovered-hash' };
      },
      readTenantScopedUser: async (email: string, tenant: string) => {
        order.push('read');
        expect(email).toBe(discoveredUser.email);
        expect(tenant).toBe(discoveredUser.tenant);
        return { ...persistedUser };
      },
      verifyPassword: async (password: string, hash: string) => {
        order.push('verify');
        return verifyPassword(password, hash);
      },
      authenticateUser: async (...args: Parameters<typeof authenticateUser>) => {
        order.push('authenticate');
        return authenticateUser(...args);
      },
    });

    expect(order).toEqual(['recover', 'read', 'verify', 'authenticate']);
    expect(verifyPassword).toHaveBeenCalledWith('configured-password', 'recovered-hash');
    expect(verifyPassword).not.toHaveBeenCalledWith('configured-password', 'old-mismatched-hash');
    expect(authenticateUser).toHaveBeenCalledWith(discoveredUser.email, 'configured-password', 'internal', {
      tenantId: discoveredUser.tenant,
      requireTenantMatch: true,
    });
  });
});

describe('development login failure reporting', () => {
  it('distinguishes database-role authentication from account password drift without leaking driver details', () => {
    const message = describeDevelopmentLoginFailure({
      code: '28P01',
      message: 'driver error containing private connection data',
      detail: 'sensitive-driver-detail-sentinel',
    }, 'seeded account lookup');

    expect(message).toContain('SQLSTATE 28P01');
    expect(message).toContain('--recover cannot repair database-role authentication');
    expect(message).not.toContain('private connection data');
    expect(message).not.toContain('sensitive-driver-detail-sentinel');
  });

  it('redacts unrecognized driver errors', () => {
    expect(describeDevelopmentLoginFailure({ message: 'secret connection string' }, 'seeded account lookup'))
      .toBe('Development credential check failed during seeded account lookup; inspect configuration privately.');
  });
});
