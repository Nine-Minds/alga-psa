// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTicketingDisplaySettings, updateTicketingDisplaySettings } from '@alga-psa/tickets/actions/ticketDisplaySettings';

const mocks = vi.hoisted(() => ({
  first: vi.fn(),
  insert: vi.fn(),
  merge: vi.fn(),
  permission: vi.fn(),
  tenantDb: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...args: unknown[]) => unknown) => (...args: unknown[]) =>
    fn({ user_id: 'agent-1' }, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.permission }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: mocks.tenantDb,
}));

describe('tenant-wide dont-notify-customer default setting', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.permission.mockResolvedValue(true);
    mocks.first.mockResolvedValue(null);
    mocks.merge.mockResolvedValue(undefined);
    mocks.insert.mockReturnValue({ onConflict: () => ({ merge: mocks.merge }) });
    mocks.tenantDb.mockReturnValue({
      table: () => ({
        select: () => ({ first: mocks.first }),
        insert: mocks.insert,
      }),
    });
  });

  it('defaults to false for tenants without the setting', async () => {
    expect(await getTicketingDisplaySettings()).toMatchObject({ defaultDontNotifyCustomer: false });
  });

  it.each([true, false])('reads %s from the dedicated column', async (value) => {
    mocks.first.mockResolvedValue({ ticket_display_settings: { defaultDontNotifyCustomer: value } });
    expect(await getTicketingDisplaySettings()).toMatchObject({ defaultDontNotifyCustomer: value });
  });

  it('reads the legacy nested settings when the dedicated column is empty', async () => {
    mocks.first.mockResolvedValue({
      ticket_display_settings: {},
      settings: { ticketing: { display: { defaultDontNotifyCustomer: true } } },
    });
    expect(await getTicketingDisplaySettings()).toMatchObject({ defaultDontNotifyCustomer: true });
  });

  it('coerces non-boolean stored values to false', async () => {
    mocks.first.mockResolvedValue({ ticket_display_settings: { defaultDontNotifyCustomer: 'yes' } });
    expect(await getTicketingDisplaySettings()).toMatchObject({ defaultDontNotifyCustomer: false });
  });

  it.each([true, false])('persists %s to both settings paths', async (value) => {
    const display = { showWeekday: true, defaultReplyInternal: true };
    mocks.first.mockResolvedValue({
      ticket_display_settings: display,
      settings: { other: 'kept', ticketing: { display } },
    });
    expect(await updateTicketingDisplaySettings({ defaultDontNotifyCustomer: value })).toEqual({ success: true });
    const saved = JSON.parse(mocks.insert.mock.calls[0][0].ticket_display_settings);
    expect(saved.defaultDontNotifyCustomer).toBe(value);
    // The reply default is a different switch and must survive the save.
    expect(saved.defaultReplyInternal).toBe(true);
  });

  it('preserves the notify default when a ticket-list view saves', async () => {
    mocks.first.mockResolvedValue({ ticket_display_settings: { defaultDontNotifyCustomer: true } });
    await updateTicketingDisplaySettings({ list: { densityLevel: 30 } });
    expect(JSON.parse(mocks.insert.mock.calls[0][0].ticket_display_settings).defaultDontNotifyCustomer).toBe(true);
  });

  it('rejects a non-boolean instead of persisting an invalid setting', async () => {
    await expect(Reflect.apply(updateTicketingDisplaySettings, undefined, [{ defaultDontNotifyCustomer: 'true' }]))
      .rejects.toThrow('defaultDontNotifyCustomer must be a boolean');
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
