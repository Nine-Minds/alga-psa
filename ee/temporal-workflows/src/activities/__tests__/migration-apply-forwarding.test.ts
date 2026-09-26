import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const mocks = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: mocks.publish }));
vi.mock('@alga-psa/jobs/handlers/workflowScheduledRunHandlers', () => ({ workflowOneTimeScheduledRunHandler: vi.fn(), workflowRecurringScheduledRunHandler: vi.fn() }));
vi.mock('@alga-psa/jobs/handlers/extensionScheduledInvocationHandler', () => ({ extensionScheduledInvocationHandler: vi.fn() }));
vi.mock('@alga-psa/jobs/handlers/kbArticleImportHandler', () => ({ KB_ARTICLE_IMPORT_JOB: 'kb-article-import', kbArticleImportHandler: vi.fn() }));
vi.mock('@alga-psa/jobs/runners/TemporalJobRunner', () => ({ TemporalJobRunner: { create: vi.fn() } }));
vi.mock('@alga-psa/workflows/lib/workflowScheduleLifecycle', () => ({ WORKFLOW_ONE_TIME_TRIGGER_JOB: 'workflow-one-time-trigger', WORKFLOW_RECURRING_TRIGGER_JOB: 'workflow-recurring-trigger' }));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: vi.fn(), withAdminTransactionRetryReadOnly: (fn: any) => fn({ raw: vi.fn() }) }));
vi.mock('@alga-psa/db', async original => ({ ...await original<any>(), isTenantSuspended: async () => false, getAdminConnection: vi.fn() }));

import { EventSchemas } from '@alga-psa/event-schemas';
import { executeJobHandler, initializeJobHandlersForWorker } from '../job-activities';

describe('migration_apply Temporal forwarding', () => {
  afterEach(() => vi.clearAllMocks());

  it('publishes a strict server request with migration identifiers and propagates publication failures', async () => {
    await initializeJobHandlersForWorker();
    const tenantId = randomUUID();
    const userId = randomUUID();
    const migrationJobId = randomUUID();
    const jobId = randomUUID();
    mocks.publish.mockResolvedValue(undefined);

    expect(await executeJobHandler({
      jobName: 'migration_apply',
      jobId,
      tenantId,
      jobExecutionId: randomUUID(),
      data: { tenantId, userId, migrationJobId },
    })).toEqual({ success: true });

    expect(mocks.publish).toHaveBeenCalledOnce();
    const [event, options] = mocks.publish.mock.calls[0];
    expect(options).toEqual({ strict: true });
    const validated = EventSchemas.MAINTENANCE_JOB_REQUESTED.parse({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...event,
    });
    expect(validated.payload).toMatchObject({
      tenantId,
      jobId,
      jobName: 'migration_apply',
      data: { tenantId, userId, migrationJobId },
    });

    mocks.publish.mockRejectedValueOnce(new Error('Redis unavailable'));
    expect(await executeJobHandler({
      jobName: 'migration_apply',
      jobId,
      tenantId,
      jobExecutionId: randomUUID(),
      data: { tenantId, userId, migrationJobId },
    })).toEqual({ success: false, error: 'Redis unavailable' });
    expect(mocks.publish).toHaveBeenLastCalledWith(expect.anything(), { strict: true });
  });
});
