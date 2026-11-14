import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

const released = vi.hoisted(() => vi.fn<(tenant: string) => Promise<boolean>>());
const readWork = vi.hoisted(() => vi.fn());
const syncPauseState = vi.hoisted(() => vi.fn());
const dispatchSlaBackendActions = vi.hoisted(() => vi.fn(async () => undefined));
const afterCommit = vi.hoisted(() => vi.fn());

vi.mock('../seatRelease', () => ({ coManagedSeatReleased: released }));
vi.mock('../seatTicketHandoff', () => ({ readCoManagedSeatTicketWork: readWork }));
vi.mock('@alga-psa/sla/services', () => ({ syncPauseState, dispatchSlaBackendActions }));
vi.mock('@alga-psa/db', () => ({
  registerAfterCommit: afterCommit, registerSeatResponsibilityObserver: vi.fn(), runWithTenant: (_t: string, fn: () => unknown) => fn(),
}));

import { clientItResponsibilityPauseCondition, onSeatResponsibility } from '../seatTicketSla';

const trx = {} as Knex.Transaction;
const event = { kind: 'seatResponsibility' as const, tenant: 'tenant', ticketId: 'ticket', arrangementId: 'arr',
  from: 'msp' as const, to: 'client_it' as const, operationId: 'op', occurredAt: new Date().toISOString(), actorUserId: 'actor' };

describe('seat responsibility SLA pause condition', () => {
  beforeEach(() => { vi.clearAllMocks(); released.mockResolvedValue(true); });

  it('returns without querying when the seat shape is not released for the tenant', async () => {
    released.mockResolvedValue(false);
    await expect(clientItResponsibilityPauseCondition(trx, 'tenant', 'ticket')).resolves.toBeNull();
    expect(readWork).not.toHaveBeenCalled();
  });

  it('holds only while client IT is responsible under a live arrangement', async () => {
    readWork.mockResolvedValueOnce({ arrangementId: 'a', responsibility: 'client_it', revision: 1 });
    await expect(clientItResponsibilityPauseCondition(trx, 'tenant', 'ticket')).resolves.toBe('client_it_responsibility');
    readWork.mockResolvedValueOnce({ arrangementId: 'a', responsibility: 'msp', revision: 2 });
    await expect(clientItResponsibilityPauseCondition(trx, 'tenant', 'ticket')).resolves.toBeNull();
    // A client with no live arrangement has no responsibility at all.
    readWork.mockResolvedValueOnce(null);
    await expect(clientItResponsibilityPauseCondition(trx, 'tenant', 'ticket')).resolves.toBeNull();
  });
});

describe('seat responsibility lifecycle handler', () => {
  beforeEach(() => { vi.clearAllMocks(); released.mockResolvedValue(true); });

  it('does nothing when the seat shape is not released: no SLA write, no query', async () => {
    released.mockResolvedValue(false);
    await onSeatResponsibility(trx, event);
    expect(syncPauseState).not.toHaveBeenCalled();
    expect(afterCommit).not.toHaveBeenCalled();
  });

  it('re-evaluates the pause state and tells the timer backend only after commit', async () => {
    const backendActions = [{ kind: 'pause', ticketId: 'ticket', reason: 'client_it_responsibility' }];
    syncPauseState.mockResolvedValue({ success: true, was_paused: false, is_now_paused: true, backendActions });
    await onSeatResponsibility(trx, event);

    expect(syncPauseState).toHaveBeenCalledWith(trx, 'tenant', 'ticket', 'actor');
    expect(dispatchSlaBackendActions).not.toHaveBeenCalled();
    expect(afterCommit).toHaveBeenCalledTimes(1);
    await afterCommit.mock.calls[0][1]();
    expect(dispatchSlaBackendActions).toHaveBeenCalledWith(backendActions);
  });

  it('registers no after-commit work when the clock did not change', async () => {
    syncPauseState.mockResolvedValue({ success: true, was_paused: true, is_now_paused: true });
    await onSeatResponsibility(trx, event);
    expect(afterCommit).not.toHaveBeenCalled();
  });

  it('throws when the SLA write failed, so the handoff rolls back with its clock fact', async () => {
    syncPauseState.mockResolvedValue({ success: false, was_paused: false, is_now_paused: false, error: 'boom' });
    await expect(onSeatResponsibility(trx, event)).rejects.toThrow(/boom/);
  });
});
