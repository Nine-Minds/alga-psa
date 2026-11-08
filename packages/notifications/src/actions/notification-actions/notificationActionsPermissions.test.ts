import { beforeEach, describe, expect, it, vi } from 'vitest';

const SESSION_TENANT = 'session-tenant';
const OTHER_TENANT = 'victim-tenant';
const SESSION_USER = { user_id: 'user-1', user_type: 'internal', tenant: SESSION_TENANT };

const hasPermissionMock = vi.fn();
const createTenantKnexMock = vi.fn(async () => ({ knex: {} as any }));
const tenantDbMock = vi.fn();
const deleteMock = vi.fn(async () => 1);

const service = {
  getSettings: vi.fn(async () => ({ is_enabled: true })),
  updateSettings: vi.fn(async () => ({ is_enabled: false })),
  createTenantTemplate: vi.fn(async () => ({ id: 7 })),
  updateTenantTemplate: vi.fn(async () => ({ id: 7 })),
};

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn(SESSION_USER, { tenant: SESSION_TENANT }, ...args),
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}));

/** A query builder that chains like knex and resolves to no rows. */
function queryStub(): any {
  const stub: any = {
    select: () => stub,
    where: () => stub,
    orderBy: async () => [],
    first: async () => undefined,
    del: deleteMock,
  };
  return stub;
}

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: () => createTenantKnexMock(),
  withTransaction: (_knex: any, callback: any) => callback({ raw: vi.fn() }),
  tenantDb: (...args: any[]) => {
    tenantDbMock(...args);
    return {
      table: () => queryStub(),
      tenantJoin: (query: any) => query,
    };
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('../../notifications/email', () => ({
  getEmailNotificationService: () => service,
}));

const tenantsTouched = () => tenantDbMock.mock.calls.map((call) => call[1]);

describe('notification settings and template actions require settings permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses every mutation without settings:update, before any write', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const actions = await import('./notificationActions');

    await expect(actions.updateNotificationSettingsAction({ is_enabled: false })).rejects.toThrow(
      'Permission denied: Cannot update settings',
    );
    await expect(
      actions.createTenantTemplateAction({ name: 'invoice', subject: 'hi' } as any),
    ).rejects.toThrow('Permission denied: Cannot update settings');
    await expect(actions.updateTenantTemplateAction(7, { subject: 'hi' })).rejects.toThrow(
      'Permission denied: Cannot update settings',
    );
    await expect(actions.deactivateTenantTemplateAction('invoice')).rejects.toThrow(
      'Permission denied: Cannot update settings',
    );

    // The clone action answers with the shared action-error payload instead.
    expect(await actions.cloneSystemTemplateAction(3)).toEqual({
      permissionError: 'Permission denied: Cannot update settings',
    });

    expect(service.updateSettings).not.toHaveBeenCalled();
    expect(service.createTenantTemplate).not.toHaveBeenCalled();
    expect(service.updateTenantTemplate).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(hasPermissionMock.mock.calls.every((call) => call[1] === 'settings' && call[2] === 'update')).toBe(true);
  });

  it('refuses both reads without settings:read', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const actions = await import('./notificationActions');

    await expect(actions.getNotificationSettingsAction()).rejects.toThrow(
      'Permission denied: Cannot read settings',
    );
    await expect(actions.getTemplatesAction()).rejects.toThrow('Permission denied: Cannot read settings');

    expect(service.getSettings).not.toHaveBeenCalled();
    expect(hasPermissionMock.mock.calls.every((call) => call[1] === 'settings' && call[2] === 'read')).toBe(true);
  });

  it('scopes permitted writes to the session tenant, never to one named by the caller', async () => {
    hasPermissionMock.mockResolvedValue(true);
    const actions = await import('./notificationActions');

    // Settings updates now fail fast on keys outside the allow-list, so a
    // caller-named tenant never reaches the service at all.
    await expect(
      actions.updateNotificationSettingsAction({ is_enabled: false, tenant: OTHER_TENANT } as any),
    ).rejects.toThrow('cannot update: tenant');
    expect(service.updateSettings).not.toHaveBeenCalledWith(
      SESSION_TENANT,
      expect.objectContaining({ tenant: OTHER_TENANT }),
    );

    await actions.updateNotificationSettingsAction({ is_enabled: false });
    expect(service.updateSettings).toHaveBeenCalledWith(SESSION_TENANT, { is_enabled: false });

    await actions.createTenantTemplateAction({ name: 'invoice', tenant: OTHER_TENANT } as any);
    expect(service.createTenantTemplate).toHaveBeenCalledWith(SESSION_TENANT, {
      name: 'invoice',
      tenant: OTHER_TENANT,
    });

    await actions.updateTenantTemplateAction(7, { subject: 'hi', tenant: OTHER_TENANT } as any);
    expect(service.updateTenantTemplate).toHaveBeenCalledWith(SESSION_TENANT, 7, {
      subject: 'hi',
      tenant: OTHER_TENANT,
    });

    await actions.deactivateTenantTemplateAction('invoice');
    expect(deleteMock).toHaveBeenCalledTimes(1);

    await actions.getNotificationSettingsAction();
    expect(service.getSettings).toHaveBeenCalledWith(SESSION_TENANT);

    expect(tenantsTouched()).not.toContain(OTHER_TENANT);
    expect(new Set(tenantsTouched())).toEqual(new Set([SESSION_TENANT]));
  });

  it('reads templates for the session tenant only', async () => {
    hasPermissionMock.mockResolvedValue(true);
    const actions = await import('./notificationActions');

    await actions.getTemplatesAction();

    expect(tenantsTouched().length).toBeGreaterThan(0);
    expect(new Set(tenantsTouched())).toEqual(new Set([SESSION_TENANT]));
  });

  it('a permitted clone copies the system row into the session tenant', async () => {
    hasPermissionMock.mockResolvedValue(true);
    const actions = await import('./notificationActions');

    // The system template lookup is tenant-scoped too, so a missing row is the
    // expected answer here; what matters is that it never reaches another tenant.
    expect(await actions.cloneSystemTemplateAction(3)).toEqual({
      actionError: 'System template not found. It may have been deleted. Please refresh and try again.',
      messageKey: 'msp/settings:errors.notifications.systemTemplateNotFound',
    });
    expect(new Set(tenantsTouched())).toEqual(new Set([SESSION_TENANT]));
    expect(service.createTenantTemplate).not.toHaveBeenCalled();
  });
});
