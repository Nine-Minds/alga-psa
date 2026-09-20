import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  isFeatureFlagEnabled: vi.fn(),
  assertTenantAddOnAccess: vi.fn(),
  isConfigured: vi.fn(),
}));

vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@alga-psa/core', () => ({
  RELEASE_V1_6_FEATURE_FLAG: 'release-v1-6-feature',
  isFeatureFlagEnabled: mocks.isFeatureFlagEnabled,
}));
vi.mock('server/src/lib/tier-gating/assertAddOnAccess', () => {
  class AddOnAccessError extends Error {
    constructor(readonly addOn: string) {
      super(`This feature requires the ${addOn} add-on.`);
      this.name = 'AddOnAccessError';
    }
  }
  return { AddOnAccessError, assertTenantAddOnAccess: mocks.assertTenantAddOnAccess };
});
vi.mock('../../services/smartTicketSearch/typesafeClient', () => ({
  isSmartTicketSearchConfigured: mocks.isConfigured,
}));

import { evaluateSmartTicketSearchAccess } from '../../services/smartTicketSearch/smartSearchAccess';

const user = { user_id: 'u1', tenant: 't1' } as never;

beforeEach(() => {
  for (const fn of Object.values(mocks) as Array<{ mockReset: () => void }>) fn.mockReset();
  mocks.hasPermission.mockResolvedValue(true);
  mocks.isFeatureFlagEnabled.mockResolvedValue(true);
  mocks.assertTenantAddOnAccess.mockResolvedValue(undefined);
  mocks.isConfigured.mockResolvedValue(true);
});

describe('evaluateSmartTicketSearchAccess', () => {
  it('allows when permission, release flag, AI add-on, and key all hold', async () => {
    await expect(evaluateSmartTicketSearchAccess(user)).resolves.toEqual({ allowed: true });
    expect(mocks.isFeatureFlagEnabled).toHaveBeenCalledWith('release-v1-6-feature', { tenantId: 't1', userId: 'u1' });
    expect(mocks.assertTenantAddOnAccess).toHaveBeenCalledWith('t1', 'ai_assistant');
  });

  it('denies FORBIDDEN first and stops there', async () => {
    mocks.hasPermission.mockResolvedValue(false);
    await expect(evaluateSmartTicketSearchAccess(user)).resolves.toMatchObject({ allowed: false, reason: 'FORBIDDEN' });
    expect(mocks.isFeatureFlagEnabled).not.toHaveBeenCalled();
  });

  it('denies FEATURE_FLAG_OFF before checking the add-on or key', async () => {
    mocks.isFeatureFlagEnabled.mockResolvedValue(false);
    await expect(evaluateSmartTicketSearchAccess(user)).resolves.toMatchObject({ allowed: false, reason: 'FEATURE_FLAG_OFF' });
    expect(mocks.assertTenantAddOnAccess).not.toHaveBeenCalled();
    expect(mocks.isConfigured).not.toHaveBeenCalled();
  });

  it('denies ADD_ON_REQUIRED with the add-on message when the tenant lacks AI Assistant', async () => {
    const { AddOnAccessError } = await import('server/src/lib/tier-gating/assertAddOnAccess');
    mocks.assertTenantAddOnAccess.mockRejectedValue(new AddOnAccessError('ai_assistant' as never));
    await expect(evaluateSmartTicketSearchAccess(user)).resolves.toMatchObject({
      allowed: false,
      reason: 'ADD_ON_REQUIRED',
      message: expect.stringContaining('add-on'),
    });
    expect(mocks.isConfigured).not.toHaveBeenCalled();
  });

  it('rethrows unexpected add-on lookup failures instead of hiding them', async () => {
    mocks.assertTenantAddOnAccess.mockRejectedValue(new Error('db down'));
    await expect(evaluateSmartTicketSearchAccess(user)).rejects.toThrow('db down');
  });

  it('denies SMART_SEARCH_NOT_CONFIGURED last', async () => {
    mocks.isConfigured.mockResolvedValue(false);
    await expect(evaluateSmartTicketSearchAccess(user)).resolves.toMatchObject({ allowed: false, reason: 'SMART_SEARCH_NOT_CONFIGURED' });
  });
});
