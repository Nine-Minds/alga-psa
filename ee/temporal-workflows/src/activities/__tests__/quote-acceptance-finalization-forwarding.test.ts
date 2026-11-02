import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const mocks = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: mocks.publish,
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/jobs/handlers/workflowScheduledRunHandlers', () => ({
  workflowOneTimeScheduledRunHandler: vi.fn(),
  workflowRecurringScheduledRunHandler: vi.fn(),
}));
vi.mock('@alga-psa/jobs/handlers/extensionScheduledInvocationHandler', () => ({ extensionScheduledInvocationHandler: vi.fn() }));
vi.mock('@alga-psa/jobs/handlers/kbArticleImportHandler', () => ({
  KB_ARTICLE_IMPORT_JOB: 'kb-article-import',
  kbArticleImportHandler: vi.fn(),
}));
vi.mock('@alga-psa/jobs/runners/TemporalJobRunner', () => ({ TemporalJobRunner: { create: vi.fn() } }));
vi.mock('@alga-psa/workflows/lib/workflowScheduleLifecycle', () => ({
  WORKFLOW_ONE_TIME_TRIGGER_JOB: 'workflow-one-time-trigger',
  WORKFLOW_RECURRING_TRIGGER_JOB: 'workflow-recurring-trigger',
}));
vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(),
  withAdminTransactionRetryReadOnly: (fn: any) => fn({ raw: vi.fn() }),
}));
vi.mock('@alga-psa/db', async original => ({
  ...await original<any>(),
  isTenantSuspended: async () => false,
  getAdminConnection: vi.fn(),
}));

import { EventSchemas } from '@alga-psa/event-schemas';
import { executeJobHandler, initializeJobHandlersForWorker } from '../job-activities';

describe('quote acceptance finalization Temporal forwarding', () => {
  afterEach(() => vi.clearAllMocks());

  it('dispatches the accepted quote payload to the server and reports handoff failures for Temporal retry', async () => {
    await initializeJobHandlersForWorker();
    const tenantId = randomUUID();
    const quoteId = randomUUID();
    const decisionId = randomUUID();
    const jobId = randomUUID();
    const jobExecutionId = randomUUID();
    const data = { tenantId, quoteId, decisionId };
    mocks.publish.mockResolvedValue(undefined);

    expect(await executeJobHandler({
      jobName: 'finalize-link-accepted-quote',
      jobId,
      tenantId,
      jobExecutionId,
      data,
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
      jobName: 'finalize-link-accepted-quote',
      jobId,
      data,
    });

    mocks.publish.mockRejectedValueOnce(new Error('Server execution failed'));
    await expect(executeJobHandler({
      jobName: 'finalize-link-accepted-quote',
      jobId,
      tenantId,
      jobExecutionId,
      data,
    })).rejects.toThrow('Server execution failed');
    expect(mocks.publish).toHaveBeenLastCalledWith(expect.anything(), { strict: true });
  });
});
