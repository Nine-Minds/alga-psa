import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deadQueues,
  reportWorkerHealth,
  startWorkerFailureWatchdog,
  type QueueWorker,
  type WorkerState,
} from '../workerHealth.js';

function queue(taskQueue: string, state: WorkerState): QueueWorker & { set(next: WorkerState): void } {
  let current = state;
  return { taskQueue, getState: () => current, set: (next) => { current = next; } };
}

describe('reportWorkerHealth', () => {
  it('is live and ready only while every queue is polling', () => {
    const report = reportWorkerHealth(
      [queue('tenant-workflows', 'RUNNING'), queue('alga-jobs', 'RUNNING')],
      false,
    );
    expect(report).toMatchObject({ live: true, ready: true });
    expect(report.queues).toEqual([
      { taskQueue: 'tenant-workflows', state: 'RUNNING' },
      { taskQueue: 'alga-jobs', state: 'RUNNING' },
    ]);
  });

  it('is live but not ready before the workers start polling', () => {
    const report = reportWorkerHealth([queue('tenant-workflows', 'INITIALIZED')], false);
    expect(report).toMatchObject({ live: true, ready: false });
  });

  it('fails liveness when one queue of several has died (issue #3408)', () => {
    const report = reportWorkerHealth(
      [queue('tenant-workflows', 'FAILED'), queue('alga-jobs', 'RUNNING')],
      false,
    );
    expect(report).toMatchObject({ live: false, ready: false });
    expect(deadQueues(report)).toEqual([{ taskQueue: 'tenant-workflows', state: 'FAILED' }]);
  });

  it('treats an unrequested STOPPED worker as dead', () => {
    const report = reportWorkerHealth([queue('sla-workflows', 'STOPPED')], false);
    expect(report.live).toBe(false);
  });

  it('does not count draining or stopped workers as dead during a requested shutdown', () => {
    const report = reportWorkerHealth(
      [queue('tenant-workflows', 'DRAINING'), queue('alga-jobs', 'STOPPED')],
      true,
    );
    expect(report).toMatchObject({ live: true, ready: false });
  });

  it('is never ready with no queues configured', () => {
    expect(reportWorkerHealth([], false).ready).toBe(false);
  });
});

describe('startWorkerFailureWatchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires once with the dead queues when a worker fails after running', () => {
    const tenant = queue('tenant-workflows', 'RUNNING');
    const jobs = queue('alga-jobs', 'RUNNING');
    const onFailure = vi.fn();
    startWorkerFailureWatchdog([tenant, jobs], {
      intervalMs: 100,
      isShuttingDown: () => false,
      onFailure,
    });

    vi.advanceTimersByTime(250);
    expect(onFailure).not.toHaveBeenCalled();

    tenant.set('FAILED');
    vi.advanceTimersByTime(100);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0][0]).toEqual([{ taskQueue: 'tenant-workflows', state: 'FAILED' }]);

    vi.advanceTimersByTime(1_000);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it('stays quiet while a shutdown was requested', () => {
    const tenant = queue('tenant-workflows', 'STOPPED');
    const onFailure = vi.fn();
    startWorkerFailureWatchdog([tenant], {
      intervalMs: 100,
      isShuttingDown: () => true,
      onFailure,
    });
    vi.advanceTimersByTime(500);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('can be stopped', () => {
    const tenant = queue('tenant-workflows', 'RUNNING');
    const onFailure = vi.fn();
    const stop = startWorkerFailureWatchdog([tenant], {
      intervalMs: 100,
      isShuttingDown: () => false,
      onFailure,
    });
    stop();
    tenant.set('FAILED');
    vi.advanceTimersByTime(500);
    expect(onFailure).not.toHaveBeenCalled();
  });
});
