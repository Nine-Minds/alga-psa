import { describe, expect, it, vi } from 'vitest';
import { upsertEntraContactLinkActive } from '@ee/lib/integrations/entra/sync/contactLinkRepository';

describe('upsertEntraContactLinkActive', () => {
  it('T107: refreshes last_seen_at and active link status on sync upsert', async () => {
    const mergeMock = vi.fn(async () => undefined);
    const onConflictMock = vi.fn(() => ({
      merge: mergeMock,
    }));
    const insertMock = vi.fn(() => ({
      onConflict: onConflictMock,
    }));

    const trxMock = Object.assign(
      vi.fn((table: string) => {
        if (table !== 'entra_contact_links') {
          throw new Error(`Unexpected table ${table}`);
        }

        return {
          insert: insertMock,
        };
      }),
      {
        fn: {
          now: vi.fn(() => 'db-now'),
        },
        raw: vi.fn(() => 'raw-empty-json'),
      }
    ) as any;

    await upsertEntraContactLinkActive(trxMock, {
      tenantId: 'tenant-107',
      clientId: 'client-107',
      contactNameId: 'contact-107',
      user: {
        entraTenantId: 'entra-tenant-107',
        entraObjectId: 'entra-object-107',
        userPrincipalName: 'user107@example.com',
        email: 'user107@example.com',
        displayName: 'User 107',
        givenName: 'User',
        surname: '107',
        accountEnabled: true,
        jobTitle: null,
        mobilePhone: null,
        businessPhones: [],
        raw: {},
      },
    });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: 'tenant-107',
        link_status: 'active',
        is_active: true,
        last_seen_at: 'db-now',
        last_synced_at: 'db-now',
      })
    );
    expect(onConflictMock).toHaveBeenCalledWith(['tenant', 'entra_tenant_id', 'entra_object_id']);
    expect(mergeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        link_status: 'active',
        is_active: true,
        last_seen_at: 'db-now',
        last_synced_at: 'db-now',
      })
    );
  });
});
