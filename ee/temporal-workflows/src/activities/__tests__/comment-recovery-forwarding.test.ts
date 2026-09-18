import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const mocks = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: mocks.publish }));
vi.mock('@alga-psa/jobs/handlers/workflowScheduledRunHandlers', () => ({ workflowOneTimeScheduledRunHandler: vi.fn(), workflowRecurringScheduledRunHandler: vi.fn() }));
vi.mock('@alga-psa/jobs/handlers/extensionScheduledInvocationHandler', () => ({ extensionScheduledInvocationHandler: vi.fn() }));
vi.mock('@alga-psa/jobs/handlers/kbArticleImportHandler', () => ({ KB_ARTICLE_IMPORT_JOB: 'kb-article-import', kbArticleImportHandler: vi.fn() }));
vi.mock('@alga-psa/jobs/runners/TemporalJobRunner', () => ({ TemporalJobRunner: { create: vi.fn() } }));
// Only the job-name constants are used here; the workflow runtime behind them is not under test.
vi.mock('@alga-psa/workflows/lib/workflowScheduleLifecycle', () => ({ WORKFLOW_ONE_TIME_TRIGGER_JOB: 'workflow-one-time-trigger', WORKFLOW_RECURRING_TRIGGER_JOB: 'workflow-recurring-trigger' }));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: vi.fn(), withAdminTransactionRetryReadOnly: (fn: any) => fn({ raw: vi.fn() }) }));
vi.mock('@alga-psa/db', async original => ({ ...await original<any>(), isTenantSuspended: async () => false, getAdminConnection: vi.fn() }));

import { EventSchemas } from '@alga-psa/event-schemas';
import { initializeJobHandlersForWorker, executeJobHandler } from '../job-activities';

// The server side (maintenance subscriber -> registered recovery handler) is
// covered in server/src/test/unit/jobs; the shared event schema is the contract.
describe('recover-comment-publications worker forwarding', () => {
  afterEach(() => vi.clearAllMocks());
  it('forwards the job to the server as a strict MAINTENANCE_JOB_REQUESTED event and reports publish failures', async () => {
    await initializeJobHandlersForWorker();
    const tenantId = randomUUID(), jobId = randomUUID();
    mocks.publish.mockResolvedValue(undefined);
    expect(await executeJobHandler({ jobName: 'recover-comment-publications', jobId, tenantId, jobExecutionId: randomUUID(), data: {} })).toEqual({ success: true });
    expect(mocks.publish).toHaveBeenCalledOnce();
    const [event, options] = mocks.publish.mock.calls[0];
    expect(options).toEqual({ strict: true });
    const validated = EventSchemas.MAINTENANCE_JOB_REQUESTED.parse({ id: randomUUID(), timestamp: new Date().toISOString(), ...event });
    // The server handler reads the tenant from the forwarded job data.
    expect(validated.payload).toMatchObject({ tenantId, jobId, jobName: 'recover-comment-publications', data: { tenantId } });
    // Forwarding failures surface to the worker so Temporal retries the activity.
    mocks.publish.mockRejectedValueOnce(new Error('Redis unavailable'));
    expect(await executeJobHandler({ jobName: 'recover-comment-publications', jobId, tenantId, jobExecutionId: randomUUID(), data: {} })).toEqual({ success: false, error: 'Redis unavailable' });
  });
});
