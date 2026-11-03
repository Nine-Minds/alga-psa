import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const mocks = vi.hoisted(() => {
  const jobs = new Map<string, { metadata: string }>();
  let active = 0;
  let tail = Promise.resolve();
  let peak = 0;
  const acquire = async () => {
    const previous = tail;
    let releaseTurn!: () => void;
    tail = new Promise<void>(resolve => { releaseTurn = resolve; });
    await previous;
    active++;
    peak = Math.max(peak, active);
    return () => {
      active--;
      releaseTurn();
    };
  };
  const transaction = async (fn: any) => {
    const release = await acquire();
    try { return await fn({ raw: vi.fn() }); } finally { release(); }
  };
  return { publish: vi.fn(), wait: vi.fn(async (..._args: any[]) => undefined), jobs, transaction, getPeak: () => peak };
});
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: mocks.publish, publishWorkflowEvent: vi.fn(async () => undefined), publishNonCatalogWorkflowEvent: vi.fn(async () => undefined), publishStoredWorkflowEvent: vi.fn(async () => undefined), publishBuiltWorkflowPayload: vi.fn(async () => undefined), publishNonCatalogEventByName: vi.fn(async () => undefined), publishUnregisteredEventType: vi.fn(async () => undefined) }));
vi.mock('@alga-psa/jobs/lib/forwardedJobCompletion', () => ({
  beginForwardedJobExecution: (metadata: Record<string, unknown>, executionId: string) => ({
    ...metadata, serverExecution: { executionId, status: 'queued' },
  }),
  waitForForwardedJobCompletion: mocks.wait,
}));
vi.mock('@alga-psa/jobs/handlers/workflowScheduledRunHandlers', () => ({ workflowOneTimeScheduledRunHandler: vi.fn(), workflowRecurringScheduledRunHandler: vi.fn() }));
vi.mock('@alga-psa/jobs/handlers/extensionScheduledInvocationHandler', () => ({ extensionScheduledInvocationHandler: vi.fn() }));
vi.mock('@alga-psa/jobs/handlers/kbArticleImportHandler', () => ({ KB_ARTICLE_IMPORT_JOB: 'kb-article-import', kbArticleImportHandler: vi.fn() }));
vi.mock('@alga-psa/jobs/runners/TemporalJobRunner', () => ({ TemporalJobRunner: { create: vi.fn() } }));
// Only the job-name constants are used here; the workflow runtime behind them is not under test.
vi.mock('@alga-psa/workflows/lib/workflowScheduleLifecycle', () => ({ WORKFLOW_ONE_TIME_TRIGGER_JOB: 'workflow-one-time-trigger', WORKFLOW_RECURRING_TRIGGER_JOB: 'workflow-recurring-trigger' }));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: async () => ({ transaction: mocks.transaction }), withAdminTransactionRetryReadOnly: mocks.transaction }));
vi.mock('@alga-psa/db', async original => ({
  ...await original<any>(),
  isTenantSuspended: async () => false,
  getAdminConnection: async () => ({ transaction: mocks.transaction }),
  tenantDb: () => ({ table: () => ({
    where: (criteria: { job_id: string }) => ({
      forUpdate: () => ({ first: async () => mocks.jobs.get(criteria.job_id) }),
      first: async () => {
        const job = mocks.jobs.get(criteria.job_id);
        return job && { status: 'queued', metadata: job.metadata };
      },
      update: async (value: any) => {
        const job = mocks.jobs.get(criteria.job_id);
        if (!job) return 0;
        job.metadata = value.metadata;
        return 1;
      },
    }),
  }) }),
}));

import { EventSchemas } from '@alga-psa/event-schemas';
import { initializeJobHandlersForWorker, executeJobHandler } from '../job-activities';

// The server side (maintenance subscriber -> registered recovery handler) is
// covered in server/src/test/unit/jobs; the shared event schema is the contract.
describe('recover-comment-publications worker forwarding', () => {
  afterEach(() => vi.clearAllMocks());
  it('forwards the job to the server as a strict MAINTENANCE_JOB_REQUESTED event and reports publish failures', async () => {
    await initializeJobHandlersForWorker();
    const tenantId = randomUUID(), jobId = randomUUID();
    mocks.jobs.set(jobId, { metadata: '{}' });
    mocks.publish.mockResolvedValue(undefined);
    expect(await executeJobHandler({ jobName: 'recover-comment-publications', jobId, tenantId, jobExecutionId: randomUUID(), data: {} })).toEqual({ success: true });
    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(mocks.wait).toHaveBeenCalledOnce();
    const [event, options] = mocks.publish.mock.calls[0];
    expect(options).toEqual({ strict: true });
    const validated = EventSchemas.MAINTENANCE_JOB_REQUESTED.parse({ id: randomUUID(), timestamp: new Date().toISOString(), ...event });
    // The server handler reads the tenant from the forwarded job data.
    expect(validated.payload).toMatchObject({ tenantId, jobId, executionId: expect.any(String), jobName: 'recover-comment-publications', data: { tenantId } });
    expect(mocks.wait).toHaveBeenCalledWith(expect.any(Function), expect.any(String));

    // Forwarding failures surface to the worker so Temporal retries the activity.
    mocks.publish.mockRejectedValueOnce(new Error('Redis unavailable'));
    expect(await executeJobHandler({ jobName: 'recover-comment-publications', jobId, tenantId, jobExecutionId: randomUUID(), data: {} })).toEqual({ success: false, error: 'Redis unavailable' });
  });

  it('does not report invoice email success when the event is published but no app consumer executes it', async () => {
    const { waitForForwardedJobCompletion } = await vi.importActual<
      typeof import('@alga-psa/jobs/lib/forwardedJobCompletion')
    >('@alga-psa/jobs/lib/forwardedJobCompletion');
    await initializeJobHandlersForWorker();
    const tenantId = randomUUID(), jobId = randomUUID();
    const executionId = randomUUID();
    mocks.jobs.set(jobId, { metadata: '{}' });
    mocks.publish.mockResolvedValue(undefined);
    mocks.wait.mockImplementation((readStatus: any, forwardedExecutionId: string) =>
      waitForForwardedJobCompletion(readStatus, forwardedExecutionId, {
        timeoutMs: 2,
        pollIntervalMs: 1,
        sleep: async () => undefined,
      }));

    const result = await executeJobHandler({
      jobName: 'invoice_email', jobId, tenantId, jobExecutionId: executionId, data: {},
    });

    expect(mocks.publish).toHaveBeenCalledOnce();
    expect(mocks.wait).toHaveBeenCalledOnce();
    expect(result).toEqual({
      success: false,
      error: 'Timed out waiting for the application server to complete the forwarded job',
    });
    expect(JSON.parse(mocks.jobs.get(jobId)!.metadata).serverExecution).toMatchObject({
      executionId,
      status: 'queued',
    });
  });

  it('completes concurrent forwarded executions with a one-connection admin pool', async () => {
    const { waitForForwardedJobCompletion } = await vi.importActual<
      typeof import('@alga-psa/jobs/lib/forwardedJobCompletion')
    >('@alga-psa/jobs/lib/forwardedJobCompletion');
    await initializeJobHandlersForWorker();
    const tenantId = randomUUID();
    const jobIds = [randomUUID(), randomUUID()];
    for (const jobId of jobIds) mocks.jobs.set(jobId, { metadata: '{}' });
    mocks.publish.mockImplementation(async (event: any) => {
      const row = mocks.jobs.get(event.payload.jobId)!;
      row.metadata = JSON.stringify({ serverExecution: {
        executionId: event.payload.executionId,
        status: 'completed',
      } });
    });
    mocks.wait.mockImplementation((readStatus: any, executionId: string) =>
      waitForForwardedJobCompletion(readStatus, executionId, { pollIntervalMs: 1 }));

    const results = await Promise.all(jobIds.map(jobId => executeJobHandler({
      jobName: 'invoice_email', jobId, tenantId, jobExecutionId: randomUUID(), data: {},
    })));

    expect(results).toEqual([{ success: true }, { success: true }]);
    expect(mocks.getPeak()).toBe(1);
    for (const jobId of jobIds) {
      expect(JSON.parse(mocks.jobs.get(jobId)!.metadata).serverExecution.status).toBe('completed');
    }
  }, 5000);
});
