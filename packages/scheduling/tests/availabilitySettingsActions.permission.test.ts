import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const hasPermissionMock = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
  currentUser: {
    user_id: 'user-1',
    tenant: 'tenant-1',
  },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  withTransaction: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(authState.currentUser, { tenant: authState.currentUser.tenant }, ...args),
  hasPermission: hasPermissionMock,
}));

import { setDefaultMeetingOrganizer } from '../src/actions/availabilitySettingsActions';

describe('setDefaultMeetingOrganizer permissions', () => {
  beforeEach(() => {
    createTenantKnexMock.mockReset();
    hasPermissionMock.mockReset();
    createTenantKnexMock.mockResolvedValue({ knex: {} });
  });

  it('rejects callers without system_settings:update permission', async () => {
    hasPermissionMock.mockResolvedValue(false);

    const result = await setDefaultMeetingOrganizer({
      upn: 'organizer@example.com',
    });

    expect(result).toEqual({
      success: false,
      error: 'Insufficient permissions to manage Teams meeting settings',
    });
  });
});
