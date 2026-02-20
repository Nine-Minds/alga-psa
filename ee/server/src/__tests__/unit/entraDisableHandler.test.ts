import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn();
const runWithTenantMock = vi.fn();

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
}));

function buildDbMocks() {
  const linksSelectMock = vi.fn(async () => [{ contact_name_id: 'contact-103' }]);
  const contactsUpdateMock = vi.fn(async () => 1);
  const linkUpdateMock = vi.fn(async () => 1);

  let linkTableCalls = 0;
  const trxMock = Object.assign(
    vi.fn((table: string) => {
      if (table === 'entra_contact_links') {
        return {
          where: vi.fn(() => {
            linkTableCalls += 1;
            return linkTableCalls === 1 ? { select: linksSelectMock } : { update: linkUpdateMock };
          }),
        };
      }

      if (table === 'contacts') {
        return {
          where: vi.fn(() => ({
            whereIn: vi.fn(() => ({
              update: contactsUpdateMock,
            })),
          })),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
    {
      fn: {
        now: vi.fn(() => 'db-now'),
      },
    }
  );

  const knexMock = {
    transaction: vi.fn(async (callback: (trx: typeof trxMock) => Promise<unknown>) => callback(trxMock)),
  };

  return {
    createTenantKnexValue: { knex: knexMock },
    contactsUpdateMock,
    linkUpdateMock,
  };
}

describe('disableHandler', () => {
  beforeEach(() => {
    vi.resetModules();
    createTenantKnexMock.mockReset();
    runWithTenantMock.mockReset();
    runWithTenantMock.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
  });

  it('T103: disabled upstream users mark linked contacts inactive with disabled reason', async () => {
    const { createTenantKnexValue, contactsUpdateMock, linkUpdateMock } = buildDbMocks();
    createTenantKnexMock.mockResolvedValue(createTenantKnexValue);

    const { markDisabledEntraUsersInactive } = await import(
      '@ee/lib/integrations/entra/sync/disableHandler'
    );

    const updated = await markDisabledEntraUsersInactive('tenant-103', [
      {
        entraTenantId: 'entra-tenant-103',
        entraObjectId: 'entra-object-103',
      },
    ]);

    expect(updated).toBe(1);
    expect(contactsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        is_inactive: true,
        entra_account_enabled: false,
        entra_sync_status: 'inactive',
        entra_sync_status_reason: 'disabled_upstream',
        last_entra_sync_at: 'db-now',
      })
    );
    expect(linkUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        is_active: false,
        link_status: 'inactive',
      })
    );
  });
});
