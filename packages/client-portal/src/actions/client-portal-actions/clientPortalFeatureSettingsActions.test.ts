import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;
let storedSettings: unknown;

const hasPermissionMock = vi.fn();
const mergeMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn().mockResolvedValue({ knex: {} }),
  tenantDb: vi.fn(() => ({
    table: vi.fn(() => ({
      select: vi.fn(() => ({
        first: vi.fn().mockImplementation(async () => ({ settings: storedSettings })),
      })),
      insert: vi.fn((value: { settings: string }) => ({
        onConflict: vi.fn(() => ({
          merge: vi.fn(async (merged: { settings: string }) => {
            storedSettings = JSON.parse(merged.settings);
            mergeMock(value, merged);
          }),
        })),
      })),
    })),
  })),
}));

describe('client portal feature settings actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = {
      user_id: 'internal-user-1',
      user_type: 'internal',
      tenant: 'tenant-1',
    };
    storedSettings = {};
    hasPermissionMock.mockResolvedValue(true);
  });

  it('defaults appointments to enabled for existing tenants', async () => {
    const { getClientPortalFeatureSettings } = await import(
      './clientPortalFeatureSettingsActions'
    );

    await expect(getClientPortalFeatureSettings()).resolves.toEqual({
      appointmentsEnabled: true,
    });
  });

  it('updates the appointment flag without replacing other tenant settings', async () => {
    storedSettings = {
      branding: { clientName: 'Example MSP' },
      clientPortal: { defaultLocale: 'en' },
    };
    const { updateClientPortalFeatureSettings } = await import(
      './clientPortalFeatureSettingsActions'
    );

    await expect(updateClientPortalFeatureSettings({
      appointmentsEnabled: false,
    })).resolves.toEqual({
      appointmentsEnabled: false,
    });

    expect(storedSettings).toEqual({
      branding: { clientName: 'Example MSP' },
      clientPortal: {
        defaultLocale: 'en',
        appointmentsEnabled: false,
      },
    });
    expect(mergeMock).toHaveBeenCalledOnce();
  });

  it('requires settings:update permission', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const { updateClientPortalFeatureSettings } = await import(
      './clientPortalFeatureSettingsActions'
    );

    await expect(updateClientPortalFeatureSettings({
      appointmentsEnabled: false,
    })).resolves.toEqual({
      permissionError: 'Permission denied: settings:update required',
      messageKey: 'client-portal:errors.access.settingsUpdate',
    });
    expect(mergeMock).not.toHaveBeenCalled();
  });
});
