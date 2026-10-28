import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ gate: vi.fn(), get: vi.fn(), knex: vi.fn(), user: { user_id: 'admin', user_type: 'internal' } }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => () => fn(mocks.user, { tenant: 'customer' }) }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: mocks.knex, UserPreferences: { get: mocks.get } }));
vi.mock('@alga-psa/core/capability/server', () => ({ requireCapabilityForAction: mocks.gate }));
vi.mock('@alga-psa/co-managed', () => ({}));
vi.mock('@enterprise/lib/co-managed/workflowClient', () => ({}));

import { getCoManagedPasswordStatus } from '@/lib/actions/coManagedAcceptanceActions';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.user_type = 'internal';
  mocks.gate.mockResolvedValue(undefined);
  mocks.knex.mockResolvedValue({ knex: 'db' });
});

describe('customer password status', () => {
  it.each([[true], [false]])('returns the stored reset state %s for the authenticated user', async value => {
    mocks.get.mockResolvedValue({ setting_value: value });
    expect(await getCoManagedPasswordStatus()).toEqual({ hasResetPassword: value });
    expect(mocks.gate).toHaveBeenCalledWith('co-managed', 'customer', 'serves');
    expect(mocks.get).toHaveBeenCalledWith('db', 'admin', 'has_reset_password');
  });

  it('does not read the preference when the capability is disabled', async () => {
    mocks.gate.mockRejectedValue(new Error('disabled'));
    await expect(getCoManagedPasswordStatus()).rejects.toThrow('disabled');
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
