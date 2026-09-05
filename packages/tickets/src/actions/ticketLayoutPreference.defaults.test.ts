// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;

const userPreferencesGetMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => conn(table).where({ tenant }),
  }),
  withTransaction: async (_knex: unknown, callback: (trx: any) => Promise<unknown>) => {
    // Minimal query-builder stand-in: the action only reads the current user row.
    const builder: any = {
      where: () => builder,
      first: async () => ({ user_id: currentUser.user_id }),
    };
    const trx = (_table: string) => builder;
    return callback(trx);
  },
  UserPreferences: {
    get: (...args: any[]) => userPreferencesGetMock(...args),
    upsert: vi.fn(),
  },
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  actionError: (message: string) => ({ error: message }),
  permissionError: (message: string) => ({ error: message }),
}));

const { getTicketLayoutPreference } = await import('./ticketLayoutPreference');

describe('getTicketLayoutPreference defaults', () => {
  beforeEach(() => {
    currentUser = { user_id: 'user-1', tenant: 'tenant-1', user_type: 'internal' };
    userPreferencesGetMock.mockReset();
  });

  it('defaults to the Grid layout when the user has never chosen one', async () => {
    userPreferencesGetMock.mockResolvedValue(undefined);

    await expect(getTicketLayoutPreference()).resolves.toEqual({
      layout: 'grid',
      timelineOrder: 'asc',
    });
  });

  it("keeps the Entry layout for a user who affirmatively stored 'entry'", async () => {
    userPreferencesGetMock.mockImplementation(async (_trx: unknown, _userId: string, setting: string) =>
      setting === 'ticket_detail_layout' ? { setting_value: '"entry"' } : undefined,
    );

    await expect(getTicketLayoutPreference()).resolves.toEqual({
      layout: 'entry',
      timelineOrder: 'asc',
    });
  });

  it('falls back to Grid when the stored layout value is not a known layout', async () => {
    userPreferencesGetMock.mockImplementation(async (_trx: unknown, _userId: string, setting: string) =>
      setting === 'ticket_detail_layout' ? { setting_value: '"bento-deluxe"' } : undefined,
    );

    await expect(getTicketLayoutPreference()).resolves.toEqual({
      layout: 'grid',
      timelineOrder: 'asc',
    });
  });
});
