import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activity: vi.fn(),
  continueAsNew: vi.fn(),
  handlers: new Map<string, () => void>(),
  cancelCurrent: null as null | (() => void),
  logInfo: vi.fn(),
}));

vi.mock('@temporalio/workflow', () => {
  class CancellationScope {
    cancel() {
      mocks.cancelCurrent?.();
    }
    async run<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    }
  }
  return {
    proxyActivities: vi.fn(() => ({ consumeThreecxCallControl: mocks.activity })),
    defineSignal: vi.fn((name: string) => name),
    setHandler: vi.fn((signal: string, handler: () => void) => mocks.handlers.set(signal, handler)),
    continueAsNew: mocks.continueAsNew,
    CancellationScope,
    isCancellation: (error: unknown) => (error as { name?: string } | null)?.name === 'CancelledFailure',
    log: { info: mocks.logInfo },
  };
});

describe('threecxCallControlWorkflow', () => {
  beforeEach(() => {
    mocks.activity.mockReset();
    mocks.continueAsNew.mockReset();
    mocks.handlers.clear();
    mocks.cancelCurrent = null;
  });

  it('continues as new after the consume activity returns (T028)', async () => {
    mocks.activity.mockResolvedValue({ reason: 'deadline' });
    const { threecxCallControlWorkflow } = await import('../threecx-call-control-workflow');

    await threecxCallControlWorkflow({ tenantId: 'tenant-1' });

    expect(mocks.activity).toHaveBeenCalledWith({ tenantId: 'tenant-1' });
    expect(mocks.continueAsNew).toHaveBeenCalledWith({ tenantId: 'tenant-1' });
  });

  it('returns after a stop signal without starting another activity (T029)', async () => {
    mocks.activity.mockImplementation(
      () =>
        new Promise((_, reject) => {
          mocks.cancelCurrent = () => reject(Object.assign(new Error('cancelled'), { name: 'CancelledFailure' }));
        }),
    );
    const { threecxCallControlWorkflow } = await import('../threecx-call-control-workflow');

    const run = threecxCallControlWorkflow({ tenantId: 'tenant-1' });
    await vi.waitFor(() => expect(mocks.handlers.has('stop')).toBe(true));
    mocks.handlers.get('stop')!();

    await expect(run).resolves.toBeUndefined();
    expect(mocks.activity).toHaveBeenCalledTimes(1);
    expect(mocks.continueAsNew).not.toHaveBeenCalled();
  });

  it('stops after a completed run when the signal arrives during the activity', async () => {
    mocks.activity.mockImplementation(async () => {
      mocks.handlers.get('stop')!();
      return { reason: 'deadline' };
    });
    const { threecxCallControlWorkflow } = await import('../threecx-call-control-workflow');

    await threecxCallControlWorkflow({ tenantId: 'tenant-1' });

    expect(mocks.continueAsNew).not.toHaveBeenCalled();
  });

  it('propagates activity failures that are not a stop', async () => {
    mocks.activity.mockRejectedValue(new Error('boom'));
    const { threecxCallControlWorkflow } = await import('../threecx-call-control-workflow');

    await expect(threecxCallControlWorkflow({ tenantId: 'tenant-1' })).rejects.toThrow('boom');
    expect(mocks.continueAsNew).not.toHaveBeenCalled();
  });
});
