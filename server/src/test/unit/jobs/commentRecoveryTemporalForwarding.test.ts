import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const mocks = vi.hoisted(() => ({ publish: vi.fn(), recover: vi.fn(), subscribe: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: mocks.publish }));
vi.mock('@/lib/eventBus/index', () => ({ getEventBus: () => ({ subscribe: mocks.subscribe, unsubscribe: vi.fn() }) }));
vi.mock('@alga-psa/jobs/handlers/workflowScheduledRunHandlers', () => ({ workflowOneTimeScheduledRunHandler: vi.fn(), workflowRecurringScheduledRunHandler: vi.fn() }));
vi.mock('@alga-psa/jobs/handlers/extensionScheduledInvocationHandler', () => ({ extensionScheduledInvocationHandler: vi.fn() }));
vi.mock('@alga-psa/jobs/handlers/kbArticleImportHandler', () => ({ KB_ARTICLE_IMPORT_JOB: 'kb-article-import', kbArticleImportHandler: vi.fn() }));
vi.mock('@alga-psa/jobs/runners/TemporalJobRunner', () => ({ TemporalJobRunner: { create: vi.fn() } }));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: vi.fn(), withAdminTransactionRetryReadOnly: (fn: any) => fn({ raw: vi.fn() }) }));
vi.mock('@alga-psa/db', async original => ({ ...await original<any>(), isTenantSuspended: async () => false, getAdminConnection: vi.fn() }));
vi.mock('@/lib/jobs/handlers/publishScheduledCommentHandler', () => ({
  PUBLISH_SCHEDULED_COMMENT_JOB: 'publish-scheduled-comment', publishScheduledCommentHandler: vi.fn(), reconcileScheduledCommentPublications: mocks.recover,
}));

import { initializeJobHandlersForWorker, executeJobHandler } from '../../../../../ee/temporal-workflows/src/activities/job-activities';
import { registerAllJobHandlers } from '@/lib/jobs/registerAllHandlers';
import { registerMaintenanceJobSubscriber, unregisterMaintenanceJobSubscriber } from '@/lib/eventBus/subscribers/maintenanceJobSubscriber';

describe('Temporal comment recovery forwarding', () => {
  afterEach(async () => { await unregisterMaintenanceJobSubscriber(); vi.clearAllMocks(); });
  it('dispatches the worker activity through the maintenance subscriber and registered server handler', async () => {
    await initializeJobHandlersForWorker();
    await registerAllJobHandlers({ jobService: {} as any, storageService: {} as any, includeEnterprise: false, force: true });
    await registerMaintenanceJobSubscriber();
    const receive = mocks.subscribe.mock.calls[0][1];
    mocks.publish.mockResolvedValue(undefined);
    const tenantId = randomUUID(), jobId = randomUUID();
    expect(await executeJobHandler({ jobName: 'recover-comment-publications', jobId, tenantId, jobExecutionId: randomUUID(), data: {} })).toEqual({ success: true });
    expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'MAINTENANCE_JOB_REQUESTED', payload: expect.objectContaining({ tenantId, jobId, jobName: 'recover-comment-publications' }) }), { strict: true });
    const envelope = { ...mocks.publish.mock.calls[0][0], id: randomUUID(), timestamp: new Date().toISOString() };
    await receive(envelope);
    expect(mocks.recover).toHaveBeenCalledExactlyOnceWith(false, tenantId);
    // Server failures propagate to the event bus; forwarding failures to the worker.
    mocks.recover.mockRejectedValueOnce(new Error('Recovery storage unavailable'));
    await expect(receive(envelope)).rejects.toThrow('Recovery storage unavailable');
    mocks.publish.mockRejectedValueOnce(new Error('Redis unavailable'));
    expect(await executeJobHandler({ jobName: 'recover-comment-publications', jobId, tenantId, jobExecutionId: randomUUID(), data: {} })).toEqual({ success: false, error: 'Redis unavailable' });
  });
});
