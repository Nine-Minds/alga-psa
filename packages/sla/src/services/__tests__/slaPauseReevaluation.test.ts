import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';

const syncPauseState = vi.hoisted(() => vi.fn());
const dispatchSlaBackendActions = vi.hoisted(() => vi.fn(async () => undefined));
const afterCommit = vi.hoisted(() => vi.fn());

vi.mock('../slaPauseService', () => ({ syncPauseState }));
vi.mock('../slaBackendActions', () => ({ dispatchSlaBackendActions }));
vi.mock('@alga-psa/db', () => ({
  registerAfterCommit: afterCommit, runWithTenant: (_tenant: string, fn: () => unknown) => fn(),
}));

import { reevaluateSlaPause } from '@alga-psa/shared/lib/sla/slaPauseConditions';
import { reevaluateSlaPauseState } from '../slaPauseReevaluation';

const trx = {} as Knex.Transaction;

describe('SLA pause re-evaluation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('answers the shared reevaluateSlaPause port once this module is loaded', async () => {
    syncPauseState.mockResolvedValue({ success: true, was_paused: false, is_now_paused: false });
    await reevaluateSlaPause(trx, 'tenant', 'ticket', 'actor');
    expect(syncPauseState).toHaveBeenCalledWith(trx, 'tenant', 'ticket', 'actor');
  });

  it('tells the timer backend only after commit', async () => {
    const backendActions = [{ kind: 'pause', ticketId: 'ticket', reason: 'client_it_responsibility' }];
    syncPauseState.mockResolvedValue({ success: true, was_paused: false, is_now_paused: true, backendActions });
    await reevaluateSlaPauseState(trx, 'tenant', 'ticket', 'actor');

    expect(dispatchSlaBackendActions).not.toHaveBeenCalled();
    expect(afterCommit).toHaveBeenCalledTimes(1);
    await afterCommit.mock.calls[0][1]();
    expect(dispatchSlaBackendActions).toHaveBeenCalledWith(backendActions);
  });

  it('registers no after-commit work when the clock did not change', async () => {
    syncPauseState.mockResolvedValue({ success: true, was_paused: true, is_now_paused: true });
    await reevaluateSlaPauseState(trx, 'tenant', 'ticket');
    expect(afterCommit).not.toHaveBeenCalled();
  });

  it('throws when the pause state could not be written', async () => {
    syncPauseState.mockResolvedValue({ success: false, was_paused: false, is_now_paused: false, error: 'boom' });
    await expect(reevaluateSlaPauseState(trx, 'tenant', 'ticket')).rejects.toThrow(/boom/);
  });
});
