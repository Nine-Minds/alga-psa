/** The co-managed comment-create path dispatches `firstResponse` for the other organization's reply, in its transaction. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFake } from './fakeCoManagedDb';

vi.mock('@alga-psa/db', async () => {
  const fake = await import('./fakeCoManagedDb');
  return { tenantDb: (db: any, tenant: string) => fake.fakeTenantDb(db, tenant), withTransaction: async (db: any, work: any) => db.transaction(work) };
});
vi.mock('@alga-psa/licensing/lifecycle', () => ({ assertCoManagedOperationalWrite: async () => undefined }));
vi.mock('../actorReferences', () => ({ ensureCoManagedActorReference: async () => '00000000-0000-4000-8000-0000000000f9' }));
vi.mock('../sharedWorkIdentity', async () => {
  const actual = await vi.importActual<typeof import('../sharedWorkIdentity')>('../sharedWorkIdentity');
  return { ...actual, assertCoManagedSessionUnexpired: async () => undefined };
});
const admit = (db: any, actor: any, resource: any, work: (c: any) => Promise<any>) => db.transaction((trx: any) =>
  work({ trx, actor: { tenant: actor.tenant, userId: actor.userId }, sessionId: actor.sessionId, resource, revision: 1, action: 'update', redactedFields: [] }));
vi.mock('../customerWork', () => ({ withCoManagedCustomerTicket: (db: any, a: any, r: any, _x: string, w: any) => admit(db, a, r, w) }));
vi.mock('../sharedWork', () => ({ withCoManagedSharedWork: (db: any, a: any, r: any, _x: string, w: any) => admit(db, a, r, w) }));

import { createCoManagedTicketComment } from '../ticketCommentCreation';
import { registerTicketLifecycleHandler, resetTicketLifecycleHandlers } from '@alga-psa/tickets/lib/ticketLifecycleHooks';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const C = id(1), S = id(2), REL = id(3), TICKET = id(4), OP = id(5);
const resource = { tenant: C, relationshipId: REL, kind: 'ticket', id: TICKET } as const;
const actor = (tenant: string) => ({ kind: 'session', tenant, userId: id(6), sessionId: id(7) }) as any;
const request = { operationId: OP, text: 'On it', audience: 'requester' } as any;

let db: any; const seen: any[] = [];
beforeEach(() => {
  ({ db } = createFake()); seen.length = 0;
  resetTicketLifecycleHandlers();
  registerTicketLifecycleHandler('firstResponse', async (_trx, event) => { seen.push(event); });
  db.select = () => ({ first: async () => ({ at: new Date() }) });
});

describe('comment creation dispatches firstResponse', () => {
  it('for a reply written by the other organization', async () => {
    await createCoManagedTicketComment(db, actor(S), resource, request, async () => undefined);
    expect(seen).toEqual([expect.objectContaining({ kind: 'firstResponse', tenant: C, ticketId: TICKET, relationshipId: REL, commentId: OP, actorTenant: S })]);
  });
  it('not for the owning organization’s own comment', async () => {
    await createCoManagedTicketComment(db, actor(C), resource, request, async () => undefined);
    expect(seen).toEqual([]);
  });
});
