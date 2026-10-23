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
    const generatedPassword = generateSecurePassword();
    const generatePassword = vi.fn(() => generatedPassword);
    const updatePasswordIfUnchanged = vi.fn(async (_id: string, _tenant: string, expected: string | null, hash: string) => {
      if (storedHash !== expected) return false;
      storedHash = hash;
      return true;
    });

    await initializeDevelopmentCredential({
      user: { ...user, hashed_password: storedHash },
      generatePassword,
      hashPassword,
      verifyPassword,
      updatePasswordIfUnchanged,
      readCurrentHash: async () => storedHash,
      log,
    });

    expect(storedHash).toBeTruthy();
    expect(await verifyPassword(generatedPassword, storedHash!)).toBe(true);
    expect(JSON.stringify(log.mock.calls)).not.toContain(generatedPassword);
    expect(JSON.stringify(log.mock.calls)).not.toContain(storedHash);

    await initializeDevelopmentCredential({
      user: { ...user, hashed_password: storedHash },
      generatePassword,
      hashPassword,
      verifyPassword,
      updatePasswordIfUnchanged,
      readCurrentHash: async () => storedHash,
      log,
    });

    expect(generatePassword).toHaveBeenCalledTimes(1);
    expect(updatePasswordIfUnchanged).toHaveBeenCalledTimes(1);
    expect(await verifyPassword(generatedPassword, storedHash!)).toBe(true);
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
      verifyPassword,
      updatePasswordIfUnchanged,
      readCurrentHash: async () => storedHash,
      log,
    }));

    await Promise.all(inputs.map((input) => initializeDevelopmentCredential(input)));

    const matchingPasswords = await Promise.all(generated.map((password) => verifyPassword(password, storedHash!)));
    expect(matchingPasswords.filter(Boolean)).toHaveLength(1);
    expect(JSON.stringify(logs.flatMap((log) => log.mock.calls))).not.toMatch(/Password is ->/);
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

  it('retains a well-formed shared hash when this stack has a different effective secret', async () => {
    const credentialSecret = `credential-secret-${crypto.randomUUID()}`;
    process.env.nextauth_secret = credentialSecret;
    process.env.NEXTAUTH_SECRET = credentialSecret;
    const configuredPassword = generateSecurePassword();
    const storedHash = await hashPassword(configuredPassword);

    process.env.nextauth_secret = `drifted-secret-${crypto.randomUUID()}`;
    process.env.NEXTAUTH_SECRET = process.env.nextauth_secret;
    const updatePasswordIfUnchanged = vi.fn(async () => true);
    const log = vi.fn();

    await initializeDevelopmentCredential({
      user: { ...user, hashed_password: storedHash },
      configuredPassword,
      generatePassword: vi.fn(generateSecurePassword),
      hashPassword,
      verifyPassword,
      updatePasswordIfUnchanged,
      readCurrentHash: async () => storedHash,
      log,
    });

    expect(updatePasswordIfUnchanged).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('retained'));
    expect(await verifyPassword(configuredPassword, storedHash)).toBe(false);
  });
});
