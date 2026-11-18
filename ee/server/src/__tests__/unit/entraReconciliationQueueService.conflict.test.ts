import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withTenantScope } from '../utils/tenantScopedBuilderDouble';
import type { EntraSyncUser } from '@ee/lib/integrations/entra/sync/types';

const createTenantKnexMock = vi.fn();
const runWithTenantMock = vi.fn();
const upsertEntraContactLinkActiveMock = vi.fn();
let uuidCounter = 0;

vi.mock('@/lib/db', () => ({
  createTenantKnex: createTenantKnexMock,
  runWithTenant: runWithTenantMock,
}));

vi.mock('@ee/lib/integrations/entra/sync/contactLinkRepository', () => ({
  upsertEntraContactLinkActive: upsertEntraContactLinkActiveMock,
}));

vi.mock('@alga-psa/shared/models/contactModel', () => ({ ContactModel: { createContact: vi.fn() } }));

vi.mock('crypto', async (importOriginal) => ({
  ...((await importOriginal()) as typeof import('crypto')),
  randomUUID: () => `queue-${++uuidCounter}`,
}));

type Row = Record<string, any>;

/** A tiny in-memory stand-in for the queue and contacts tables, behind the tenant facade. */
function buildStore() {
  const tables: Record<string, Row[]> = { entra_contact_reconciliation_queue: [], contacts: [] };
  const unwrap = (value: any) => (value && typeof value === 'object' && Array.isArray(value.args) ? JSON.parse(value.args[0]) : value);
  const normalize = (row: Row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, unwrap(v)]));

  const builder = (table: string) => {
    const filters: Row[] = [];
    const matching = () => tables[table].filter((row) => filters.every((f) => Object.entries(f).every(([k, v]) => row[k] === v)));
    const qb: Row = {
      where: vi.fn((filter: Row) => { filters.push(filter); return qb; }),
      orderBy: vi.fn(() => qb),
      limit: vi.fn(() => qb),
      first: vi.fn(async () => matching()[0] ?? null),
      select: vi.fn(async () => matching()),
      update: vi.fn(async (patch: Row) => { matching().forEach((row) => Object.assign(row, normalize(patch))); return matching().length; }),
      insert: vi.fn(async (row: Row) => { tables[table].push(normalize(row)); return 1; }),
    };
    return withTenantScope(qb);
  };

  const conn: any = Object.assign(vi.fn((table: string) => builder(table)), {
    fn: { now: vi.fn(() => 'db-now') },
    raw: vi.fn((sql: string, args: unknown[]) => ({ sql, args })),
  });
  conn.transaction = vi.fn(async (cb: (trx: any) => Promise<unknown>) => cb(conn));
  return { tables, conn };
}

function buildUser(): EntraSyncUser {
  return {
    entraTenantId: 'entra-tenant',
    entraObjectId: 'entra-object',
    userPrincipalName: 'ben@muscle.ca',
    email: 'ben@muscle.ca',
    displayName: 'Ben Dixon',
    givenName: 'Ben',
    surname: 'Dixon',
    accountEnabled: true,
    jobTitle: null,
    mobilePhone: null,
    businessPhones: [],
    raw: {},
  } as EntraSyncUser;
}

const owner = {
  kind: 'primary' as const,
  contactNameId: 'owner-contact',
  clientId: 'other-client',
  fullName: 'Benjamin Dixon',
  clientName: 'Muscle Corp',
  isInactive: false,
};

describe('reconciliationQueueService: email_owned_by_other_client', () => {
  let store: ReturnType<typeof buildStore>;

  beforeEach(() => {
    vi.resetModules();
    uuidCounter = 0;
    createTenantKnexMock.mockReset();
    runWithTenantMock.mockReset();
    upsertEntraContactLinkActiveMock.mockReset();
    runWithTenantMock.mockImplementation(async (_t: string, fn: () => Promise<unknown>) => fn());
    upsertEntraContactLinkActiveMock.mockResolvedValue(undefined);
    store = buildStore();
    createTenantKnexMock.mockResolvedValue({ knex: store.conn });
  });

  async function service() {
    return import('@ee/lib/integrations/entra/reconciliationQueueService');
  }

  it('round-trips the reason and the owning contact and client through the list API', async () => {
    const { queueEntraEmailConflict, listOpenEntraReconciliationQueue } = await service();
    await queueEntraEmailConflict({ tenantId: 't1', managedTenantId: 'm1', clientId: 'client-1', user: buildUser(), owner });

    const items = await listOpenEntraReconciliationQueue('t1');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      reason: 'email_owned_by_other_client',
      clientId: 'client-1',
      owner: {
        contactNameId: 'owner-contact',
        fullName: 'Benjamin Dixon',
        clientId: 'other-client',
        clientName: 'Muscle Corp',
        kind: 'primary',
        isInactive: false,
      },
    });
  });

  it('keeps ambiguous items distinguishable: reason multiple_email_matches and no owner', async () => {
    const { queueAmbiguousEntraMatch, listOpenEntraReconciliationQueue } = await service();
    await queueAmbiguousEntraMatch({
      tenantId: 't1',
      clientId: 'client-1',
      user: buildUser(),
      candidates: [{ contactNameId: 'a', clientId: 'client-1', email: 'x@y.z', fullName: 'A', isInactive: false }],
    });

    const [item] = await listOpenEntraReconciliationQueue('t1');
    expect(item.reason).toBe('multiple_email_matches');
    expect(item.owner).toBeNull();
  });

  it('dedupes: one open item per Entra object, refreshed rather than duplicated', async () => {
    const { queueEntraEmailConflict } = await service();
    const first = await queueEntraEmailConflict({ tenantId: 't1', clientId: 'client-1', user: buildUser(), owner });
    const second = await queueEntraEmailConflict({
      tenantId: 't1',
      clientId: 'client-1',
      user: buildUser(),
      owner: { ...owner, fullName: 'Ben D.' },
    });

    expect(second.queueItemId).toBe(first.queueItemId);
    expect(store.tables.entra_contact_reconciliation_queue).toHaveLength(1);
    expect(store.tables.entra_contact_reconciliation_queue[0].candidate_contacts[0].fullName).toBe('Ben D.');
  });

  it('a dismissed identity is not re-queued', async () => {
    const { queueEntraEmailConflict, dismissEntraQueueItem } = await service();
    const first = await queueEntraEmailConflict({ tenantId: 't1', clientId: 'client-1', user: buildUser(), owner });
    await dismissEntraQueueItem({ tenantId: 't1', queueItemId: first.queueItemId, userId: 'op' });

    const again = await queueEntraEmailConflict({ tenantId: 't1', clientId: 'client-1', user: buildUser(), owner });
    expect(again.queueItemId).toBe(first.queueItemId);
    expect(store.tables.entra_contact_reconciliation_queue).toHaveLength(1);
    expect(store.tables.entra_contact_reconciliation_queue[0].status).toBe('dismissed');
  });

  it('link anyway writes the link with the operator decision, records an audit note, and closes the item', async () => {
    const { queueEntraEmailConflict, resolveEntraQueueLinkAnyway } = await service();
    store.tables.contacts.push({ contact_name_id: 'owner-contact', client_id: 'other-client' });
    const { queueItemId } = await queueEntraEmailConflict({ tenantId: 't1', managedTenantId: 'm1', clientId: 'client-1', user: buildUser(), owner });

    const result = await resolveEntraQueueLinkAnyway({ tenantId: 't1', queueItemId, resolvedBy: 'operator-1', note: 'Same person, both clients' });

    expect(result).toEqual({ queueItemId, contactNameId: 'owner-contact' });
    expect(upsertEntraContactLinkActiveMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantId: 't1',
        contactNameId: 'owner-contact',
        user: expect.objectContaining({ entraTenantId: 'entra-tenant', entraObjectId: 'entra-object' }),
        metadata: {
          operatorDecision: expect.objectContaining({
            decision: 'link_anyway',
            decidedBy: 'operator-1',
            note: 'Same person, both clients',
            ownerClientId: 'other-client',
            syncedClientId: 'client-1',
          }),
        },
      })
    );
    const row = store.tables.entra_contact_reconciliation_queue[0];
    expect(row).toMatchObject({
      status: 'resolved',
      resolution_action: 'link_anyway',
      resolved_contact_id: 'owner-contact',
      resolved_by: 'operator-1',
    });
    expect(row.payload).toMatchObject({ reason: 'linked_anyway_by_operator', decision: 'link_anyway', decidedBy: 'operator-1' });
  });

  it('link anyway refuses an item that is not an ownership conflict, and one already resolved', async () => {
    const { queueAmbiguousEntraMatch, queueEntraEmailConflict, resolveEntraQueueLinkAnyway } = await service();
    const ambiguous = await queueAmbiguousEntraMatch({ tenantId: 't1', clientId: 'client-1', user: buildUser(), candidates: [] });
    await expect(resolveEntraQueueLinkAnyway({ tenantId: 't1', queueItemId: ambiguous.queueItemId })).rejects.toThrow(
      'Only items queued because the email belongs to another contact'
    );

    store.tables.contacts.push({ contact_name_id: 'owner-contact', client_id: 'other-client' });
    const other = { ...buildUser(), entraObjectId: 'entra-object-2' };
    const conflict = await queueEntraEmailConflict({ tenantId: 't1', clientId: 'client-1', user: other, owner });
    await resolveEntraQueueLinkAnyway({ tenantId: 't1', queueItemId: conflict.queueItemId, resolvedBy: 'op' });
    await expect(resolveEntraQueueLinkAnyway({ tenantId: 't1', queueItemId: conflict.queueItemId })).rejects.toThrow(
      'not found or already resolved'
    );
    expect(upsertEntraContactLinkActiveMock).toHaveBeenCalledTimes(1);
  });

  it('dismiss still works for a conflict item and records who dismissed it', async () => {
    const { queueEntraEmailConflict, dismissEntraQueueItem } = await service();
    const { queueItemId } = await queueEntraEmailConflict({ tenantId: 't1', clientId: 'client-1', user: buildUser(), owner });
    const result = await dismissEntraQueueItem({ tenantId: 't1', queueItemId, userId: 'op-2', reason: 'not the same person' });

    expect(result).toEqual({ queueItemId, status: 'dismissed' });
    expect(store.tables.entra_contact_reconciliation_queue[0]).toMatchObject({ status: 'dismissed', resolved_by: 'op-2' });
  });
});
