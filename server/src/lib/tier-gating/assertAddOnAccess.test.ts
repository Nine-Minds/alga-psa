import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ADD_ONS } from '@alga-psa/types';

const getSession = vi.fn();
const getActiveAddOns = vi.fn();
const enterpriseState = vi.hoisted(() => ({ value: true }));

vi.mock('@alga-psa/auth', () => ({
  getSession: (...args: unknown[]) => getSession(...args),
}));

vi.mock('../features', () => ({
  get isEnterprise() {
    return enterpriseState.value;
  },
}));

vi.mock('./getActiveAddOns', () => ({
  getActiveAddOns: (...args: unknown[]) => getActiveAddOns(...args),
}));

const { AddOnAccessError, assertAddOnAccess, assertTenantAddOnAccess } = await import('./assertAddOnAccess');

describe('assertAddOnAccess', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    enterpriseState.value = true;
  });

  it('throws when the tenant lacks the requested add-on', async () => {
    getSession.mockResolvedValue({ user: { tenant: 'tenant-123', plan: 'solo' } });
    getActiveAddOns.mockResolvedValue([]);

    await expect(assertAddOnAccess(ADD_ONS.AI_ASSISTANT)).rejects.toThrow(AddOnAccessError);
  });

  it('passes when a Solo tenant has the AI add-on', async () => {
    getSession.mockResolvedValue({ user: { tenant: 'tenant-123', plan: 'solo' } });
    getActiveAddOns.mockResolvedValue([ADD_ONS.AI_ASSISTANT]);

    await expect(assertAddOnAccess(ADD_ONS.AI_ASSISTANT)).resolves.toBeUndefined();
  });

  it('passes when a Pro tenant has the AI add-on', async () => {
    getSession.mockResolvedValue({ user: { tenant: 'tenant-123', plan: 'pro' } });
    getActiveAddOns.mockResolvedValue([ADD_ONS.AI_ASSISTANT]);

    await expect(assertAddOnAccess(ADD_ONS.AI_ASSISTANT)).resolves.toBeUndefined();
  });

  it('passes when a Premium tenant has the AI add-on', async () => {
    getSession.mockResolvedValue({ user: { tenant: 'tenant-123', plan: 'premium' } });
    getActiveAddOns.mockResolvedValue([ADD_ONS.AI_ASSISTANT]);

    await expect(assertAddOnAccess(ADD_ONS.AI_ASSISTANT)).resolves.toBeUndefined();
  });

  it('bypasses checks in CE edition', async () => {
    enterpriseState.value = false;

    await expect(assertAddOnAccess(ADD_ONS.AI_ASSISTANT)).resolves.toBeUndefined();
    expect(getSession).not.toHaveBeenCalled();
    expect(getActiveAddOns).not.toHaveBeenCalled();
  });

  it('throws for tenant-scoped access when the add-on is inactive', async () => {
    getActiveAddOns.mockResolvedValue([]);

    await expect(assertTenantAddOnAccess('tenant-123', ADD_ONS.AI_ASSISTANT)).rejects.toThrow(AddOnAccessError);
  });

  it('passes for tenant-scoped access when the add-on is active', async () => {
    getActiveAddOns.mockResolvedValue([ADD_ONS.AI_ASSISTANT]);

    await expect(assertTenantAddOnAccess('tenant-123', ADD_ONS.AI_ASSISTANT)).resolves.toBeUndefined();
  });
});
