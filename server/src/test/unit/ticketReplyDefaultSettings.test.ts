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

describe('tenant-wide ticket reply default settings', () => {
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

  it('keeps the existing public default for tenants without the setting', async () => {
    expect(await getTicketingDisplaySettings()).toMatchObject({ defaultReplyInternal: false });
    expect(mocks.tenantDb).toHaveBeenCalledWith({}, 'tenant-1');
  });

  it.each([true, false])('reads %s from the dedicated column', async (value) => {
    mocks.first.mockResolvedValue({ ticket_display_settings: { defaultReplyInternal: value } });
    expect(await getTicketingDisplaySettings()).toMatchObject({ defaultReplyInternal: value });
  });

  it('reads the legacy nested settings when the dedicated column is empty', async () => {
    mocks.first.mockResolvedValue({
      ticket_display_settings: {},
      settings: { ticketing: { display: { defaultReplyInternal: true } } },
    });
    expect(await getTicketingDisplaySettings()).toMatchObject({ defaultReplyInternal: true });
  });

  it.each([true, false])('persists %s to both settings paths without deleting other settings', async (value) => {
    const display = { showWeekday: true, list: { densityLevel: 70 }, defaultReplyInternal: !value };
    mocks.first.mockResolvedValue({
      ticket_display_settings: display,
      settings: { other: 'kept', ticketing: { display } },
    });
    expect(await updateTicketingDisplaySettings({ defaultReplyInternal: value })).toEqual({ success: true });
    const saved = mocks.insert.mock.calls[0][0];
    expect(saved.tenant).toBe('tenant-1');
    expect(JSON.parse(saved.ticket_display_settings)).toEqual({ ...display, defaultReplyInternal: value });
    expect(JSON.parse(saved.settings)).toEqual({
      other: 'kept',
      ticketing: { display: { ...display, defaultReplyInternal: value } },
    });
  });

  it('preserves the reply default when a ticket-list view saves', async () => {
    mocks.first.mockResolvedValue({ ticket_display_settings: { defaultReplyInternal: true } });
    await updateTicketingDisplaySettings({ list: { densityLevel: 30 } });
    expect(JSON.parse(mocks.insert.mock.calls[0][0].ticket_display_settings).defaultReplyInternal).toBe(true);
  });

  it('requires ticket settings update permission', async () => {
    mocks.permission.mockResolvedValue(false);
    expect(await updateTicketingDisplaySettings({ defaultReplyInternal: true })).toMatchObject({
      messageKey: 'features/tickets:errors.settings.updateDenied',
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean instead of persisting an invalid setting', async () => {
    await expect(Reflect.apply(updateTicketingDisplaySettings, undefined, [{ defaultReplyInternal: 'true' }]))
      .rejects.toThrow('defaultReplyInternal must be a boolean');
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
