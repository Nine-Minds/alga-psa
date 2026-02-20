import { describe, expect, it, vi } from 'vitest';
import { upsertEntraContactLinkActive } from '@ee/lib/integrations/entra/sync/contactLinkRepository';

function buildUser(seed: string) {
  return {
    entraTenantId: `entra-tenant-${seed}`,
    entraObjectId: `entra-object-${seed}`,
    userPrincipalName: `user${seed}@example.com`,
    email: `user${seed}@example.com`,
    displayName: `User ${seed}`,
    givenName: 'User',
    surname: seed,
    accountEnabled: true,
    jobTitle: null,
    mobilePhone: null,
    businessPhones: [],
    raw: {},
  };
}

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
      user: buildUser('107'),
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

  it('T113: repeated sync upserts keep a single link row per tenant/Entra identity key', async () => {
    const rowStore = new Map<string, Record<string, unknown>>();
    const trxMock = Object.assign(
      vi.fn((table: string) => {
        if (table !== 'entra_contact_links') {
          throw new Error(`Unexpected table ${table}`);
        }

        return {
          insert: (insertRow: Record<string, unknown>) => ({
            onConflict: () => ({
              merge: (mergeRow: Record<string, unknown>) => {
                const key = [
                  insertRow.tenant,
                  insertRow.entra_tenant_id,
                  insertRow.entra_object_id,
                ].join('|');
                const existing = rowStore.get(key) || {};
                rowStore.set(
                  key,
                  rowStore.has(key)
                    ? { ...existing, ...mergeRow }
                    : { ...existing, ...insertRow }
                );
              },
            }),
          }),
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
      tenantId: 'tenant-113',
      clientId: 'client-original-113',
      contactNameId: 'contact-original-113',
      user: buildUser('113'),
    });
    await upsertEntraContactLinkActive(trxMock, {
      tenantId: 'tenant-113',
      clientId: 'client-remapped-113',
      contactNameId: 'contact-remapped-113',
      user: buildUser('113'),
    });

    const storedRows = Array.from(rowStore.values());
    expect(storedRows).toHaveLength(1);
    expect(storedRows[0]).toMatchObject({
      contact_name_id: 'contact-remapped-113',
      client_id: 'client-remapped-113',
      link_status: 'active',
      is_active: true,
      last_seen_at: 'db-now',
    });
  });
});
