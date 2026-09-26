import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashPassword, verifyPassword } from '@alga-psa/core/encryption';
import { shouldInitializeDevelopmentPassword } from '../../lib/developmentCredentials';

describe('development credentials', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('keeps a persisted credential across repeated development initialization', async () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'development-credential-regression-secret');
    const password = 'local-development-password';
    const persistedHash = await hashPassword(password);

    expect(shouldInitializeDevelopmentPassword(undefined)).toBe(true);
    expect(shouldInitializeDevelopmentPassword(persistedHash)).toBe(false);
    expect(shouldInitializeDevelopmentPassword(persistedHash)).toBe(false);
    await expect(verifyPassword(password, persistedHash)).resolves.toBe(true);
    await expect(verifyPassword('different-password', persistedHash)).resolves.toBe(false);
  });
});
