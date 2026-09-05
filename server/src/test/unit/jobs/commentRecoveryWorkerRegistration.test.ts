import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ work: vi.fn(), start: vi.fn(), stop: vi.fn(), services: vi.fn(), discover: vi.fn() }));
// Discovery, factory, initializer, registry and PgBossJobRunner are real;
// replace only infrastructure and unrelated handler dependencies.
vi.mock('pg-boss', () => ({ default: class { on() {} start = mocks.start; stop = mocks.stop; work = mocks.work; } }));
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
  });
  afterEach(() => { vi.restoreAllMocks(); });

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
