import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.fn();
const runWithTenantMock = vi.fn();
const randomUUIDMock = vi.fn(() => 'queue-item-115');

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
}));

vi.mock('crypto', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('crypto');
  return {
    ...actual,
    randomUUID: randomUUIDMock,
  };
});

describe('queueAmbiguousEntraMatch', () => {
  beforeEach(() => {
    vi.resetModules();
    createTenantKnexMock.mockReset();
    runWithTenantMock.mockReset();
    randomUUIDMock.mockClear();
    runWithTenantMock.mockImplementation(async (_tenant: string, fn: () => Promise<unknown>) => fn());
  });

  it('T115: inserts queue item with tenant/client context and candidate detail payload', async () => {
    const firstMock = vi.fn(async () => null);
    const insertMock = vi.fn(async () => 1);
    const rawMock = vi.fn((sql: string, args: unknown[]) => ({ sql, args }));

    const knexMock = Object.assign(
      vi.fn((table: string) => {
        if (table !== 'entra_contact_reconciliation_queue') {
          throw new Error(`Unexpected table ${table}`);
        }

        return {
          where: vi.fn(() => ({
            first: firstMock,
          })),
          insert: insertMock,
        };
      }),
      {
        fn: {
          now: vi.fn(() => 'db-now'),
        },
        raw: rawMock,
      }
    );

    createTenantKnexMock.mockResolvedValue({ knex: knexMock });

    const { queueAmbiguousEntraMatch } = await import(
      '@ee/lib/integrations/entra/reconciliationQueueService'
    );

    const result = await queueAmbiguousEntraMatch({
      tenantId: 'tenant-115',
      managedTenantId: 'managed-115',
      clientId: 'client-115',
      user: {
        entraTenantId: 'entra-tenant-115',
        entraObjectId: 'entra-object-115',
        userPrincipalName: 'user115@example.com',
        email: 'user115@example.com',
        displayName: 'User 115',
        givenName: 'User',
        surname: '115',
        accountEnabled: true,
        jobTitle: null,
        mobilePhone: null,
        businessPhones: [],
        raw: {},
      },
      candidates: [
        {
          contactNameId: 'contact-115-a',
          clientId: 'client-115',
          email: 'user115@example.com',
          fullName: 'Candidate A',
          isInactive: false,
        },
        {
          contactNameId: 'contact-115-b',
          clientId: 'client-115',
          email: 'user115@example.com',
          fullName: 'Candidate B',
          isInactive: true,
        },
      ],
    });

    expect(result).toEqual({ queueItemId: 'queue-item-115' });
    expect(insertMock).toHaveBeenCalledTimes(1);

    const insertedRow = insertMock.mock.calls[0][0];
    expect(insertedRow).toMatchObject({
      tenant: 'tenant-115',
      queue_item_id: 'queue-item-115',
      managed_tenant_id: 'managed-115',
      client_id: 'client-115',
      entra_tenant_id: 'entra-tenant-115',
      entra_object_id: 'entra-object-115',
      status: 'open',
      created_at: 'db-now',
      updated_at: 'db-now',
    });

    const serializedCandidates = JSON.parse(
      String((insertedRow.candidate_contacts as { args: unknown[] }).args[0])
    );
    expect(serializedCandidates).toEqual([
      {
        contactNameId: 'contact-115-a',
        clientId: 'client-115',
        email: 'user115@example.com',
        fullName: 'Candidate A',
        isInactive: false,
      },
      {
        contactNameId: 'contact-115-b',
        clientId: 'client-115',
        email: 'user115@example.com',
        fullName: 'Candidate B',
        isInactive: true,
      },
    ]);

    const payload = JSON.parse(String((insertedRow.payload as { args: unknown[] }).args[0]));
    expect(payload).toEqual({
      reason: 'multiple_email_matches',
      candidateCount: 2,
    });
  });
});
