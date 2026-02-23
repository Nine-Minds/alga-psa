import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUserByEmailAndTypeMock = vi.fn();

vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    findUserByEmailAndType: (...args: unknown[]) => findUserByEmailAndTypeMock(...args),
  },
}));

import { mapCeOAuthProfileToExtendedUser } from './ceOAuthProfileMapper';

describe('CE OAuth profile mapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T053: resolves internal user by normalized email for Microsoft profile', async () => {
    findUserByEmailAndTypeMock.mockResolvedValue({
      user_id: 'u-1',
      email: 'admin@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
      username: 'ada',
      hashed_password: 'hashed',
      tenant: 'tenant-1',
      user_type: 'internal',
      is_inactive: false,
    });

    const result = await mapCeOAuthProfileToExtendedUser({
      provider: 'microsoft',
      email: '  ADMIN@example.com ',
      profile: { tid: 'tenant' },
      image: 'https://example.com/a.png',
    } as any);

    expect(findUserByEmailAndTypeMock).toHaveBeenCalledWith('admin@example.com', 'internal');
    expect(result).toMatchObject({
      id: 'u-1',
      email: 'admin@example.com',
      name: 'Ada Lovelace',
      user_type: 'internal',
      tenant: 'tenant-1',
    });
  });

  it('T054: resolves internal user by normalized email for Google profile', async () => {
    findUserByEmailAndTypeMock.mockResolvedValue({
      user_id: 'u-2',
      email: 'google-user@example.com',
      username: 'googler',
      hashed_password: 'hashed',
      tenant: 'tenant-2',
      user_type: 'internal',
      is_inactive: false,
    });

    const result = await mapCeOAuthProfileToExtendedUser({
      provider: 'google',
      email: ' GOOGLE-USER@example.com ',
      profile: { sub: 'google-sub' },
    } as any);

    expect(findUserByEmailAndTypeMock).toHaveBeenCalledWith('google-user@example.com', 'internal');
    expect(result).toMatchObject({
      id: 'u-2',
      email: 'google-user@example.com',
      username: 'googler',
      user_type: 'internal',
      tenant: 'tenant-2',
    });
  });

  it('T055: rejects inactive user accounts', async () => {
    findUserByEmailAndTypeMock.mockResolvedValue({
      user_id: 'u-3',
      email: 'inactive@example.com',
      username: 'inactive',
      tenant: 'tenant-3',
      user_type: 'internal',
      is_inactive: true,
    });

    await expect(
      mapCeOAuthProfileToExtendedUser({
        provider: 'google',
        email: 'inactive@example.com',
        profile: {},
      } as any)
    ).rejects.toThrow('OAuth user account is inactive');
  });

  it('T056: rejects non-internal user types for MSP OAuth flow', async () => {
    findUserByEmailAndTypeMock.mockResolvedValue({
      user_id: 'u-4',
      email: 'client@example.com',
      username: 'client-user',
      tenant: 'tenant-4',
      user_type: 'client',
      is_inactive: false,
    });

    await expect(
      mapCeOAuthProfileToExtendedUser({
        provider: 'microsoft',
        email: 'client@example.com',
        profile: {},
      } as any)
    ).rejects.toThrow('OAuth user is not an internal MSP account');
  });
});
