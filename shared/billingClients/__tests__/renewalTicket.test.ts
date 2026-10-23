import { beforeEach, describe, expect, it, vi } from 'vitest';

const createMock = vi.hoisted(() => vi.fn());
vi.mock('@alga-psa/shared/services/tickets/createTicketWithSideEffects', () => ({
  createTicketWithSideEffects: createMock,
}));

import {
  RENEWAL_TICKET_MANUAL_RETRY_SOURCE,
  RENEWAL_TICKET_SOURCE,
  buildRenewalTicketDescription,
  buildRenewalTicketIdempotencyKey,
  buildRenewalTicketTitle,
  createRenewalTicket,
  resolveRenewalTicketRouting,
} from '../renewalTicket';

const id = (n: number) => `b7e7a1f2-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

const row = (over: Record<string, unknown> = {}) => ({
  client_contract_id: id(1),
  contract_id: id(2),
  client_id: id(3),
  client_name: ' Acme ',
  contract_name: 'Gold',
  tenant_renewal_ticket_board_id: id(10),
  tenant_renewal_ticket_status_id: id(11),
  tenant_renewal_ticket_priority: id(12),
  tenant_renewal_ticket_assignee_id: id(13),
  renewal_ticket_board_id: null,
  renewal_ticket_status_id: null,
  renewal_ticket_priority: null,
  renewal_ticket_assignee_id: null,
  ...over,
});

describe('renewalTicket builders', () => {
  it('builds the idempotency key, title and description', () => {
    expect(buildRenewalTicketIdempotencyKey({ tenantId: 't', clientContractId: 'c', cycleKey: 'k' })).toBe(
      'renewal-ticket:t:c:k'
    );
    expect(buildRenewalTicketTitle(row(), '2026-10-06')).toBe('Renewal Decision Due 2026-10-06: Acme / Gold');
    expect(buildRenewalTicketTitle({}, '2026-10-06')).toBe('Renewal Decision Due 2026-10-06: Client / Contract');
    expect(
      buildRenewalTicketDescription(row(), { effective_renewal_mode: 'auto', effective_notice_period_days: 30, renewal_cycle_key: 'k' }, '2026-10-06')
    ).toBe(
      [
        'Contract renewal decision is due.',
        'Decision due date: 2026-10-06',
        'Renewal mode: auto',
        'Notice period (days): 30',
        'Renewal cycle: k',
        `Source contract: ${id(2)}`,
      ].join('\n')
    );
  });
});

describe('resolveRenewalTicketRouting', () => {
  it('uses tenant defaults when the contract opts in to them', () => {
    const r = resolveRenewalTicketRouting(row({ renewal_ticket_board_id: id(20) }), true);
    expect(r).toMatchObject({ clientId: id(3), boardId: id(10), statusId: id(11), priorityId: id(12), assignedTo: id(13), overrideApplied: false });
  });

  it('prefers contract overrides per field and falls back to tenant defaults', () => {
    const r = resolveRenewalTicketRouting(row({ renewal_ticket_board_id: id(20) }), false);
    expect(r.boardId).toBe(id(20));
    expect(r.statusId).toBe(id(11));
    expect(r.overrideApplied).toBe(true);
  });

  it('reports no override when the contract has none, and drops non-uuid values', () => {
    const r = resolveRenewalTicketRouting(row({ tenant_renewal_ticket_assignee_id: 'nope' }), false);
    expect(r.overrideApplied).toBe(false);
    expect(r.assignedTo).toBeNull();
  });
});

describe('createRenewalTicket', () => {
  beforeEach(() => {
    createMock.mockReset();
    createMock.mockResolvedValue({ ticketId: id(99), ticketNumber: 'T-1' });
  });

  const params = (over: Record<string, unknown> = {}) => ({
    row: row(),
    normalized: {},
    decisionDueDate: '2026-10-06',
    cycleKey: 'cycle-1',
    routing: resolveRenewalTicketRouting(row(), true),
    actor: { type: 'system' as const },
    ...over,
  });

  it('always suppresses contact mail and passes the actor, source and attributes through', async () => {
    const trx = {} as any;
    const out = await createRenewalTicket(trx, 'tenant-1', params());
    expect(out).toEqual({ ticketId: id(99), ticketNumber: 'T-1' });
    const [passedTrx, tenant, input] = createMock.mock.calls[0];
    expect(passedTrx).toBe(trx);
    expect(tenant).toBe('tenant-1');
    expect(input.actor).toEqual({ type: 'system' });
    expect(input.notificationSuppression).toEqual({ suppressContactNotifications: true });
    expect(input.ticket).toMatchObject({ source: RENEWAL_TICKET_SOURCE, assigned_to: id(13), client_id: id(3) });
    expect(input.ticket.attributes).toEqual({
      renewal_cycle_key: 'cycle-1',
      decision_due_date: '2026-10-06',
      source_client_contract_id: id(1),
      idempotency_key: `renewal-ticket:tenant-1:${id(1)}:cycle-1`,
    });
  });

  it('supports a user actor and the manual-retry source', async () => {
    await createRenewalTicket({} as any, 'tenant-1', params({ actor: { type: 'user', userId: 'u1' }, source: RENEWAL_TICKET_MANUAL_RETRY_SOURCE }));
    const input = createMock.mock.calls[0][2];
    expect(input.actor).toEqual({ type: 'user', userId: 'u1' });
    expect(input.ticket.source).toBe('renewal_due_date_manual_retry');
    expect(input.notificationSuppression).toEqual({ suppressContactNotifications: true });
  });

  it('refuses to create a ticket without routing defaults', async () => {
    await expect(
      createRenewalTicket({} as any, 'tenant-1', params({ routing: resolveRenewalTicketRouting(row({ tenant_renewal_ticket_board_id: null }), true) }))
    ).rejects.toThrow('Missing renewal ticket routing defaults');
    expect(createMock).not.toHaveBeenCalled();
  });
});
