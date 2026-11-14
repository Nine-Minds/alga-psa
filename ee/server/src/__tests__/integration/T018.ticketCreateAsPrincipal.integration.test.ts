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

import { boot, teardown, harness, createHuman, createPrincipal, contextFor, restErrorOf } from './helpers/spHarness';
import { TicketService } from 'server/src/lib/api/services/TicketService';

/**
 * T018: a principal creates a ticket as itself. entered_by is the principal,
 * assigned_to may be a human, and the activity row is actor_type service_principal.
 * A service user as assigned_to or as an added resource is 422 HUMAN_WORK_ASSIGNEE_INVALID.
 */
beforeAll(async () => {
  await boot('sp_t018_ticket_create');
}, 600_000);
afterAll(teardown);

function service() {
  const svc = new TicketService();
  vi.spyOn(svc as never, 'getKnex' as never).mockResolvedValue({ knex: harness().db, tenant: harness().tenant } as never);
  return svc;
}

function ticketInput(extra: Record<string, unknown> = {}) {
  const { clientId, boardId, statusId, priorityId } = harness().ticket;
  return { title: `T018 ${Math.random()}`, client_id: clientId, board_id: boardId, status_id: statusId, priority_id: priorityId, ...extra } as never;
}

describe('T018 ticket create by a service principal', () => {
  it('creates as itself: entered_by = principal, assigned_to = human, actor_type service_principal', async () => {
    const { db, tenant } = harness();
    const human = await createHuman();
    const principal = await createPrincipal();
    const context = await contextFor(principal);

    const ticket = await service().create(ticketInput({ assigned_to: human }), context as never);

    const row = await tenantDb(db, tenant).table('tickets').where({ ticket_id: ticket.ticket_id }).first();
    expect(row.entered_by).toBe(principal.userId);
    expect(row.assigned_to).toBe(human);
    const audit = await tenantDb(db, tenant).table('ticket_audit_logs').where({ ticket_id: ticket.ticket_id }).select('actor_type', 'actor_user_id');
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.every((a: { actor_type: string }) => a.actor_type === 'service_principal')).toBe(true);
    expect(audit[0].actor_user_id).toBe(principal.userId);
  });

  it('rejects a service user as assigned_to with 422 HUMAN_WORK_ASSIGNEE_INVALID and stores nothing', async () => {
    const { db, tenant } = harness();
    const principal = await createPrincipal();
    const other = await createPrincipal();
    const context = await contextFor(principal);
    const title = `T018 svc-assignee ${Math.random()}`;

    const error = await service().create(ticketInput({ title, assigned_to: other.userId }), context as never).then(() => null, (e) => e);
    expect(await restErrorOf(error)).toEqual({ status: 422, code: 'HUMAN_WORK_ASSIGNEE_INVALID' });
    expect(await tenantDb(db, tenant).table('tickets').where({ title }).first()).toBeUndefined();
  });

  it('rejects a service user added as a resource with 422 HUMAN_WORK_ASSIGNEE_INVALID', async () => {
    const { db, tenant } = harness();
    const human = await createHuman();
    const principal = await createPrincipal();
    const other = await createPrincipal();
    const context = await contextFor(principal);
    const ticket = await service().create(ticketInput({ assigned_to: human }), context as never);

    const error = await service().addTicketAgent(ticket.ticket_id, { user_id: other.userId } as never, context as never).then(() => null, (e) => e);
    expect(await restErrorOf(error)).toEqual({ status: 422, code: 'HUMAN_WORK_ASSIGNEE_INVALID' });
    expect(await tenantDb(db, tenant).table('ticket_resources').where({ ticket_id: ticket.ticket_id, additional_user_id: other.userId }).first()).toBeUndefined();
  });
});
