import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { account, updatePassword, findByEmailAndType, findByEmailTenantAndType, getSecret } = vi.hoisted(() => {
  const account = {
    user_id: 'glinda-user',
    tenant: 'emerald-tenant',
    email: 'glinda@emeraldcity.oz',
    user_type: 'internal',
    hashed_password: 'previous-hash',
  };
  return {
    account,
    updatePassword: vi.fn(async (userId: string, tenant: string, hash: string) => {
      if (userId === account.user_id && tenant === account.tenant) account.hashed_password = hash;
    }),
    findByEmailAndType: vi.fn(async () => account),
    findByEmailTenantAndType: vi.fn(async () => account),
    getSecret: vi.fn(async (name: string) => name === 'credential_encryption_key'
      ? 'shared-development-key-with-at-least-thirty-two-characters'
      : 'unit-test-nextauth-secret'),
  };
});

vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    findUserByEmailAndType: findByEmailAndType,
    findUserByEmailTenantAndType: findByEmailTenantAndType,
    updatePassword,
  },
}));

vi.mock('server/src/lib/utils/getSecret', () => ({
  getSecret,
}));

import { verifyPassword } from 'server/src/utils/encryption/encryption';
import { provisionDevelopmentLogin } from 'server/src/lib/devLoginProvisioning';

describe('development login provisioning', () => {
  const originalNextAuthSecret = process.env.NEXTAUTH_SECRET;

  beforeEach(() => {
    account.user_id = 'glinda-user';
    account.hashed_password = 'previous-hash';
    updatePassword.mockClear();
    findByEmailAndType.mockClear();
    findByEmailTenantAndType.mockClear();
    getSecret.mockReset();
    getSecret.mockImplementation(async (name: string) => name === 'credential_encryption_key'
      ? 'shared-development-key-with-at-least-thirty-two-characters'
      : 'unit-test-nextauth-secret');
    process.env.NEXTAUTH_SECRET = 'unit-test-nextauth-secret';
  });

  afterEach(() => {
    if (originalNextAuthSecret === undefined) delete process.env.NEXTAUTH_SECRET;
    else process.env.NEXTAUTH_SECRET = originalNextAuthSecret;
  });

  it('keeps the shared login valid across server startups and verifies the persisted hash', async () => {
    const firstStartup = await provisionDevelopmentLogin();
    const firstHash = account.hashed_password;
    const secondStartup = await provisionDevelopmentLogin();

    expect(firstStartup).not.toBeNull();
    expect(secondStartup).toEqual(firstStartup);
    expect(account.hashed_password).not.toBe(firstHash); // PBKDF2 salt is fresh on each startup.
    expect(await verifyPassword(secondStartup!.password, account.hashed_password)).toBe(true);
    expect(findByEmailAndType).toHaveBeenCalledWith('glinda@emeraldcity.oz', 'internal');
    expect(findByEmailTenantAndType).toHaveBeenCalledWith(
      'glinda@emeraldcity.oz',
      'emerald-tenant',
      'internal',
    );
    expect(updatePassword).toHaveBeenCalledWith('glinda-user', 'emerald-tenant', expect.any(String));
  });

  it.each(['', 'short-key'])('falls back to the shared authentication secret when the optional encryption key is %j', async credentialKey => {
    getSecret.mockImplementation(async (name: string) => name === 'credential_encryption_key' ? credentialKey : 'unit-test-nextauth-secret');
    const first = await provisionDevelopmentLogin();
    const second = await provisionDevelopmentLogin();
    expect(first?.password).toBe(second?.password);
    expect(await verifyPassword(first!.password, account.hashed_password)).toBe(true);
  });

  it('rejects provisioning when persisted verification fails', async () => {
    findByEmailTenantAndType.mockResolvedValueOnce({ ...account, hashed_password: 'wrong-persisted-hash' } as any);
    await expect(provisionDevelopmentLogin()).rejects.toThrow('Development login password was not persisted');
  });

  it('derives separate credentials for distinct account identities', async () => {
    const first = await provisionDevelopmentLogin();
    account.user_id = 'another-user';
    const otherIdentity = await provisionDevelopmentLogin();
    expect(otherIdentity?.password).not.toBe(first?.password);
  });
});
