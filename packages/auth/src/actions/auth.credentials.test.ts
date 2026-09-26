import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IUser } from '@alga-psa/types';
import { hashPassword } from '@alga-psa/core/encryption';

const { findUserByEmailMock } = vi.hoisted(() => ({
  findUserByEmailMock: vi.fn(),
}));

vi.mock('@alga-psa/db/models/user', () => ({
  default: { findUserByEmail: findUserByEmailMock },
}));

vi.mock('@alga-psa/db', () => ({
  getTenantIdBySlug: vi.fn(),
}));

import { authenticateUser } from './auth';

describe('authenticateUser development password verification', () => {
  beforeEach(() => {
    vi.stubEnv('NEXTAUTH_SECRET', 'development-auth-regression-secret');
    findUserByEmailMock.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it('accepts a password persisted by development initialization', async () => {
    const password = 'local-development-password';
    const user = {
      user_id: 'development-user',
      email: 'glinda@emeraldcity.oz',
      tenant: 'development-tenant',
      is_inactive: false,
      hashed_password: await hashPassword(password),
    } as IUser;
    findUserByEmailMock.mockResolvedValue(user);

    await expect(authenticateUser(user.email, password)).resolves.toBe(user);
    await expect(authenticateUser(user.email, 'incorrect-password')).resolves.toBeNull();
  });
});
