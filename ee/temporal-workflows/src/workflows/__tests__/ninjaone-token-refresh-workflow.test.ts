import { beforeEach, describe, expect, it, vi } from 'vitest';

const activityMock = vi.fn();
const logInfoMock = vi.fn();
const handlers = new Map<string, (payload?: unknown) => void>();

class FakeTrigger<T = void> implements PromiseLike<T> {
  private promise: Promise<T>;
  private resolveFn!: (value: T | PromiseLike<T>) => void;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolveFn = resolve;
    });
  }

  resolve(value?: T) {
    this.resolveFn(value as T);
  }

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.promise.then(onfulfilled, onrejected);
  }
}

const sleepMock = vi.fn(async () => undefined);

vi.mock('@temporalio/workflow', () => ({
  proxyActivities: vi.fn(() => ({
    proactiveNinjaOneTokenRefreshActivity: activityMock,
  })),
  defineSignal: vi.fn((name: string) => name),
  setHandler: vi.fn((signal: string, handler: (payload?: unknown) => void) => {
    handlers.set(signal, handler);
  }),
  Trigger: FakeTrigger,
  sleep: sleepMock,
  log: {
    info: logInfoMock,
  },
}));

describe('ninjaOneProactiveTokenRefreshWorkflow', () => {
  beforeEach(() => {
    activityMock.mockReset();
    logInfoMock.mockReset();
    sleepMock.mockClear();
    handlers.clear();
  });

  it('runs the refresh activity when due and returns a terminal outcome cleanly', async () => {
    activityMock.mockResolvedValue({ outcome: 'reconnect_required', details: 'invalid_token' });

    const { ninjaOneProactiveTokenRefreshWorkflow } = await import(
      '../ninjaone-token-refresh-workflow'
    );

    const result = await ninjaOneProactiveTokenRefreshWorkflow({
      tenantId: 'tenant-1',
      integrationId: 'integration-1',
      expiresAtMs: Date.now() - 1000,
      scheduledBy: 'backfill',
    });

    expect(result).toEqual({ outcome: 'reconnect_required', details: 'invalid_token' });
    expect(activityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        integrationId: 'integration-1',
      })
    );
    expect(logInfoMock).toHaveBeenCalledWith(
      'Starting NinjaOne proactive token refresh workflow',
      expect.objectContaining({
        tenantId: 'tenant-1',
        integrationId: 'integration-1',
        scheduledBy: 'backfill',
      })
    );
    expect(logInfoMock).toHaveBeenCalledWith(
      'Completed NinjaOne proactive token refresh workflow',
      expect.objectContaining({
        tenantId: 'tenant-1',
        integrationId: 'integration-1',
        outcome: 'reconnect_required',
      })
    );
  });
});
