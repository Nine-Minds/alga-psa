import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { tenantDb } from '@alga-psa/db';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', async () => (await import('./helpers/spMocks')).publishersMock());
vi.mock('@alga-psa/db', async (importOriginal) => (await import('./helpers/spHarness')).mockDbModuleFactory(importOriginal as never));
vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({ assertTenantTierAccess: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/licensing', () => ({
  getLicenseStateRow: vi.fn(async () => null),
  verifyLicense: vi.fn(() => ({ valid: false })),
}));

import { v4 as uuidv4 } from 'uuid';
import { boot, teardown, harness, createHuman, createPrincipal, contextFor, restErrorOf } from './helpers/spHarness';
import { TicketService } from 'server/src/lib/api/services/TicketService';

/**
 * T040: principal comments.
 *  - no visibility -> stored internal
 *  - explicit is_internal=false without act-as -> 422 ACT_AS_REQUIRED, nothing stored
 *  - with act-as -> public comment authored by the human, stamped created_via_principal_id
 *  - a client-portal user's public comment is unaffected
 */
let ticketId: string;

beforeAll(async () => {
  await boot('sp_t040_comments');
  const { db, tenant, ticket } = harness();
  ticketId = uuidv4();
  await tenantDb(db, tenant).table('tickets').insert({
    tenant,
    ticket_id: ticketId,
    ticket_number: `T040-${ticketId.slice(0, 8)}`,
    title: 'T040',
    client_id: ticket.clientId,
    board_id: ticket.boardId,
    status_id: ticket.statusId,
    priority_id: ticket.priorityId,
    entered_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}, 600_000);
afterAll(teardown);

function service() {
  const svc = new TicketService();
  vi.spyOn(svc as never, 'getKnex' as never).mockResolvedValue({ knex: harness().db, tenant: harness().tenant } as never);
  return svc;
}
const commentsOf = (note: string) => tenantDb(harness().db, harness().tenant).table('comments').where({ ticket_id: ticketId, note });

describe('T040 ticket comments by a service principal', () => {
  it('with no visibility is stored internal', async () => {
    const principal = await createPrincipal();
    const context = await contextFor(principal);
    const note = `T040 default ${Math.random()}`;

    await service().addComment(ticketId, { comment_text: note } as never, context as never);
    const row = await commentsOf(note).first();
    expect(row.is_internal).toBe(true);
    expect(row.user_id).toBe(principal.userId);
  });

  it('explicit is_internal=false without act-as is ACT_AS_REQUIRED and stores nothing', async () => {
    const { db, tenant } = harness();
    const principal = await createPrincipal({ allowActAs: true });
    const context = await contextFor(principal);
    const note = `T040 public bare ${Math.random()}`;
    const threads = await tenantDb(db, tenant).table('comment_threads').where({ ticket_id: ticketId }).count<{ count: string }[]>('* as count');

    const error = await service().addComment(ticketId, { comment_text: note, is_internal: false } as never, context as never).then(() => null, (e) => e);
    expect(await restErrorOf(error)).toEqual({ status: 422, code: 'ACT_AS_REQUIRED' });
    expect(await commentsOf(note).first()).toBeUndefined();
    const after = await tenantDb(db, tenant).table('comment_threads').where({ ticket_id: ticketId }).count<{ count: string }[]>('* as count');
    expect(after[0].count).toBe(threads[0].count); // the thread insert rolled back too
  });

  it('with act-as stores a public comment authored by the human, stamped with the principal', async () => {
    const human = await createHuman();
    const principal = await createPrincipal({ allowActAs: true });
    const context = await contextFor(principal, human);
    const note = `T040 public actas ${Math.random()}`;

    await service().addComment(ticketId, { comment_text: note, is_internal: false } as never, context as never);
    const row = await commentsOf(note).first();
    expect(row.is_internal).toBe(false);
    expect(row.user_id).toBe(human);
    expect(row.author_type).toBe('internal');
    expect(row.created_via_principal_id).toBe(principal.userId);
  });

  it("a client-portal user's public comment is unaffected", async () => {
    const client = await createHuman(undefined, 'client');
    const note = `T040 client ${Math.random()}`;
    const context = { tenant: harness().tenant, userId: client, user: { user_id: client, user_type: 'client', tenant: harness().tenant } };

    await service().addComment(ticketId, { comment_text: note, is_internal: false } as never, context as never);
    const row = await commentsOf(note).first();
    expect(row.is_internal).toBe(false);
    expect(row.user_id).toBe(client);
    expect(row.author_type).toBe('client');
    expect(row.created_via_principal_id).toBeNull();
  });
});
