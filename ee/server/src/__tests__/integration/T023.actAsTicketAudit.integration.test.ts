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

import { boot, teardown, harness, createHuman, createPrincipal, contextFor } from './helpers/spHarness';
import { TicketService } from 'server/src/lib/api/services/TicketService';
import { auditLog } from '@alga-psa/db';

/**
 * T023: an act-as ticket update writes ticket_audit_logs with actor_type='user',
 * actor_user_id = the human and via_principal_user_id = the principal; the generic
 * auditLog() carries the same via in its details.
 */
beforeAll(async () => {
  await boot('sp_t023_actas_audit');
}, 600_000);
afterAll(teardown);

function service() {
  const svc = new TicketService();
  vi.spyOn(svc as never, 'getKnex' as never).mockResolvedValue({ knex: harness().db, tenant: harness().tenant } as never);
  return svc;
}

describe('T023 act-as ticket update audit', () => {
  it('records the human as actor and the principal as via', async () => {
    const { db, tenant, ticket } = harness();
    const human = await createHuman();
    const principal = await createPrincipal({ allowActAs: true });
    const context = await contextFor(principal, human);

    const created = await service().create(
      { title: 'T023', client_id: ticket.clientId, board_id: ticket.boardId, status_id: ticket.statusId, priority_id: ticket.priorityId } as never,
      context as never,
    );
    await service().update(created.ticket_id, { title: 'T023 renamed' } as never, context as never);

    const rows = await tenantDb(db, tenant)
      .table('ticket_audit_logs')
      .where({ ticket_id: created.ticket_id })
      .select('event_type', 'actor_type', 'actor_user_id', 'via_principal_user_id');
    expect(rows.length).toBeGreaterThanOrEqual(2); // create + update
    for (const row of rows) {
      expect(row.actor_type).toBe('user');
      expect(row.actor_user_id).toBe(human);
      expect(row.via_principal_user_id).toBe(principal.userId);
    }
    const ticketRow = await tenantDb(db, tenant).table('tickets').where({ ticket_id: created.ticket_id }).first();
    expect(ticketRow.title).toBe('T023 renamed');
  });

  it('auditLog() details carry via_principal_user_id for the same context', async () => {
    const { db, tenant } = harness();
    const human = await createHuman();
    const principal = await createPrincipal({ allowActAs: true });
    const context = await contextFor(principal, human);
    const recordId = crypto.randomUUID();

    await db.transaction(async (trx) => {
      await trx.raw(`select set_config('app.current_tenant', ?, true)`, [tenant]);
      await auditLog(trx, {
        userId: context.userId,
        viaPrincipalUserId: context.viaPrincipalUserId,
        operation: 'update',
        tableName: 'tickets',
        recordId,
        changedData: { title: 'x' },
        details: { source: 'T023' },
      });
    });
    const row = await tenantDb(db, tenant).table('audit_logs').where({ record_id: recordId }).first();
    expect(row.user_id).toBe(human);
    expect(row.details.via_principal_user_id).toBe(principal.userId);
    expect(row.details.source).toBe('T023');
  });
});
