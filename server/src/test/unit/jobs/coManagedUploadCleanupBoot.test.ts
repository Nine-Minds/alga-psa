import { describe, expect, it, vi } from 'vitest';

// Boot registration: prepareMaintenanceRegistry() -> registerServerMaintenanceJobs() must leave
// the co-managed upload-cleanup job declared, scheduled, capability-gated, with a filter and the
// co-managed sweep adapter, so a capability-gated descriptor is never silently skipped at runtime.
const mocks = vi.hoisted(() => ({ uploads: vi.fn(async () => ({ purgedFiles: 1 })), transfers: vi.fn(async () => ({ purged: 1 })), filterServed: vi.fn(async (_c: string, ids: string[]) => ids.slice(0, 1)) }));
vi.mock('@alga-psa/db', () => ({ getConnection: async () => 'db', createTenantKnex: vi.fn() }));
vi.mock('@alga-psa/co-managed', () => ({ cleanupCoManagedUploads: mocks.uploads, cleanupCoManagedThreadTransfers: mocks.transfers }));
vi.mock('@alga-psa/core/capability', () => ({ filterServed: mocks.filterServed }));

// The unrelated server handlers pull in the whole domain graph (and the repo's zod `.guid` environment
// failure); stub them so this test exercises only the boot wiring.
const stub = vi.hoisted(() => (...names: string[]) => () => Object.fromEntries(names.map(n => [n, vi.fn()])));
vi.mock('../../../lib/jobs/handlers/lowStockNotificationHandler', stub('lowStockNotificationHandler'));
vi.mock('../../../lib/jobs/handlers/opportunityDisciplineHandler', stub('opportunityDisciplineHandler'));
vi.mock('../../../lib/jobs/handlers/opportunityGeneratorsHandler', stub('opportunityGeneratorsHandler'));
vi.mock('../../../lib/jobs/handlers/opportunityWeeklyDigestHandler', stub('opportunityWeeklyDigestHandler'));
vi.mock('../../../lib/jobs/handlers/projectDateReadinessHandler', stub('projectDateReadinessHandler'));
vi.mock('../../../lib/jobs/handlers/accountingSyncCycleHandler', stub('accountingSyncCycleHandler'));
vi.mock('../../../lib/jobs/handlers/huduAutoSyncHandler', stub('huduAutoSyncHandler'));
vi.mock('../../../lib/jobs/handlers/publishScheduledCommentHandler', stub('reconcileScheduledCommentPublications'));
vi.mock('../../../lib/jobs/handlers/generateRecurringTicketsHandler', stub('generateRecurringTicketsHandler', 'tenantsWithActiveRecurringTickets'));
vi.mock('../../../lib/jobs/tenantPeriodMaintenance', stub('createClientContractLineCyclesForAllTenants', 'createNextTimePeriodForTenant'));
vi.mock('../../../lib/jobs/initializeJobRunner', () => ({ initializeJobRunner: vi.fn() }));
// @alga-psa/jobs/fanout re-exports jobDescriptors (real here) but its other imports hit the repo's zod
// `.guid` environment failure; the fan-out map itself is not under test.
vi.mock('@alga-psa/jobs/fanout', async () => ({ ...(await import('../../../../../packages/jobs/src/lib/jobDescriptors')), registerMaintenanceJob: vi.fn() }));
vi.mock('@alga-psa/storage/fileUploadTransaction', () => ({ recoverFileUploads: vi.fn() }));

describe('co-managed upload cleanup is registered at boot', () => {
  it('registers descriptor, fan-out schedule, capability filter and the co-managed adapter', async () => {
    const { registerServerMaintenanceJobs } = await import('../../../lib/jobs/registerServerMaintenanceJobs');
    const { getJobDescriptor, getJobCapabilityFilter } = await import('@alga-psa/jobs/fanout');
    const { coManagedUploadCleanupHandler, CO_MANAGED_UPLOAD_CLEANUP_JOB } = await import('@alga-psa/jobs/handlers/coManagedUploadCleanupHandler');
    registerServerMaintenanceJobs();
    registerServerMaintenanceJobs(); // idempotent
    expect(getJobDescriptor(CO_MANAGED_UPLOAD_CLEANUP_JOB)).toMatchObject({ scope: 'tenant', capability: 'co-managed' });
    const filter = getJobCapabilityFilter();
    expect(filter).toBeTypeOf('function');
    await expect(filter!('co-managed', ['a', 'b'])).resolves.toEqual(['a']);
    const out = await coManagedUploadCleanupHandler({ tenantId: 'a', limit: 3 });
    expect(Object.keys(out)).toEqual(['co-managed']); // base draft sweep is NOT double-run here
    expect(mocks.uploads).toHaveBeenCalledWith('db', 'a', expect.any(Function), 3);
    expect(mocks.transfers).toHaveBeenCalledWith('db', 'a', expect.any(Function), 3);
    const { listExtensionMaintenanceSchedules } = await import('@alga-psa/types');
    expect(JSON.stringify(listExtensionMaintenanceSchedules())).toContain(CO_MANAGED_UPLOAD_CLEANUP_JOB);
  });
});
