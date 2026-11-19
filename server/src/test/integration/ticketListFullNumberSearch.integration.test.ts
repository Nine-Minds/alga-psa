/**
 * T003: MSP ticket list search by full ticket number returns only that ticket (DB-backed).
 * Tickets sharing the ALGA-2026- prefix are indexed; the full number must not widen to siblings,
 * while the shared prefix alone (ALGA-2026) still lists them all.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { TICKET_STATUS_FILTER_ALL } from '@alga-psa/tickets/lib';
import type { ITicketListFilters } from '@alga-psa/types';
import { ticketIndexer } from '@alga-psa/search/indexers/ticket';
import { upsertSearchDoc } from '@alga-psa/search/upsert';

const authMocks = vi.hoisted(() => ({ user: null as any, tenant: null as string | null }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (action: any) => (...args: any[]) =>
    action(authMocks.user, { tenant: authMocks.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn().mockResolvedValue(null),
  getUserAvatarUrl: vi.fn().mockResolvedValue(null),
  getClientLogoUrlsBatch: vi.fn().mockResolvedValue(new Map()),
  getEntityImageUrlsBatch: vi.fn().mockResolvedValue(new Map()),
}));

const describeDb = await describeWithDb();

const NUMBERS = [
  'ALGA-2026-0000001',
  'ALGA-2026-0000002',
  'ALGA-2026-0002826',
  'CVB2026-0002801',
  'CVB2026-0002826',
] as const;
const TARGET = 'ALGA-2026-0002826';
const DASHLESS_TARGET = 'CVB2026-0002826';

describeDb('ticket list full ticket-number search (DB-backed)', () => {
  let db: Knex;
  let tenant: string;
  const ids = new Map<string, string>(); // ticket_number -> ticket_id
  let optimized: typeof import('@alga-psa/tickets/actions/optimizedTicketActions');

  const base: ITicketListFilters = {
    boardFilterState: 'all',
    statusId: TICKET_STATUS_FILTER_ALL,
    showOpenOnly: false,
  };

  const search = async (searchQuery: string): Promise<string[]> => {
    const result = await optimized.getTicketsForList({ ...base, searchQuery }, 1, 100);
    if (!('tickets' in (result as any))) throw new Error(`list error: ${JSON.stringify(result)}`);
    const numbers = new Map([...ids].map(([n, id]) => [id, n]));
    return (result as any).tickets
      .map((t: { ticket_id: string }) => numbers.get(t.ticket_id))
      .filter(Boolean)
      .sort();
  };

  beforeAll(async () => {
    wireLocalTestDbEnv();
    db = await createTestDbConnection();
    optimized = await import('@alga-psa/tickets/actions/optimizedTicketActions');

    const seed = await db('tickets').first('*');
    tenant = seed.tenant;
    const actor = await db('users').where({ tenant }).first('user_id');
    authMocks.tenant = tenant;
    authMocks.user = { user_id: actor.user_id, user_type: 'internal', tenant };

    for (const ticketNumber of NUMBERS) {
      const id = uuidv4();
      await db('tickets').insert({
        ...seed,
        ticket_id: id,
        ticket_number: ticketNumber,
        title: `Unrelated subject ${id.slice(0, 6)}`,
        master_ticket_id: null,
        updated_at: new Date(),
      });
      ids.set(ticketNumber, id);
      const doc = await ticketIndexer.loadOne(db, tenant, id);
      expect(doc).not.toBeNull();
      await upsertSearchDoc(db, { ...doc!, sourceUpdatedAt: new Date() });
    }
  }, 300_000);

  afterAll(async () => {
    if (!db) return;
    const all = [...ids.values()];
    await db('app_search_index').where({ tenant }).whereIn('object_id', all).delete().catch(() => undefined);
    await db('tickets').where({ tenant }).whereIn('ticket_id', all).delete().catch(() => undefined);
    await db.destroy().catch(() => undefined);
  });

  it.each([TARGET, `#${TARGET}`, `${TARGET} `, TARGET.toLowerCase()])(
    'full number %j returns only that ticket',
    async (query) => {
      expect(await search(query)).toEqual([TARGET]);
    },
  );

  it('the shared prefix still lists every ticket in the group', async () => {
    expect(await search('ALGA-2026')).toEqual(['ALGA-2026-0000001', 'ALGA-2026-0000002', 'ALGA-2026-0002826']);
  });

  it('a full number with a dashless prefix (CVB + {YYYY}-) returns only that ticket', async () => {
    expect(await search(DASHLESS_TARGET)).toEqual([DASHLESS_TARGET]);
  });
});
