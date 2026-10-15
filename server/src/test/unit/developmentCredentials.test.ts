import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashPassword } from '@alga-psa/core/encryption';
import {
  DEVELOPMENT_USER_EMAIL,
  initializeDevelopmentCredential,
  SEEDED_DEVELOPMENT_PASSWORD_PLACEHOLDER,
  type DevelopmentCredentialUser,
} from '../../lib/developmentCredentials';

const { findUserByEmailMock } = vi.hoisted(() => ({ findUserByEmailMock: vi.fn() }));

vi.mock('@alga-psa/db/models/user', () => ({
  default: { findUserByEmail: findUserByEmailMock },
}));
vi.mock('@alga-psa/db', () => ({ getTenantIdBySlug: vi.fn() }));

import { authenticateUser } from '@alga-psa/auth/actions';

type StoredUser = DevelopmentCredentialUser & { hashed_password: string | null };

function makeStore(initialHash: string | null) {
  const user: StoredUser = {
    user_id: 'development-user',
    email: DEVELOPMENT_USER_EMAIL,
    tenant: 'development-tenant',
    hashed_password: initialHash,
  };
  const compareAndSet = vi.fn(async (
    userId: string,
    tenant: string,
    observedHash: string | null,
    replacementHash: string,
  ) => {
    if (userId !== user.user_id || tenant !== user.tenant || user.hashed_password !== observedHash) return false;
    user.hashed_password = replacementHash;
    return true;
  });
  findUserByEmailMock.mockImplementation(async () => user);
  return { user, compareAndSet };
}

function makeDependencies(
  user: StoredUser,
  compareAndSet: ReturnType<typeof makeStore>['compareAndSet'],
  overrides: Partial<Parameters<typeof initializeDevelopmentCredential>[0]> = {},
) {
  const announcements: Array<{ email: string; password: string }> = [];
  const logInfo = vi.fn();
  const announceCredentials = vi.fn((email: string, password: string) => announcements.push({ email, password }));
  const dependencies: Parameters<typeof initializeDevelopmentCredential>[0] = {
    enabled: true,
    provisionRequested: false,
    findUserByEmail: async () => user,
    updatePasswordIfCurrent: compareAndSet,
    hashPassword,
    generatePassword: () => 'first-bootstrap-credential',
    announceCredentials,
    logInfo,
    ...overrides,
  };
  return { dependencies, announcements, announceCredentials, logInfo };
}

describe('development credential initialization', () => {
  beforeEach(() => {
    vi.stubEnv('NEXTAUTH_SECRET', 'development-credential-regression-secret');
    findUserByEmailMock.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('replaces the seeded placeholder with a credential accepted by authenticateUser', async () => {
    const { user, compareAndSet } = makeStore(SEEDED_DEVELOPMENT_PASSWORD_PLACEHOLDER);
    const { dependencies, announcements } = makeDependencies(user, compareAndSet);

    await initializeDevelopmentCredential(dependencies);

    expect(compareAndSet).toHaveBeenCalledWith(
      user.user_id,
      user.tenant,
      SEEDED_DEVELOPMENT_PASSWORD_PLACEHOLDER,
      expect.any(String),
    );
    expect(announcements).toEqual([{ email: DEVELOPMENT_USER_EMAIL, password: 'first-bootstrap-credential' }]);
    await expect(authenticateUser(DEVELOPMENT_USER_EMAIL, announcements[0].password)).resolves.toMatchObject({
      user_id: user.user_id,
    });
  });

  it('treats an empty stored hash as unset and conditionally replaces that exact value', async () => {
    const { user, compareAndSet } = makeStore('');
    const { dependencies, announcements } = makeDependencies(user, compareAndSet);

    await initializeDevelopmentCredential(dependencies);

    expect(compareAndSet).toHaveBeenCalledWith(user.user_id, user.tenant, '', expect.any(String));
    expect(announcements).toHaveLength(1);
  });

  it('preserves a genuine existing credential without announcing or rotating it', async () => {
    const existingPassword = 'existing-valid-development-credential';
    const { user, compareAndSet } = makeStore(await hashPassword(existingPassword));
    const originalHash = user.hashed_password;
    const { dependencies, announcements } = makeDependencies(user, compareAndSet);

    await initializeDevelopmentCredential(dependencies);

    expect(user.hashed_password).toBe(originalHash);
    expect(compareAndSet).not.toHaveBeenCalled();
    expect(announcements).toEqual([]);
    await expect(authenticateUser(DEVELOPMENT_USER_EMAIL, existingPassword)).resolves.toMatchObject({
      user_id: user.user_id,
    });
  });

  it('does not rotate or reannounce a credential on repeated initialization', async () => {
    const { user, compareAndSet } = makeStore(SEEDED_DEVELOPMENT_PASSWORD_PLACEHOLDER);
    const { dependencies, announcements } = makeDependencies(user, compareAndSet);

    await initializeDevelopmentCredential(dependencies);
    const establishedHash = user.hashed_password;
    await initializeDevelopmentCredential(dependencies);

    expect(user.hashed_password).toBe(establishedHash);
    expect(compareAndSet).toHaveBeenCalledTimes(1);
    expect(announcements).toHaveLength(1);
  });

  it('allows only one of two competing initializers to establish and announce a credential', async () => {
    const { user, compareAndSet } = makeStore(SEEDED_DEVELOPMENT_PASSWORD_PLACEHOLDER);
    let hashCalls = 0;
    let releaseHashes!: () => void;
    const bothHashesStarted = new Promise<void>((resolve) => {
      releaseHashes = resolve;
    });
    const hashPasswordWithBarrier = async (password: string) => {
      hashCalls += 1;
      if (hashCalls === 2) releaseHashes();
      await bothHashesStarted;
      return hashPassword(password);
    };
    const first = makeDependencies(user, compareAndSet, {
      hashPassword: hashPasswordWithBarrier,
      generatePassword: () => 'competing-credential-a',
    });
    const second = makeDependencies(user, compareAndSet, {
      hashPassword: hashPasswordWithBarrier,
      generatePassword: () => 'competing-credential-b',
    });

    await Promise.all([
      initializeDevelopmentCredential(first.dependencies),
      initializeDevelopmentCredential(second.dependencies),
    ]);

    expect(compareAndSet).toHaveBeenCalledTimes(2);
    expect(first.announcements.length + second.announcements.length).toBe(1);
    const announced = first.announcements[0] ?? second.announcements[0];
    await expect(authenticateUser(DEVELOPMENT_USER_EMAIL, announced.password)).resolves.toMatchObject({
      user_id: user.user_id,
    });
  });

  it('does not announce when conditional persistence fails', async () => {
    const { user, compareAndSet } = makeStore(SEEDED_DEVELOPMENT_PASSWORD_PLACEHOLDER);
    compareAndSet.mockResolvedValue(false);
    const { dependencies, announcements } = makeDependencies(user, compareAndSet);

    await initializeDevelopmentCredential(dependencies);

    expect(announcements).toEqual([]);
  });

  it('propagates persistence errors without announcing the candidate credential', async () => {
    const { user, compareAndSet } = makeStore(SEEDED_DEVELOPMENT_PASSWORD_PLACEHOLDER);
    compareAndSet.mockRejectedValue(new Error('database unavailable'));
    const { dependencies, announceCredentials } = makeDependencies(user, compareAndSet);

    await expect(initializeDevelopmentCredential(dependencies)).rejects.toThrow('database unavailable');
    expect(announceCredentials).not.toHaveBeenCalled();
  });

  it('provisions an explicitly supplied credential for an existing shared-database account', async () => {
    const { user, compareAndSet } = makeStore('previously-rotated-hash');
    const { dependencies, announcements } = makeDependencies(user, compareAndSet, {
      provisionRequested: true,
      provisionPassword: 'operator-selected-recovery-credential',
    });

    await initializeDevelopmentCredential(dependencies);

    expect(compareAndSet).toHaveBeenCalledWith(user.user_id, user.tenant, 'previously-rotated-hash', expect.any(String));
    expect(announcements).toEqual([
      { email: DEVELOPMENT_USER_EMAIL, password: 'operator-selected-recovery-credential' },
    ]);
    await expect(authenticateUser(DEVELOPMENT_USER_EMAIL, announcements[0].password)).resolves.toMatchObject({
      user_id: user.user_id,
    });
  });
});
