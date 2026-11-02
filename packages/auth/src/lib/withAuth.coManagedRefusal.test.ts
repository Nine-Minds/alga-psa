import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoManagedLifecycleError } from '@alga-psa/licensing/lifecycle-error';

vi.mock('./getCurrentUser', () => ({
  getCurrentUserWithRevocationCheck: vi.fn(async () => ({ user_id: 'u1', tenant: 'tenant-1' })),
}));
vi.mock('./localizeActionError', () => ({ localizeActionError: async (v: unknown) => v }));
vi.mock('@alga-psa/db', () => ({ runWithTenant: (_tenant: string, fn: () => unknown) => fn() }));

describe('withAuth: co-managed write refusal', () => {
  beforeEach(() => vi.resetModules());

  it.each([
    ['read_only', 'common:errors.coManaged.readOnly'],
    ['pending_acceptance', 'common:errors.coManaged.acceptancePending'],
  ] as const)('returns an action error with a messageKey for %s', async (state, messageKey) => {
    const { withAuth } = await import('./withAuth');
    const error = new CoManagedLifecycleError({ state, canWrite: false, graceEndsAt: null });
    const result = await withAuth(async () => { throw error; })();
    expect(result).toEqual({ actionError: error.message, messageKey });
  });

  it('rethrows anything else untouched', async () => {
    const { withAuth } = await import('./withAuth');
    await expect(withAuth(async () => { throw new Error('boom'); })()).rejects.toThrow('boom');
  });
});
