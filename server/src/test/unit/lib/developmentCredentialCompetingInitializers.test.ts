import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateSecurePassword, hashPassword, verifyPassword } from '@alga-psa/core/encryption';
import { initializeDevelopmentCredential } from '../../../lib/developmentCredential';

const originalSecret = process.env.NEXTAUTH_SECRET;
const originalProviderSecret = process.env.nextauth_secret;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = originalSecret;
  if (originalProviderSecret === undefined) delete process.env.nextauth_secret;
  else process.env.nextauth_secret = originalProviderSecret;
});

describe('competing development app initializers', () => {
  it('retains an established shared login when two stacks initialize concurrently', async () => {
    const sharedSecret = `shared-secret-${crypto.randomUUID()}`;
    process.env.nextauth_secret = sharedSecret;
    process.env.NEXTAUTH_SECRET = sharedSecret;

    const configuredPassword = generateSecurePassword();
    let storedHash = await hashPassword(configuredPassword);
    const originalHash = storedHash;
    const generatePassword = vi.fn(generateSecurePassword);
    const updatePasswordIfUnchanged = vi.fn(async (
      _userId: string,
      _tenant: string,
      expectedHash: string | null,
      replacementHash: string
    ) => {
      if (storedHash !== expectedHash) return false;
      storedHash = replacementHash;
      return true;
    });
    const makeStartup = () => initializeDevelopmentCredential({
      user: {
        user_id: 'shared-development-user',
        tenant: 'shared-development-tenant',
        email: 'glinda@emeraldcity.oz',
        hashed_password: originalHash,
      },
      configuredPassword,
      generatePassword,
      hashPassword,
      verifyPassword,
      updatePasswordIfUnchanged,
      readCurrentHash: async () => storedHash,
      log: () => {},
    });

    await Promise.all([makeStartup(), makeStartup()]);

    expect(storedHash).toBe(originalHash);
    expect(generatePassword).not.toHaveBeenCalled();
    expect(updatePasswordIfUnchanged).not.toHaveBeenCalled();
    expect(await verifyPassword(configuredPassword, storedHash)).toBe(true);
  });
});
