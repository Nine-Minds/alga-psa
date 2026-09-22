import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  assertTenantAddOnAccess: vi.fn(),
  isConfigured: vi.fn(),
}));

vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('server/src/lib/tier-gating/assertAddOnAccess', () => {
  class AddOnAccessError extends Error {
    constructor(readonly addOn: string) {
      super(`This feature requires the ${addOn} add-on.`);
      this.name = 'AddOnAccessError';
    }
  }
  return { AddOnAccessError, assertTenantAddOnAccess: mocks.assertTenantAddOnAccess };
});
vi.mock('../../services/smartSearch/typesafeClient', () => ({
  isSmartSearchConfigured: mocks.isConfigured,
}));

import { evaluateSmartSearchAccess } from '../../services/smartSearch/access';

const user = { user_id: 'u1', tenant: 't1' } as never;
const tickets = { permissionResource: 'ticket', noun: 'tickets' };
const projects = { permissionResource: 'project', noun: 'projects' };

beforeEach(() => {
  for (const fn of Object.values(mocks) as Array<{ mockReset: () => void }>) fn.mockReset();
  mocks.hasPermission.mockResolvedValue(true);
  mocks.assertTenantAddOnAccess.mockResolvedValue(undefined);
  mocks.isConfigured.mockResolvedValue(true);
});

describe('evaluateSmartSearchAccess', () => {
  it('allows when permission, AI add-on, and key all hold', async () => {
    await expect(evaluateSmartSearchAccess(user, tickets)).resolves.toEqual({ allowed: true });
    expect(mocks.hasPermission).toHaveBeenCalledWith(user, 'ticket', 'read');
    expect(mocks.assertTenantAddOnAccess).toHaveBeenCalledWith('t1', 'ai_assistant');
  });

  it('checks the read permission of the entity it is asked about', async () => {
    await evaluateSmartSearchAccess(user, projects);
    expect(mocks.hasPermission).toHaveBeenCalledWith(user, 'project', 'read');
  });

  it('denies FORBIDDEN first, naming the entity, and stops there', async () => {
    mocks.hasPermission.mockResolvedValue(false);
    await expect(evaluateSmartSearchAccess(user, projects)).resolves.toMatchObject({
      allowed: false,
      reason: 'FORBIDDEN',
      message: expect.stringContaining('projects'),
    });
    expect(mocks.assertTenantAddOnAccess).not.toHaveBeenCalled();
  });

  it('denies ADD_ON_REQUIRED with the add-on message when the tenant lacks AI Assistant', async () => {
    const { AddOnAccessError } = await import('server/src/lib/tier-gating/assertAddOnAccess');
    mocks.assertTenantAddOnAccess.mockRejectedValue(new AddOnAccessError('ai_assistant' as never));
    await expect(evaluateSmartSearchAccess(user, tickets)).resolves.toMatchObject({
      allowed: false,
      reason: 'ADD_ON_REQUIRED',
      message: expect.stringContaining('add-on'),
    });
    expect(mocks.isConfigured).not.toHaveBeenCalled();
  });

  it('rethrows unexpected add-on lookup failures instead of hiding them', async () => {
    mocks.assertTenantAddOnAccess.mockRejectedValue(new Error('db down'));
    await expect(evaluateSmartSearchAccess(user, tickets)).rejects.toThrow('db down');
  });

  it('denies SMART_SEARCH_NOT_CONFIGURED last', async () => {
    mocks.isConfigured.mockResolvedValue(false);
    await expect(evaluateSmartSearchAccess(user, tickets)).resolves.toMatchObject({ allowed: false, reason: 'SMART_SEARCH_NOT_CONFIGURED' });
  });
});
