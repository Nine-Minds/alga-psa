import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUsersMock = vi.fn();
const findScopedMock = vi.fn();

vi.mock('@alga-psa/db/models/user', () => ({
  default: {
    findUsersByEmailAndType: (...args: unknown[]) => findUsersMock(...args),
    findUserByEmailTenantAndType: (...args: unknown[]) => findScopedMock(...args),
  },
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { resolveSignInUser, TenantRequiredResolutionError } = await import('./signInUserResolution');

const user = (id: string, tenant: string, extra: Record<string, unknown> = {}) =>
  ({
    user_id: id,
    tenant,
    email: 'dual@example.com',
    user_type: 'internal',
    is_inactive: false,
    created_at: '2025-01-01T00:00:00Z',
    ...extra,
  }) as any;

describe('resolveSignInUser', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('scoped', () => {
    it('looks only inside the scope and never runs verify', async () => {
      const verify = vi.fn(() => true);
      findScopedMock.mockResolvedValue(user('u-b', 't-b'));

      const result = await resolveSignInUser({
        email: 'dual@example.com',
        userType: 'internal',
        scopeTenantId: 't-b',
        verify,
      });

      expect(findScopedMock).toHaveBeenCalledWith('dual@example.com', 't-b', 'internal');
      expect(findUsersMock).not.toHaveBeenCalled();
      expect(verify).not.toHaveBeenCalled();
      expect(result.user?.user_id).toBe('u-b');
    });

    it('returns no user when the scope has none, regardless of other tenants', async () => {
      findScopedMock.mockResolvedValue(undefined);
      const result = await resolveSignInUser({
        email: 'dual@example.com',
        userType: 'internal',
        scopeTenantId: 't-c',
        verify: () => true,
      });
      expect(result.user).toBeUndefined();
    });
  });

  describe('unscoped', () => {
    it('returns a lone candidate without verifying it', async () => {
      const verify = vi.fn(() => false);
      findUsersMock.mockResolvedValue([user('u-a', 't-a')]);
      const result = await resolveSignInUser({ email: 'dual@example.com', userType: 'internal', verify });
      expect(result.user?.user_id).toBe('u-a');
      expect(result.verified).toBe(false);
      expect(verify).not.toHaveBeenCalled();
    });

    it('returns undefined for no candidates', async () => {
      findUsersMock.mockResolvedValue([]);
      const result = await resolveSignInUser({ email: 'x@example.com', userType: 'internal', verify: () => true });
      expect(result.user).toBeUndefined();
    });

    it('throws TenantRequiredResolutionError when the attempt verifies in more than one tenant', async () => {
      findUsersMock.mockResolvedValue([user('u-a', 't-a'), user('u-b', 't-b')]);
      await expect(
        resolveSignInUser({ email: 'dual@example.com', userType: 'internal', verify: () => true })
      ).rejects.toBeInstanceOf(TenantRequiredResolutionError);
    });

    it('SSO shape (verify always true) skips inactive users when counting tenants', async () => {
      findUsersMock.mockResolvedValue([user('u-a', 't-a'), user('u-b', 't-b', { is_inactive: true })]);
      const result = await resolveSignInUser({ email: 'dual@example.com', userType: 'internal', verify: () => true });
      expect(result.user?.user_id).toBe('u-a');
      expect(result.verified).toBe(true);
    });

    it('resolves to the user whose credential verifies, ignoring tenants where it does not', async () => {
      findUsersMock.mockResolvedValue([user('u-a', 't-a', { hashed_password: 'A' }), user('u-b', 't-b', { hashed_password: 'B' })]);
      const result = await resolveSignInUser({
        email: 'dual@example.com',
        userType: 'internal',
        verify: (c) => c.hashed_password === 'B',
      });
      expect(result.user?.user_id).toBe('u-b');
      expect(result.verified).toBe(true);
    });

    it('is deterministic: oldest account wins among duplicates in one tenant', async () => {
      findUsersMock.mockResolvedValue([
        user('u-2', 't-a', { created_at: '2025-06-01T00:00:00Z' }),
        user('u-1', 't-a', { created_at: '2025-01-01T00:00:00Z' }),
      ]);
      const result = await resolveSignInUser({ email: 'dual@example.com', userType: 'internal', verify: () => true });
      expect(result.user?.user_id).toBe('u-1');
    });

    it('does not disclose a live candidate that failed verification', async () => {
      findUsersMock.mockResolvedValue([user('u-a', 't-a'), user('u-b', 't-b')]);
      const result = await resolveSignInUser({ email: 'dual@example.com', userType: 'internal', verify: () => false });
      expect(result.user).toBeUndefined();
    });

    it('hands back the oldest inactive candidate when everyone is inactive', async () => {
      findUsersMock.mockResolvedValue([
        user('u-2', 't-b', { is_inactive: true, created_at: '2025-06-01T00:00:00Z' }),
        user('u-1', 't-a', { is_inactive: true, created_at: '2025-01-01T00:00:00Z' }),
      ]);
      const verify = vi.fn(() => true);
      const result = await resolveSignInUser({ email: 'dual@example.com', userType: 'internal', verify });
      expect(result.user?.user_id).toBe('u-1');
      expect(result.verified).toBe(false);
      expect(verify).not.toHaveBeenCalled();
    });
  });
});
