import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const serves = vi.fn();
const sla = vi.hoisted(() => ({
  applyCoManagedTicketSlaTransition: vi.fn(), recordCoManagedTicketFirstResponse: vi.fn(), recordCoManagedTicketReopened: vi.fn(),
  recordCoManagedTicketResolution: vi.fn(), syncCoManagedTicketAwaitingClientSla: vi.fn(),
}));
vi.mock('@alga-psa/core/capability', () => ({ serves: (...args: unknown[]) => serves(...args) }));
vi.mock('../../../../../packages/co-managed/src/ticketSla', () => sla);

import { dispatchTicketLifecycle, resetTicketLifecycleHandlers } from '@alga-psa/tickets/lib/ticketLifecycleHooks';
import { registerCoManagedTicketSlaHandlers, resetCoManagedTicketSlaRegistrationForTests }
  from '../../../../../packages/co-managed/src/ticketSlaRegistration';

/** A transaction that fails the test on any use: proves a handler issued zero queries. */
function untouchedTrx() {
  const touched: string[] = [];
  const trx = new Proxy(function () {}, { get: (_t, key) => { touched.push(String(key)); throw new Error(`trx.${String(key)} used`); },
    apply: () => { touched.push('call'); throw new Error('trx called'); } }) as any;
  return { trx, touched };
}
const events = [
  { kind: 'handoff', tenant: 't', ticketId: 'k', relationshipId: 'r', workId: 'w', operationId: 'o', transition: 'escalated', firstEscalatedAt: null, occurredAt: '2026-01-01T00:00:00Z' },
  { kind: 'firstResponse', tenant: 't', ticketId: 'k', relationshipId: 'r', commentId: 'c', actorTenant: 'm', actorUserId: 'u', actorReferenceId: 'a' },
  { kind: 'resolved', tenant: 't', ticketId: 'k' },
  { kind: 'reopened', tenant: 't', ticketId: 'k' },
  { kind: 'awaitingClient', tenant: 't', ticketId: 'k', previous: null, next: 'awaiting_client' },
] as const;

describe('co-managed organization SLA lifecycle handlers', () => {
  beforeEach(() => { resetTicketLifecycleHandlers(); resetCoManagedTicketSlaRegistrationForTests(); Object.values(sla).forEach(fn => fn.mockReset()); serves.mockReset(); });
  afterEach(() => resetTicketLifecycleHandlers());

  it('is a no-op that never touches the transaction for a tenant that does not participate (psa)', async () => {
    serves.mockResolvedValue({ served: false });
    registerCoManagedTicketSlaHandlers();
    const { trx, touched } = untouchedTrx();
    for (const event of events) await dispatchTicketLifecycle(trx, event as any);
    expect(touched).toEqual([]);
    Object.values(sla).forEach(fn => expect(fn).not.toHaveBeenCalled());
  });

  it('registers once however often registration runs', async () => {
    serves.mockResolvedValue({ served: true });
    registerCoManagedTicketSlaHandlers(); registerCoManagedTicketSlaHandlers();
    await dispatchTicketLifecycle({} as any, events[2] as any);
    expect(sla.recordCoManagedTicketResolution).toHaveBeenCalledTimes(1);
  });

  it('routes resolved / reopened / awaitingClient / firstResponse to the transition adapters for a participating tenant', async () => {
    serves.mockResolvedValue({ served: true });
    registerCoManagedTicketSlaHandlers();
    const trx = {} as any;
    for (const event of events.slice(1)) await dispatchTicketLifecycle(trx, event as any);
    expect(sla.recordCoManagedTicketFirstResponse).toHaveBeenCalledWith(trx, expect.objectContaining({ customerTenant: 't', commentId: 'c', actorTenant: 'm' }));
    expect(sla.recordCoManagedTicketResolution).toHaveBeenCalledWith(trx, 't', 'k');
    expect(sla.recordCoManagedTicketReopened).toHaveBeenCalledWith(trx, 't', 'k');
    expect(sla.syncCoManagedTicketAwaitingClientSla).toHaveBeenCalledWith(trx, 't', 'k');
  });

  it('isolates a native-write transition failure but lets an owned handoff failure roll back', async () => {
    serves.mockResolvedValue({ served: true });
    registerCoManagedTicketSlaHandlers();
    sla.recordCoManagedTicketResolution.mockRejectedValue(new Error('sla fault'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(dispatchTicketLifecycle({} as any, events[2] as any)).resolves.toBeUndefined();
    log.mockRestore();
    sla.recordCoManagedTicketFirstResponse.mockRejectedValue(new Error('setup required'));
    await expect(dispatchTicketLifecycle({} as any, events[1] as any)).rejects.toThrow('setup required');
  });
});
