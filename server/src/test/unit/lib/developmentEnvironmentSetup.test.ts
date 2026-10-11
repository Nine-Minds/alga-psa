import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { setupDevelopmentEnvironment } from '../../../lib/developmentEnvironmentSetup';

const startupMocks = vi.hoisted(() => ({
  user: {
    user_id: 'shared-development-user',
    tenant: 'shared-development-tenant',
    email: 'glinda@emeraldcity.oz',
    hashed_password: 'aa:bb',
  },
  findUserByEmail: vi.fn(),
  updatePassword: vi.fn(),
  updatePasswordIfUnchanged: vi.fn(),
  getPasswordHash: vi.fn(),
  generateSecurePassword: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    findUserByEmail: startupMocks.findUserByEmail,
    updatePassword: startupMocks.updatePassword,
    updatePasswordIfUnchanged: startupMocks.updatePasswordIfUnchanged,
    getPasswordHash: startupMocks.getPasswordHash,
  },
}));

vi.mock('server/src/utils/encryption/encryption', () => ({
  generateSecurePassword: startupMocks.generateSecurePassword,
  hashPassword: startupMocks.hashPassword,
  verifyPassword: startupMocks.verifyPassword,
}));

vi.mock('@alga-psa/core', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

describe('development startup credential wiring', () => {
  const originalEnvironment = process.env.NODE_ENV;
  const originalPassword = process.env.DEV_LOGIN_PASSWORD;
  const originalRecovery = process.env.DEV_LOGIN_PASSWORD_RECOVERY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'development';
    process.env.DEV_LOGIN_PASSWORD = 'configured-development-password';
    delete process.env.DEV_LOGIN_PASSWORD_RECOVERY;
    startupMocks.user.hashed_password = 'aa:bb';
    startupMocks.findUserByEmail.mockResolvedValue(startupMocks.user);
    startupMocks.verifyPassword.mockImplementation(async (password: string, hash: string) =>
      password === process.env.DEV_LOGIN_PASSWORD && hash === startupMocks.user.hashed_password
    );
  });

  afterEach(() => {
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
    if (originalPassword === undefined) delete process.env.DEV_LOGIN_PASSWORD;
    else process.env.DEV_LOGIN_PASSWORD = originalPassword;
    if (originalRecovery === undefined) delete process.env.DEV_LOGIN_PASSWORD_RECOVERY;
    else process.env.DEV_LOGIN_PASSWORD_RECOVERY = originalRecovery;
  });

  it('runs concurrent app-start setup without overwriting the established shared login', async () => {
    await Promise.all([setupDevelopmentEnvironment(), setupDevelopmentEnvironment()]);

    expect(startupMocks.findUserByEmail).toHaveBeenCalledTimes(2);
    expect(startupMocks.user.hashed_password).toBe('aa:bb');
    expect(startupMocks.updatePassword).not.toHaveBeenCalled();
    expect(startupMocks.updatePasswordIfUnchanged).not.toHaveBeenCalled();
    expect(startupMocks.generateSecurePassword).not.toHaveBeenCalled();
  });

  it('keeps initializeApp wired to this setup path', () => {
    const initializeAppSource = readFileSync(new URL('../../../lib/initializeApp.ts', import.meta.url), 'utf8');

    expect(initializeAppSource).toContain("import { setupDevelopmentEnvironment } from './developmentEnvironmentSetup';");
    expect(initializeAppSource).toMatch(/await setupDevelopmentEnvironment\(\)/);
    expect(initializeAppSource).not.toMatch(/User\.updatePassword\s*\(/);
  });
});
