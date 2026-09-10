import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ work: vi.fn(), start: vi.fn(), stop: vi.fn(), services: vi.fn(), discover: vi.fn(), createQueue: vi.fn(), schedule: vi.fn() }));
// Discovery, factory, initializer, registry and PgBossJobRunner are real;
// replace only infrastructure and unrelated handler dependencies.
vi.mock('pg-boss', () => ({ default: class { on() {} start = mocks.start; stop = mocks.stop; work = mocks.work; createQueue = mocks.createQueue; schedule = mocks.schedule; } }));
vi.mock('@alga-psa/db', async original => ({ ...await original<any>(),
  getPostgresConnection: async () => ({ host: 'localhost', port: 5432, user: 'test', password: 'test', database: 'test' }),
  getConnection: async () => ({}),
  tenantDb: () => ({ unscoped: () => ({ distinct: () => ({ where: mocks.discover }) }) }),
}));
vi.mock('@/services/job.service', () => ({ JobService: { create: mocks.services } }));
vi.mock('@alga-psa/storage/StorageService', () => ({ StorageService: class {} }));
vi.mock('@/lib/features', () => ({ isEnterprise: false, isEnterpriseEdition: () => false }));
vi.mock('@alga-psa/jobs/handlers/workflowScheduledRunHandlers', () => ({ workflowOneTimeScheduledRunHandler: vi.fn(), workflowRecurringScheduledRunHandler: vi.fn() }));
vi.mock('@alga-psa/jobs/handlers/extensionScheduledInvocationHandler', () => ({ extensionScheduledInvocationHandler: vi.fn() }));
vi.mock('@alga-psa/jobs/handlers/kbArticleImportHandler', () => ({ KB_ARTICLE_IMPORT_JOB: 'kb-article-import', kbArticleImportHandler: vi.fn() }));

import { createCommentRecoveryScheduleDiscovery } from '@/lib/jobs/commentRecoveryScheduleDiscovery';
import { initializeJobRunner } from '@/lib/jobs/initializeJobRunner';
import { JobRunnerFactory } from '@/lib/jobs/JobRunnerFactory';
import { JobHandlerRegistry } from '@/lib/jobs/jobHandlerRegistry';
import { PgBossJobRunner } from '@/lib/jobs/runners/PgBossJobRunner';

function expectOneWorkerPerHandler() {
  const names = [...JobHandlerRegistry.getAll().keys()];
  expect(names).toContain('recover-comment-publications');
  expect(names).toContain('publish-scheduled-comment');
  for (const name of names) expect(mocks.work.mock.calls.filter(([queue]) => queue === name), name).toHaveLength(1);
  expect(mocks.work).toHaveBeenCalledTimes(names.length);
}

describe('comment discovery worker initialization', () => {
  beforeEach(() => {
    JobRunnerFactory.getInstance().reset(); JobHandlerRegistry.clear(); vi.clearAllMocks();
    mocks.services.mockResolvedValue({}); mocks.start.mockResolvedValue(undefined);
    mocks.work.mockResolvedValue('worker-id'); mocks.discover.mockResolvedValue([]);
    mocks.createQueue.mockResolvedValue(undefined); mocks.schedule.mockResolvedValue(undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); });


  async function recurringRunner() {
    const runner = await initializeJobRunner() as PgBossJobRunner;
    // Keep actual scheduleRecurringJob and registration; replace only job-record IO.
    vi.spyOn(runner as any, 'createJobRecord').mockResolvedValue({ jobId: 'test-job' });
    vi.spyOn(runner as any, 'updateJobExternalId').mockResolvedValue(undefined);
    return runner;
  }

  it('shares same-queue registration across overlapping discoveries and subsequent ticks', async () => {
    const runner = await recurringRunner();
    const queue = 'recover-comment-publications:concurrent-tenant';
    mocks.discover.mockResolvedValue([{ tenant: 'concurrent-tenant' }]);
    let release!: () => void;
    mocks.work.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const first = createCommentRecoveryScheduleDiscovery(initializeJobRunner);
    const second = createCommentRecoveryScheduleDiscovery(initializeJobRunner);
    const ticks = Promise.all([first.tick(), second.tick()]);
    await vi.waitFor(() => expect(mocks.createQueue).toHaveBeenCalledTimes(2));
    const attempts = mocks.work.mock.calls.filter(([name]) => name === queue).length;
    const scheduledBeforeRegistration = mocks.schedule.mock.calls.length;
    const readyBeforeRegistration = runner.hasHandler(queue);
    release(); await ticks;
    expect(attempts).toBe(1);
    expect(scheduledBeforeRegistration).toBe(0);
    expect(readyBeforeRegistration).toBe(false);
    expect(runner.hasHandler(queue)).toBe(true);
    await first.tick(); await second.tick();
    expect(mocks.work.mock.calls.filter(([name]) => name === queue)).toHaveLength(1);
    expect(new Set(mocks.schedule.mock.calls.map(([name]) => name))).toEqual(new Set([queue]));
  });

  it('propagates a shared registration failure to every scheduler caller and coalesces their retry', async () => {
    const runner = await recurringRunner();
    const queue = 'recover-comment-publications:retry-tenant';
    const successfulWorkers = mocks.work.mock.calls.length;
    let reject!: (error: Error) => void;
    mocks.work.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const schedule = () => runner.scheduleRecurringJob('recover-comment-publications', { tenantId: 'retry-tenant' }, '* * * * *');
    const attempts = Promise.allSettled([schedule(), schedule()]);
    await vi.waitFor(() => expect(mocks.createQueue).toHaveBeenCalledTimes(2));
    const error = new Error('Queue worker registration unavailable');
    reject(error);
    const results = await attempts;
    expect(results).toEqual([{ status: 'rejected', reason: error }, { status: 'rejected', reason: error }]);
    for (const result of results) {
      if (result.status === 'rejected') expect(result.reason).toBe(error);
    }
    expect(runner.hasHandler(queue)).toBe(false);
    expect(mocks.schedule).not.toHaveBeenCalled();
    await Promise.all([schedule(), schedule()]);
    await schedule();
    expect(runner.hasHandler(queue)).toBe(true);
    expect(mocks.work.mock.calls.filter(([name]) => name === queue)).toHaveLength(2); // failed attempt + successful retry
    expect(mocks.work).toHaveBeenCalledTimes(successfulWorkers + 2);
    expect(new Set(mocks.schedule.mock.calls.map(([name]) => name))).toEqual(new Set([queue]));
  });

  it('reuses a successful worker while replacing its handler implementation', async () => {
    const runner = await recurringRunner();
    const original = vi.fn(), replacement = vi.fn();
    await runner.registerHandler({ name: 'replacement-test', handler: original });
    await runner.registerHandler({ name: 'replacement-test', handler: replacement });
    const workers = mocks.work.mock.calls.filter(([name]) => name === 'replacement-test');
    expect(workers).toHaveLength(1);
    await workers[0][2]([{ id: 'test-delivery', data: { tenantId: 'test-tenant' } }]);
    expect(original).not.toHaveBeenCalled();
    expect(replacement).toHaveBeenCalledWith('test-delivery', expect.objectContaining({ tenantId: 'test-tenant' }));
  });

  it('does not report cached registration success after the workers have stopped', async () => {
    const runner = await recurringRunner();
    await runner.stop();
    mocks.work.mockRejectedValueOnce(new Error('Workers are disabled. pg-boss is stopped'));
    await expect(runner.registerHandler(JobHandlerRegistry.get('recover-comment-publications')!.config))
      .rejects.toThrow('pg-boss is stopped');
    expect(mocks.stop).toHaveBeenCalledWith({ graceful: true });
  });

  it('registers one worker per actual handler across three successful discovery ticks', async () => {
    const discovery = createCommentRecoveryScheduleDiscovery(initializeJobRunner);
    await discovery.tick(); await discovery.tick(); await discovery.tick();
    expect(mocks.discover).toHaveBeenCalledTimes(3);
    expectOneWorkerPerHandler();
    expect(mocks.services).toHaveBeenCalledTimes(2); // factory + application services, once each
  });

  it('coalesces overlapping discovery instances and direct startup initialization', async () => {
    let release!: () => void;
    mocks.work.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const first = createCommentRecoveryScheduleDiscovery(initializeJobRunner);
    const second = createCommentRecoveryScheduleDiscovery(initializeJobRunner);
    const ticks = [first.tick(), first.tick(), second.tick()];
    const startup = initializeJobRunner();
    await vi.waitFor(() => expect(mocks.work).toHaveBeenCalledTimes(1));
    expect(mocks.discover).not.toHaveBeenCalled();
    release(); await Promise.all([...ticks, startup]);
    expect(mocks.discover).toHaveBeenCalledTimes(2);
    expectOneWorkerPerHandler();
  });

  it('retries unavailable factory initialization after its existing backoff', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    mocks.start.mockRejectedValueOnce(new Error('Scheduler unavailable'));
    const discovery = createCommentRecoveryScheduleDiscovery(initializeJobRunner);
    await discovery.tick(); expect(mocks.work).not.toHaveBeenCalled();
    now.mockReturnValue(200_000);
    await discovery.tick(); await discovery.tick();
    expect(mocks.start).toHaveBeenCalledTimes(2); expectOneWorkerPerHandler();
  });

  it('retries application service initialization on the existing factory runner', async () => {
    mocks.services.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Services unavailable'));
    const discovery = createCommentRecoveryScheduleDiscovery(initializeJobRunner);
    await discovery.tick(); expect(mocks.work).not.toHaveBeenCalled();
    await discovery.tick(); await discovery.tick();
    expect(mocks.start).toHaveBeenCalledOnce(); expectOneWorkerPerHandler();
  });

  it('resumes partial asynchronous registration without recreating successful workers', async () => {
    mocks.work.mockResolvedValueOnce('first-worker').mockRejectedValueOnce(new Error('Worker registration unavailable'));
    const discovery = createCommentRecoveryScheduleDiscovery(initializeJobRunner);
    await discovery.tick();
    expect(mocks.discover).not.toHaveBeenCalled(); expect(mocks.work).toHaveBeenCalledTimes(2);
    const [succeeded, failed] = mocks.work.mock.calls.map(([name]) => name);
    expect(PgBossJobRunner.getInstance().hasHandler(succeeded)).toBe(true);
    expect(PgBossJobRunner.getInstance().hasHandler(failed)).toBe(false);
    await Promise.all([discovery.tick(), initializeJobRunner()]); await discovery.tick();
    for (const name of JobHandlerRegistry.getAll().keys()) {
      expect(mocks.work.mock.calls.filter(([queue]) => queue === name), name).toHaveLength(name === failed ? 2 : 1);
    }
    expect(mocks.discover).toHaveBeenCalledTimes(2);
  });

  it('retries runner start without repeating completed registrations', async () => {
    vi.spyOn(PgBossJobRunner.prototype, 'start').mockRejectedValueOnce(new Error('Start unavailable'));
    const discovery = createCommentRecoveryScheduleDiscovery(initializeJobRunner);
    await discovery.tick(); expect(mocks.discover).not.toHaveBeenCalled();
    await discovery.tick(); await discovery.tick(); expectOneWorkerPerHandler();
  });
});
