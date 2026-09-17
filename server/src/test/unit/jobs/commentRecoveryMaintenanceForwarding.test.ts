import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const mocks = vi.hoisted(() => ({ recover: vi.fn(), subscribe: vi.fn() }));
vi.mock('@/lib/eventBus/index', () => ({ getEventBus: () => ({ subscribe: mocks.subscribe, unsubscribe: vi.fn() }) }));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: vi.fn(), withAdminTransactionRetryReadOnly: (fn: any) => fn({ raw: vi.fn() }) }));
vi.mock('@alga-psa/db', async original => ({ ...await original<any>(), isTenantSuspended: async () => false, getAdminConnection: vi.fn() }));
vi.mock('@/lib/jobs/handlers/publishScheduledCommentHandler', () => ({
  PUBLISH_SCHEDULED_COMMENT_JOB: 'publish-scheduled-comment', publishScheduledCommentHandler: vi.fn(), reconcileScheduledCommentPublications: mocks.recover,
}));

import { EventSchemas } from '@alga-psa/event-schemas';
import { registerAllJobHandlers } from '@/lib/jobs/registerAllHandlers';
import { registerMaintenanceJobSubscriber, unregisterMaintenanceJobSubscriber } from '@/lib/eventBus/subscribers/maintenanceJobSubscriber';

// The Temporal worker forwards recover-comment-publications as a
// MAINTENANCE_JOB_REQUESTED event (covered in ee/temporal-workflows); the
// shared event schema is the contract, so this side is exercised with an
// envelope validated against that schema rather than by importing the worker.
describe('comment recovery forwarded through the maintenance subscriber', () => {
  afterEach(async () => { await unregisterMaintenanceJobSubscriber(); vi.clearAllMocks(); });
  it('runs the registered server recovery handler for a forwarded request', async () => {
    await registerAllJobHandlers({ jobService: {} as any, storageService: {} as any, includeEnterprise: false, force: true });
    await registerMaintenanceJobSubscriber();
    const receive = mocks.subscribe.mock.calls[0][1];
    const tenantId = randomUUID(), jobId = randomUUID();
    const envelope = EventSchemas.MAINTENANCE_JOB_REQUESTED.parse({
      id: randomUUID(), eventType: 'MAINTENANCE_JOB_REQUESTED', timestamp: new Date().toISOString(),
      // The worker forwards the job data with the tenant folded in.
      payload: { tenantId, occurredAt: new Date().toISOString(), jobName: 'recover-comment-publications', jobId, data: { tenantId } },
    });
    await receive(envelope);
    expect(mocks.recover).toHaveBeenCalledExactlyOnceWith(false, tenantId);
    // Server failures propagate to the event bus so the delivery is retried rather than acknowledged.
    mocks.recover.mockRejectedValueOnce(new Error('Recovery storage unavailable'));
    await expect(receive(envelope)).rejects.toThrow('Recovery storage unavailable');
  });
});
