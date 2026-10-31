import knexFactory from 'knex';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ctx = vi.hoisted(() => ({ knex: null as any, handler: vi.fn(), filter: vi.fn() }));
// maintenanceJobFanout imports every native handler; none runs here, so stub the heavy graph.
const { stubModule } = vi.hoisted(() => ({ stubModule: () => new Proxy({}, { has: () => true, get: (_t, key) => typeof key !== 'string' || key === 'then' ? undefined : key === '__esModule' ? true : /^[A-Z0-9_]+$/.test(key) ? `stub:${key}` : (() => undefined) }) }));
vi.mock('@alga-psa/jobs/handlers/autoCloseTicketsHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/calendarWebhookMaintenanceHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/cleanupAiSessionKeysHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/cleanupTemporaryFormsJob', stubModule);
vi.mock('@alga-psa/jobs/handlers/cleanupWebhookDeliveriesJob', stubModule);
vi.mock('@alga-psa/jobs/handlers/dateTriggerScanHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/expiredCreditsHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/expiredHourBlocksHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/expiringCreditsNotificationHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/expiringHourBlocksNotificationHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/googleGmailWatchRenewalHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/inboundEmailRecoveryHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/prepaidBalanceAlertScanHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/processRenewalQueueHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/providerDisconnectRetryHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/reconcileBucketUsageHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/reconcileHourBlockAllocationsHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/searchReconcileHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/teamsMeetingArtifactWebhookHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/teamsMeetingSweepHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/telephonyCallArtifactHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/telephonyCallNotificationHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/threecxCallControlReconcileHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/threecxCdrBackfillHandler', stubModule);
vi.mock('@alga-psa/jobs/handlers/threecxPhonebookHandlers', stubModule);
vi.mock('@alga-psa/jobs/handlers/workflowQuotaResumeScanHandler', stubModule);
vi.mock('@alga-psa/billing/actions/contractCadenceServicePeriodMaterialization', stubModule);
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: async () => ctx.knex }));
vi.mock('@alga-psa/co-managed', () => ({ observeDueCoManagedTicketSlas: vi.fn(), processCoManagedSlaEmailDeliveries: vi.fn() }));
vi.mock('@alga-psa/notifications/lib/coManagedSlaNotifications', () => ({ persistCoManagedSlaNotifications: vi.fn() }));
vi.mock('../../../lib/jobs/handlers/coManagedSlaEmailTransport', () => ({ sendCoManagedSlaEmail: vi.fn() }));
vi.mock('@alga-psa/core/capability', async importOriginal => ({ ...(await importOriginal<any>()), filterServed: ctx.filter }));

import { runMaintenanceJob } from '@alga-psa/jobs/fanout';
import { wireJobCapabilityFilter } from '../../../lib/jobs/capabilityJobFilter';
import { getJobCapabilityFilter, registerJobCapabilityFilter, resetJobDescriptors } from '@alga-psa/jobs/fanout';
import { defineCoManagedSlaObservationJob, CO_MANAGED_SLA_OBSERVATION_JOB } from '../../../lib/jobs/handlers/coManagedSlaObservationHandler';

/** A real knex query builder over a stubbed driver: every statement is recorded through the query listener. */
function recordingKnex(statements: string[]) {
  const knex = knexFactory({ client: 'pg' });
  const client = knex.client as any;
  client.acquireConnection = async () => ({});
  client.releaseConnection = async () => undefined;
  client._query = async (_connection: unknown, obj: any) => {
    obj.response = { rows: [{ tenant: 'psa-1' }, { tenant: 'psa-2' }], rowCount: 2, command: 'SELECT' }; return obj;
  };
  knex.on('query', (query: { sql: string }) => statements.push(query.sql));
  return knex;
}

describe('co-managed SLA observation job', () => {
  const statements: string[] = [];
  beforeEach(() => { statements.length = 0; ctx.knex = recordingKnex(statements); ctx.filter.mockReset(); resetJobDescriptors(); wireJobCapabilityFilter(); defineCoManagedSlaObservationJob(); });

  it('runs zero queries against the SLA tables when no tenant participates (A4)', async () => {
    ctx.filter.mockResolvedValue([]);
    const result = await runMaintenanceJob(CO_MANAGED_SLA_OBSERVATION_JOB);
    expect(result).toMatchObject({ scope: 'tenant', total: 0, succeeded: 0, failed: 0 });
    expect(ctx.filter).toHaveBeenCalledWith('co-managed', ['psa-1', 'psa-2']);
    expect(statements.length).toBeGreaterThan(0); // the tenant enumeration was observed...
    expect(statements.filter(sql => /sla_organization|co_managed_sla|organization_sla/.test(sql))).toEqual([]); // ...and nothing else
  });

  it('is idempotent to define more than once', () => {
    expect(() => { defineCoManagedSlaObservationJob(); defineCoManagedSlaObservationJob(); }).not.toThrow();
  });

  it('defining the job registers no filter and never replaces one already wired', async () => {
    resetJobDescriptors();
    defineCoManagedSlaObservationJob();
    expect(getJobCapabilityFilter()).toBeUndefined(); // ungated wiring => the fan-out skips the job, no tenant SQL
    expect(await runMaintenanceJob(CO_MANAGED_SLA_OBSERVATION_JOB)).toMatchObject({ total: 0 });
    const other = vi.fn(async () => []);
    registerJobCapabilityFilter(other);
    wireJobCapabilityFilter(); defineCoManagedSlaObservationJob();
    expect(getJobCapabilityFilter()).toBe(other);
  });
});
