// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  EntraSyncWorkerUnavailableError,
  SYNC_NOT_FOUND_GIVE_UP,
  SYNC_WORKER_CHECK_EVERY_NOT_FOUND,
  waitForEntraSyncTerminal,
} from '@ee/components/settings/integrations/entra/syncTracking';

const notFound = { success: false as const, error: 'Sync run not found.' };
const running = { success: true as const, data: { run: { status: 'running' } } };
const completed = { success: true as const, data: { run: { status: 'completed' } } };

type Answer = typeof notFound | typeof running | typeof completed | { success: false; error: string };

function deps(
  answers: Answer[],
  availability: () => Promise<{ error?: string; data?: { workerEvidence?: string } }>
) {
  const getRunDetail = vi.fn(async () => (answers.length > 1 ? answers.shift()! : answers[0]));
  const getWorkerAvailability = vi.fn(availability);
  const sleep = vi.fn(async () => {});
  return { getRunDetail, getWorkerAvailability, sleep };
}

describe('waitForEntraSyncTerminal', () => {
  it('returns the terminal status once the run reports one', async () => {
    const d = deps([notFound, running, completed], async () => ({ data: { workerEvidence: 'available' } }));
    await expect(waitForEntraSyncTerminal('workflow-1', d)).resolves.toBe('completed');
    expect(d.getRunDetail).toHaveBeenCalledTimes(3);
    expect(d.getWorkerAvailability).not.toHaveBeenCalled();
  });

  it('stops with a worker-unavailable error when nothing polls the queue (issue #3408)', async () => {
    const d = deps([notFound], async () => ({ data: { workerEvidence: 'none' } }));
    await expect(waitForEntraSyncTerminal('workflow-1', d)).rejects.toBeInstanceOf(
      EntraSyncWorkerUnavailableError
    );
    expect(d.getRunDetail).toHaveBeenCalledTimes(SYNC_WORKER_CHECK_EVERY_NOT_FOUND);
    expect(d.getWorkerAvailability).toHaveBeenCalledTimes(1);
  });

  it('keeps waiting while a worker is polling, re-checking every streak', async () => {
    const answers: Answer[] = Array(2 * SYNC_WORKER_CHECK_EVERY_NOT_FOUND).fill(notFound).concat([completed]);
    const d = deps(answers, async () => ({ data: { workerEvidence: 'available' } }));
    await expect(waitForEntraSyncTerminal('workflow-1', d)).resolves.toBe('completed');
    expect(d.getWorkerAvailability).toHaveBeenCalledTimes(2);
  });

  it('does not give up on an answer it cannot interpret', async () => {
    const answers: Answer[] = Array(SYNC_WORKER_CHECK_EVERY_NOT_FOUND).fill(notFound).concat([completed]);
    const unknown = deps([...answers], async () => ({ data: { workerEvidence: 'unknown' } }));
    await expect(waitForEntraSyncTerminal('workflow-1', unknown)).resolves.toBe('completed');
    const failed = deps([...answers], async () => ({ error: 'Forbidden' }));
    await expect(waitForEntraSyncTerminal('workflow-1', failed)).resolves.toBe('completed');
  });

  it('resets the streak once the run has been seen', async () => {
    const answers: Answer[] = Array(SYNC_WORKER_CHECK_EVERY_NOT_FOUND - 1)
      .fill(notFound)
      .concat([running], Array(SYNC_WORKER_CHECK_EVERY_NOT_FOUND - 1).fill(notFound), [completed]);
    const d = deps(answers, async () => ({ data: { workerEvidence: 'none' } }));
    await expect(waitForEntraSyncTerminal('workflow-1', d)).resolves.toBe('completed');
    expect(d.getWorkerAvailability).not.toHaveBeenCalled();
  });

  it('gives up on a run that never begins even when a worker is polling', async () => {
    const d = deps([notFound], async () => ({ data: { workerEvidence: 'available' } }));
    await expect(waitForEntraSyncTerminal('workflow-1', d)).rejects.toThrow(/never started/);
    expect(d.getRunDetail).toHaveBeenCalledTimes(SYNC_NOT_FOUND_GIVE_UP);
  });

  it('surfaces any other error at once', async () => {
    const d = deps([{ success: false, error: 'Forbidden' }], async () => ({ data: { workerEvidence: 'available' } }));
    await expect(waitForEntraSyncTerminal('workflow-1', d)).rejects.toThrow('Forbidden');
    expect(d.getRunDetail).toHaveBeenCalledTimes(1);
  });
});
