import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashPassword, verifyPassword, generateSecurePassword } from '@alga-psa/core/encryption';
import { initializeDevelopmentCredential } from 'server/src/lib/developmentCredential';

const originalSecret = process.env.NEXTAUTH_SECRET;
const originalProviderSecret = process.env.nextauth_secret;
const user = {
  user_id: 'development-user',
  tenant: 'development-tenant',
  email: 'glinda@emeraldcity.oz',
};

afterEach(() => {
  if (originalSecret === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = originalSecret;
  if (originalProviderSecret === undefined) delete process.env.nextauth_secret;
  else process.env.nextauth_secret = originalProviderSecret;
});

describe('development credential initialization', () => {
  it('initializes once, retains the password on repeated boots, and verifies through the real password verifier', async () => {
    process.env.NEXTAUTH_SECRET = `test-secret-${crypto.randomUUID()}`;
    let storedHash: string | null = null;
    const log = vi.fn();
    const generatePassword = vi.fn(generateSecurePassword);
    const updatePasswordIfUnchanged = vi.fn(async (_id: string, _tenant: string, expected: string | null, hash: string) => {
      if (storedHash !== expected) return false;
      storedHash = hash;
      return true;
    });

    await initializeDevelopmentCredential({
      user: { ...user, hashed_password: storedHash },
      generatePassword,
      hashPassword,
      updatePasswordIfUnchanged,
      log,
    });

    const reportedPassword = log.mock.calls
      .map(([message]) => message.match(/Password is -> \[ (.+) \]/)?.[1])
      .find((password): password is string => Boolean(password));
    expect(reportedPassword).toBeTruthy();
    expect(storedHash).toBeTruthy();
    expect(await verifyPassword(reportedPassword!, storedHash!)).toBe(true);

    await initializeDevelopmentCredential({
      user: { ...user, hashed_password: storedHash },
      generatePassword,
      hashPassword,
      updatePasswordIfUnchanged,
      log,
    });

    expect(generatePassword).toHaveBeenCalledTimes(1);
    expect(updatePasswordIfUnchanged).toHaveBeenCalledTimes(1);
    expect(await verifyPassword(reportedPassword!, storedHash!)).toBe(true);
  });

  it('allows only one winner when two stacks initialize an unset shared credential concurrently', async () => {
    process.env.NEXTAUTH_SECRET = `test-secret-${crypto.randomUUID()}`;
    let storedHash: string | null = null;
    const logs = [vi.fn(), vi.fn()];
    const generated = [generateSecurePassword(), generateSecurePassword()];
    const updatePasswordIfUnchanged = async (_id: string, _tenant: string, expected: string | null, hash: string) => {
      if (storedHash !== expected) return false;
      storedHash = hash;
      return true;
    };
    const inputs = logs.map((log, index) => ({
      user: { ...user, hashed_password: null },
      generatePassword: () => generated[index],
      hashPassword,
      updatePasswordIfUnchanged,
      log,
    }));

    await Promise.all(inputs.map((input) => initializeDevelopmentCredential(input)));

    const winners = logs.map((log) => log.mock.calls.some(([message]) => message.includes('Password is ->')));
    expect(winners.filter(Boolean)).toHaveLength(1);
    const reportedPassword = generated[winners.findIndex(Boolean)];
    expect(await verifyPassword(reportedPassword, storedHash!)).toBe(true);
  });

  it('uses the same configured secret for hashing and verification', async () => {
    const sharedSecret = `hash-secret-${crypto.randomUUID()}`;
    process.env.nextauth_secret = sharedSecret;
    process.env.NEXTAUTH_SECRET = sharedSecret;
    const password = generateSecurePassword();
    const storedHash = await hashPassword(password);
    expect(await verifyPassword(password, storedHash)).toBe(true);

    process.env.NEXTAUTH_SECRET = `ignored-env-secret-${crypto.randomUUID()}`;
    expect(await verifyPassword(password, storedHash)).toBe(true);

    const changedSecret = `different-secret-${crypto.randomUUID()}`;
    process.env.nextauth_secret = changedSecret;
    process.env.NEXTAUTH_SECRET = changedSecret;
    expect(await verifyPassword(password, storedHash)).toBe(false);
  });
});
