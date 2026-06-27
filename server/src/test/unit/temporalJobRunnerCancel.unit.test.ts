import { beforeEach, describe, expect, it, vi } from 'vitest';

// cancelJob touches only @alga-psa/db (jobs lookup + status update) and the
// Temporal client; mock both so we can exercise the cancel logic in isolation.
const firstMock = vi.fn();
const updateMock = vi.fn().mockResolvedValue(1);
const builder: any = {
  where: () => builder,
  first: (...a: unknown[]) => firstMock(...a),
  update: (...a: unknown[]) => updateMock(...a),
};
const knexFn: any = () => builder;

vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: knexFn }),
  runWithTenant: async (_t: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('@temporalio/client', () => ({ Client: class {}, Connection: { connect: vi.fn() }, WorkflowHandle: class {} }));
vi.mock('@temporalio/common', () => ({ Duration: {} }));

import { TemporalJobRunner } from '@alga-psa/jobs/runners/TemporalJobRunner';

function makeRunner() {
  const scheduleDelete = vi.fn().mockResolvedValue(undefined);
  const workflowCancel = vi.fn().mockResolvedValue(undefined);
  const client = {
    schedule: { getHandle: vi.fn(() => ({ delete: scheduleDelete })) },
    workflow: { getHandle: vi.fn(() => ({ cancel: workflowCancel })) },
  };
  // constructor is private; bypass it for the unit under test
  const runner = new (TemporalJobRunner as any)(client, { taskQueue: 'q' });
  return { runner, client, scheduleDelete, workflowCancel };
}

describe('TemporalJobRunner.cancelJob', () => {
  beforeEach(() => {
    firstMock.mockReset();
    updateMock.mockClear();
  });

  it('deletes a recurring schedule even when the job row status is completed', async () => {
    // The schedule reuses one row as its per-fire tracker, so status is 'completed'
    // after the last run — the schedule must still be torn down.
    firstMock.mockResolvedValue({
      external_id: 'accounting-sync-cycle:t1',
      status: 'completed',
      metadata: { recurring: true },
    });
    const { runner, client, scheduleDelete, workflowCancel } = makeRunner();

    const result = await runner.cancelJob('job-1', 't1');

    expect(result).toBe(true);
    expect(client.schedule.getHandle).toHaveBeenCalledWith('accounting-sync-cycle:t1');
    expect(scheduleDelete).toHaveBeenCalledTimes(1);
    expect(workflowCancel).not.toHaveBeenCalled();
  });

  it('does not cancel a one-shot workflow that already completed', async () => {
    firstMock.mockResolvedValue({ external_id: 'wf-1', status: 'completed', metadata: {} });
    const { runner, scheduleDelete, workflowCancel } = makeRunner();

    const result = await runner.cancelJob('job-2', 't1');

    expect(result).toBe(false);
    expect(scheduleDelete).not.toHaveBeenCalled();
    expect(workflowCancel).not.toHaveBeenCalled();
  });

  it('cancels a running one-shot workflow', async () => {
    firstMock.mockResolvedValue({ external_id: 'wf-2', status: 'processing', metadata: {} });
    const { runner, scheduleDelete, workflowCancel } = makeRunner();

    const result = await runner.cancelJob('job-3', 't1');

    expect(result).toBe(true);
    expect(workflowCancel).toHaveBeenCalledTimes(1);
    expect(scheduleDelete).not.toHaveBeenCalled();
  });
});
