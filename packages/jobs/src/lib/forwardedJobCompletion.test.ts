import { describe, expect, it, vi } from 'vitest';
import {
  beginForwardedJobExecution,
  claimForwardedJobExecution,
  recordForwardedJobExecutionOutcome,
  waitForForwardedJobCompletion,
  type ForwardedJobExecutionOutcome,
} from './forwardedJobCompletion';

describe('waitForForwardedJobCompletion', () => {
  it('does not treat an unconsumed event as completed work', async () => {
    const sleep = vi.fn(async () => undefined);
    await expect(waitForForwardedJobCompletion(
      async () => ({ executionId: 'run-1', status: 'queued' }),
      'run-1',
      { timeoutMs: 2, pollIntervalMs: 1, sleep },
    )).rejects.toThrow('Timed out waiting for the application server');
    expect(sleep).toHaveBeenCalled();
  });

  it('resolves only after the application handler records completion', async () => {
    const states: ForwardedJobExecutionOutcome[] = [
      { executionId: 'run-1', status: 'queued' },
      { executionId: 'run-1', status: 'processing' },
      { executionId: 'run-1', status: 'completed' },
    ];
    await expect(waitForForwardedJobCompletion(
      async () => states.shift(),
      'run-1',
      { timeoutMs: 100, pollIntervalMs: 1, sleep: async () => undefined },
    )).resolves.toBeUndefined();
  });

  it('propagates a downstream handler failure', async () => {
    await expect(waitForForwardedJobCompletion(
      async () => ({ executionId: 'run-1', status: 'failed', error: 'PDF storage unavailable' }),
      'run-1',
      { timeoutMs: 100, sleep: async () => undefined },
    )).rejects.toThrow('PDF storage unavailable');
  });

  it('does not reuse the previous recurring execution completion', async () => {
    const previous = { serverExecution: { executionId: 'run-1', status: 'completed' } };
    const next = beginForwardedJobExecution(previous, 'run-2');
    expect(next.serverExecution).toEqual({ executionId: 'run-2', status: 'queued' });
    const states: ForwardedJobExecutionOutcome[] = [
      { executionId: next.serverExecution.executionId, status: next.serverExecution.status },
      { executionId: 'run-2', status: 'completed' },
    ];
    await expect(waitForForwardedJobCompletion(
      async () => states.shift(), 'run-2', { pollIntervalMs: 1, sleep: async () => undefined },
    )).resolves.toBeUndefined();
    expect(previous.serverExecution.executionId).not.toBe(next.serverExecution.executionId);
  });

  it('preserves a completed outcome when Temporal repeats the same activity execution', () => {
    const completed = { serverExecution: { executionId: 'run-1', status: 'completed' } };
    expect(beginForwardedJobExecution(completed, 'run-1')).toEqual(completed);
  });

  it('does not replace a still-processing run with a different execution id', () => {
    const processing = { serverExecution: { executionId: 'run-1', status: 'processing' } };
    expect(beginForwardedJobExecution(processing, 'run-2')).toEqual(processing);
  });

  it('claims queued work and leaves processing and terminal states unclaimable', () => {
    const queued = { serverExecution: { executionId: 'run-1', status: 'queued' } };
    const first = claimForwardedJobExecution(queued, 'run-1');
    expect(first).toMatchObject({ claimed: true, status: 'processing' });
    expect(claimForwardedJobExecution(first.metadata, 'run-1')).toMatchObject({
      claimed: false, status: 'processing',
    });

    const completed = recordForwardedJobExecutionOutcome(first.metadata, 'run-1', { status: 'completed' });
    expect(claimForwardedJobExecution(completed.metadata, 'run-1')).toMatchObject({
      claimed: false, status: 'completed',
    });
    expect(recordForwardedJobExecutionOutcome(completed.metadata, 'run-1', {
      status: 'failed', error: 'late failure',
    })).toMatchObject({ recorded: false, metadata: completed.metadata });
  });

  it('allows timeout failure to close queued or processing work, but never overwrites a terminal outcome', () => {
    const queued = { serverExecution: { executionId: 'run-1', status: 'queued' } };
    const timedOut = recordForwardedJobExecutionOutcome(queued, 'run-1', {
      status: 'failed', error: 'timed out; delivery outcome unknown',
    });
    expect(timedOut).toMatchObject({ recorded: true, metadata: {
      serverExecution: { executionId: 'run-1', status: 'failed' },
    } });
    expect(recordForwardedJobExecutionOutcome(timedOut.metadata, 'run-1', {
      status: 'completed',
    })).toMatchObject({ recorded: false, metadata: timedOut.metadata });
  });

  it('allows a successful run after an earlier run failed', async () => {
    const previousFailure = { serverExecution: { executionId: 'run-1', status: 'failed', error: 'old PDF failure' } };
    const next = beginForwardedJobExecution(previousFailure, 'run-2');
    const states: ForwardedJobExecutionOutcome[] = [
      { executionId: next.serverExecution.executionId, status: next.serverExecution.status },
      { executionId: 'run-2', status: 'completed' },
    ];
    await expect(waitForForwardedJobCompletion(
      async () => states.shift(), 'run-2', { pollIntervalMs: 1, sleep: async () => undefined },
    )).resolves.toBeUndefined();
    expect(previousFailure.serverExecution.status).toBe('failed');
  });

  it('rejects when a late completion belongs to a different active execution', async () => {
    const active = beginForwardedJobExecution({ serverExecution: { executionId: 'run-2', status: 'queued' } }, 'run-2');
    const late = recordForwardedJobExecutionOutcome(active, 'run-1', { status: 'completed' });
    expect(late.recorded).toBe(false);
    expect(late.metadata).toEqual(active);
    await expect(waitForForwardedJobCompletion(
      async () => ({ executionId: 'run-3', status: 'completed' }), 'run-2',
      { pollIntervalMs: 1, sleep: async () => undefined },
    )).rejects.toThrow('was superseded by run-3');
  });
});
