import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  user: { user_id: 'user-1', tenant: 'tenant-1', user_type: 'internal' } as Record<string, unknown>,
  allowed: true,
  hasPermission: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  readDontNotifyCustomerDefault: vi.fn(),
  revalidatePath: vi.fn(),
  knex: { name: 'knex' },
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(h.user, { tenant: 'tenant-1' }, ...args),
  hasPermission: h.hasPermission,
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: h.knex, tenant: 'tenant-1' })),
  tenantDb: vi.fn(),
  // The auth checks run inside the transaction callback, so the stub must
  // invoke it or the permission gate would never be exercised.
  withTransaction: vi.fn(async (_knex: unknown, callback: (trx: unknown) => unknown) =>
    callback({ name: 'trx' })),
}));
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }));
vi.mock('@alga-psa/email', () => ({ TenantEmailService: {} }));
vi.mock('@alga-psa/notifications/notifications/email', () => ({
  getEmailNotificationService: () => ({
    getSettings: h.getSettings,
    updateSettings: h.updateSettings,
  }),
}));
vi.mock('@alga-psa/notifications/notifications/notificationPolicy', () => ({
  readDontNotifyCustomerDefault: h.readDontNotifyCustomerDefault,
}));
vi.mock('@alga-psa/notifications/notifications/userEmailPreferences', () => ({
  readUserEmailPreferenceState: vi.fn(),
  saveUserEmailPreferences: vi.fn(),
}));

import {
  getDontNotifyCustomerDefaultAction,
  getNotificationSettingsAction,
  updateNotificationSettingsAction,
} from '@alga-psa/notifications/actions/notification-actions/notificationActions';

const settingsRow = {
  id: 1,
  tenant: 'tenant-1',
  is_enabled: true,
  default_dont_notify_customer: false,
  rate_limit_per_minute: 60,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { user_id: 'user-1', tenant: 'tenant-1', user_type: 'internal' };
  h.allowed = true;
  h.hasPermission.mockImplementation(async () => h.allowed);
  h.getSettings.mockResolvedValue(settingsRow);
  h.updateSettings.mockImplementation(async (_tenant: string, update: object) => ({ ...settingsRow, ...update }));
  h.readDontNotifyCustomerDefault.mockResolvedValue(true);
});

describe('getNotificationSettingsAction', () => {
  it('reads the session tenant settings with settings:read', async () => {
    await expect(getNotificationSettingsAction()).resolves.toEqual(settingsRow);
    expect(h.hasPermission).toHaveBeenCalledWith(h.user, 'settings', 'read', expect.anything());
    expect(h.getSettings).toHaveBeenCalledWith('tenant-1');
  });

  it('rejects a user without settings:read', async () => {
    h.allowed = false;
    await expect(getNotificationSettingsAction()).rejects.toThrow('Permission denied');
    expect(h.getSettings).not.toHaveBeenCalled();
  });
});

describe('updateNotificationSettingsAction', () => {
  it('writes only the allowed boolean fields to the session tenant', async () => {
    const result = await updateNotificationSettingsAction({ default_dont_notify_customer: true });

    expect(h.hasPermission).toHaveBeenCalledWith(h.user, 'settings', 'update', expect.anything());
    expect(h.updateSettings).toHaveBeenCalledWith('tenant-1', { default_dont_notify_customer: true });
    expect(result.default_dont_notify_customer).toBe(true);
    expect(h.revalidatePath).toHaveBeenCalledWith('/msp/settings/notifications');
    expect(h.revalidatePath).toHaveBeenCalledWith('/msp', 'layout');
  });

  it('ensures the tenant row exists before updating', async () => {
    await updateNotificationSettingsAction({ is_enabled: false });
    expect(h.getSettings.mock.invocationCallOrder[0]).toBeLessThan(h.updateSettings.mock.invocationCallOrder[0]);
  });

  it('rejects a user without settings:update', async () => {
    h.allowed = false;
    await expect(updateNotificationSettingsAction({ is_enabled: false })).rejects.toThrow('Permission denied');
    expect(h.updateSettings).not.toHaveBeenCalled();
  });

  it.each([
    [{ tenant: 'tenant-2' }, 'cannot update: tenant'],
    [{ rate_limit_per_minute: 1 }, 'cannot update: rate_limit_per_minute'],
    [{ is_enabled: 'false' }, 'is_enabled must be a boolean'],
    [{ default_dont_notify_customer: 1 }, 'default_dont_notify_customer must be a boolean'],
    [{}, 'has no changes'],
    [null, 'must be an object'],
  ])('rejects %j', async (input, message) => {
    await expect(updateNotificationSettingsAction(input as any)).rejects.toThrow(message);
    expect(h.updateSettings).not.toHaveBeenCalled();
  });
});

describe('getDontNotifyCustomerDefaultAction', () => {
  it('returns the tenant policy to any internal user without a settings permission', async () => {
    h.allowed = false;
    await expect(getDontNotifyCustomerDefaultAction()).resolves.toBe(true);
    expect(h.readDontNotifyCustomerDefault).toHaveBeenCalledWith(h.knex, 'tenant-1');
    expect(h.hasPermission).not.toHaveBeenCalled();
  });

  it('returns false for client portal users without reading', async () => {
    h.user = { user_id: 'user-2', tenant: 'tenant-1', user_type: 'client' };
    await expect(getDontNotifyCustomerDefaultAction()).resolves.toBe(false);
    expect(h.readDontNotifyCustomerDefault).not.toHaveBeenCalled();
  });
});
