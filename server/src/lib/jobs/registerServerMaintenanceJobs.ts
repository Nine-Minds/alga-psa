import { registerMaintenanceJob } from '@alga-psa/jobs/fanout';
import type { TenantSelector } from '@alga-psa/jobs/fanout';
import { lowStockNotificationHandler } from './handlers/lowStockNotificationHandler';
import { opportunityDisciplineHandler } from './handlers/opportunityDisciplineHandler';
import { opportunityGeneratorsHandler } from './handlers/opportunityGeneratorsHandler';
import { opportunityWeeklyDigestHandler } from './handlers/opportunityWeeklyDigestHandler';
import { projectDateReadinessHandler } from './handlers/projectDateReadinessHandler';
import { accountingSyncCycleHandler } from './handlers/accountingSyncCycleHandler';
import { huduAutoSyncHandler } from './handlers/huduAutoSyncHandler';
import { reconcileScheduledCommentPublications } from './handlers/publishScheduledCommentHandler';
import { createClientContractLineCyclesForAllTenants, createNextTimePeriodForTenant } from './tenantPeriodMaintenance';
import { initializeJobRunner } from './initializeJobRunner';
import { SERVER_MAINTENANCE_JOBS } from './serverMaintenanceJobNames';

// The Temporal worker's maintenance-fanout:<jobName> schedules name these jobs
// (packages/types/src/constants/maintenanceFanoutSchedules.ts). They are
// registered here rather than in @alga-psa/jobs because their handlers need the
// server's domain graph.

// The Hudu connection table is EE-only and must not be named in CE code (NFR7); the
// @enterprise alias resolves to a stub that selects no tenants in CE builds.
const tenantsWithHuduAutoSync: TenantSelector = async (db) => {
  const mod = await import('@enterprise/lib/integrations/hudu/tenantSync');
  return typeof mod.listHuduAutoSyncTenants === 'function' ? mod.listHuduAutoSyncTenants(db) : [];
};

let registered = false;

export function registerServerMaintenanceJobs(): void {
  if (registered) {
    return;
  }

  registerMaintenanceJob(SERVER_MAINTENANCE_JOBS.lowStockNotification, {
    scope: 'tenant',
    run: (tenantId) => lowStockNotificationHandler({ tenantId }),
  });
  registerMaintenanceJob(SERVER_MAINTENANCE_JOBS.opportunityDiscipline, {
    scope: 'tenant',
    run: (tenantId) => opportunityDisciplineHandler({ tenantId }),
  });
  registerMaintenanceJob(SERVER_MAINTENANCE_JOBS.opportunityGenerators, {
    scope: 'tenant',
    run: (tenantId) => opportunityGeneratorsHandler({ tenantId }),
  });
  registerMaintenanceJob(SERVER_MAINTENANCE_JOBS.opportunityWeeklyDigest, {
    scope: 'tenant',
    run: (tenantId) => opportunityWeeklyDigestHandler({ tenantId }),
  });
  registerMaintenanceJob(SERVER_MAINTENANCE_JOBS.projectDateReadiness, {
    scope: 'tenant',
    run: (tenantId) => projectDateReadinessHandler({ tenantId }),
  });
  // Credential reads hit the secret store per tenant, so keep the fan-out narrow.
  registerMaintenanceJob(SERVER_MAINTENANCE_JOBS.accountingSyncCycle, {
    scope: 'tenant',
    run: (tenantId) => accountingSyncCycleHandler({ tenantId }),
    concurrency: 5,
  });
  registerMaintenanceJob(SERVER_MAINTENANCE_JOBS.huduAutoSync, {
    scope: 'tenant',
    run: (tenantId) => huduAutoSyncHandler({ tenantId }),
    tenants: tenantsWithHuduAutoSync,
    concurrency: 3,
  });
  // Cross-tenant already: without a tenant it scans every tenant's scheduled
  // comments. rearm=false only re-arms comments that lost their one-shot job.
  registerMaintenanceJob(SERVER_MAINTENANCE_JOBS.recoverCommentPublications, {
    scope: 'system',
    run: () => reconcileScheduledCommentPublications(false),
  });
  registerMaintenanceJob(SERVER_MAINTENANCE_JOBS.createNextTimePeriods, {
    scope: 'tenant',
    run: (tenantId) => createNextTimePeriodForTenant(tenantId),
  });
  registerMaintenanceJob(SERVER_MAINTENANCE_JOBS.createClientContractLineCycles, {
    scope: 'system',
    run: () => createClientContractLineCyclesForAllTenants(),
  });
  // Converges per-integration RMM polling schedules with rmm_integrations.
  registerMaintenanceJob(SERVER_MAINTENANCE_JOBS.rmmPollingReconcile, {
    scope: 'system',
    run: async () => {
      const { reconcileRmmPollingSchedules } = await import('@alga-psa/jobs/handlers/rmmAlertPollingHandlers');
      return reconcileRmmPollingSchedules(await initializeJobRunner());
    },
  });

  registered = true;
}
