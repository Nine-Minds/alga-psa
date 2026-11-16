import { beforeEach, describe, expect, it, vi } from 'vitest';

const checkCurrentUserPermissions = vi.fn();
vi.mock('@alga-psa/auth/actions', () => ({
  checkCurrentUserPermissions: (...args: unknown[]) => checkCurrentUserPermissions(...args),
}));

import { resolveCurrentUserGrants } from '../../../lib/auth/currentUserGrants';

describe('resolveCurrentUserGrants', () => {
  beforeEach(() => {
    checkCurrentUserPermissions.mockReset();
  });

  it('asks the hasPermission engine once per distinct key and returns the granted keys', async () => {
    checkCurrentUserPermissions.mockImplementation(async (checks: Array<{ resource: string; action: string }>) =>
      checks.map((c) => ({ ...c, granted: c.resource !== 'ticket' })));

    const granted = await resolveCurrentUserGrants(['ticket:create', 'client:read', 'client:read', 'accounting_integrations:exports_execute']);

    expect(checkCurrentUserPermissions).toHaveBeenCalledTimes(1);
    expect(checkCurrentUserPermissions.mock.calls[0][0]).toEqual([
      { resource: 'ticket', action: 'create' },
      { resource: 'client', action: 'read' },
      { resource: 'accounting_integrations', action: 'exports_execute' },
    ]);
    expect(granted).toEqual(['client:read', 'accounting_integrations:exports_execute']);
  });

  it('returns nothing (hides gated UI) when the check fails, and skips the call for no keys', async () => {
    checkCurrentUserPermissions.mockRejectedValue(new Error('boom'));
    expect(await resolveCurrentUserGrants(['ticket:create'])).toEqual([]);
    checkCurrentUserPermissions.mockReset();
    expect(await resolveCurrentUserGrants([])).toEqual([]);
    expect(checkCurrentUserPermissions).not.toHaveBeenCalled();
  });
});
