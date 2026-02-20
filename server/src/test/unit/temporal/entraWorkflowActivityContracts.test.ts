import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../../');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('Entra Temporal workflow/activity contracts', () => {
  it('T070: discovery workflow executes discovery activity between start and completion logging', () => {
    const workflow = readRepoFile('ee/temporal-workflows/src/workflows/entra-discovery-workflow.ts');
    const startLogIndex = workflow.indexOf("Starting Entra discovery workflow");
    const activityCallIndex = workflow.indexOf(
      'const result = await activities.discoverManagedTenantsActivity'
    );
    const completeLogIndex = workflow.indexOf("Completed Entra discovery workflow");

    expect(startLogIndex).toBeGreaterThan(-1);
    expect(activityCallIndex).toBeGreaterThan(startLogIndex);
    expect(completeLogIndex).toBeGreaterThan(activityCallIndex);
  });

  it('T071: initial sync workflow loads mapped tenants before iterating per-tenant sync activity', () => {
    const workflow = readRepoFile('ee/temporal-workflows/src/workflows/entra-initial-sync-workflow.ts');
    const loadMappedIndex = workflow.indexOf(
      'const mappedTenants = await activities.loadMappedTenantsActivity'
    );
    const loopIndex = workflow.indexOf('for (const mapping of mappedTenants.mappings)');
    const syncIndex = workflow.indexOf('await activities.syncTenantUsersActivity');

    expect(loadMappedIndex).toBeGreaterThan(-1);
    expect(loopIndex).toBeGreaterThan(loadMappedIndex);
    expect(syncIndex).toBeGreaterThan(loopIndex);
  });

  it('T072: tenant sync workflow scopes to requested managed-tenant/client mapping context', () => {
    const workflow = readRepoFile('ee/temporal-workflows/src/workflows/entra-tenant-sync-workflow.ts');

    expect(workflow).toContain('managedTenantId: input.managedTenantId');
    expect(workflow).toContain('const selectedMapping = mappedTenants.mappings.find((mapping) => {');
    expect(workflow).toContain('if (mapping.managedTenantId !== input.managedTenantId)');
    expect(workflow).toContain('if (input.clientId && mapping.clientId && mapping.clientId !== input.clientId)');
  });

  it('T073: all-tenants sync workflow iterates all mapped tenants from loadMappedTenantsActivity', () => {
    const workflow = readRepoFile('ee/temporal-workflows/src/workflows/entra-all-tenants-sync-workflow.ts');

    expect(workflow).toContain('const mappedTenants = await activities.loadMappedTenantsActivity');
    expect(workflow).toContain('for (const mapping of mappedTenants.mappings)');
    expect(workflow).toContain('await activities.syncTenantUsersActivity');
  });

  it('T074: upsertSyncRunActivity writes parent run with initiating user and run mode', () => {
    const activity = readRepoFile('ee/temporal-workflows/src/activities/entra-sync-activities.ts');

    expect(activity).toContain('export async function upsertSyncRunActivity');
    expect(activity).toContain('runType: input.runType');
    expect(activity).toContain('initiatedBy: input.initiatedBy');
    expect(activity).toContain('run_type: input.runType');
    expect(activity).toContain('initiated_by: input.initiatedBy || null');
  });

  it('T075: recordSyncTenantResultActivity persists per-tenant counters and status rows', () => {
    const activity = readRepoFile('ee/temporal-workflows/src/activities/entra-sync-activities.ts');

    expect(activity).toContain('export async function recordSyncTenantResultActivity');
    expect(activity).toContain("knex('entra_sync_run_tenants')");
    expect(activity).toContain('created_count: input.result.created');
    expect(activity).toContain('linked_count: input.result.linked');
    expect(activity).toContain('updated_count: input.result.updated');
    expect(activity).toContain('ambiguous_count: input.result.ambiguous');
    expect(activity).toContain('inactivated_count: input.result.inactivated');
  });

  it('T076: finalizeSyncRunActivity sets terminal status and summary totals on parent run', () => {
    const activity = readRepoFile('ee/temporal-workflows/src/activities/entra-sync-activities.ts');

    expect(activity).toContain('export async function finalizeSyncRunActivity');
    expect(activity).toContain("knex('entra_sync_runs')");
    expect(activity).toContain('status: input.status');
    expect(activity).toContain('completed_at: now');
    expect(activity).toContain('total_tenants: input.summary.totalTenants');
    expect(activity).toContain('processed_tenants: input.summary.processedTenants');
    expect(activity).toContain('summary: knex.raw(\'?::jsonb\', [JSON.stringify(input.summary)])');
  });

  it('T077: workflow registration index exports all Entra workflows', () => {
    const workflowIndex = readRepoFile('ee/temporal-workflows/src/workflows/index.ts');

    expect(workflowIndex).toContain("export * from './entra-discovery-workflow.js';");
    expect(workflowIndex).toContain("export * from './entra-initial-sync-workflow.js';");
    expect(workflowIndex).toContain("export * from './entra-tenant-sync-workflow.js';");
    expect(workflowIndex).toContain("export * from './entra-all-tenants-sync-workflow.js';");
  });

  it('T078: activity registration index exports Entra discovery and sync activities', () => {
    const activityIndex = readRepoFile('ee/temporal-workflows/src/activities/index.ts');

    expect(activityIndex).toContain('export * from "./entra-discovery-activities";');
    expect(activityIndex).toContain('export * from "./entra-sync-activities";');
  });

  it('T086: schedule setup creates tenant-scoped Entra recurring schedules when enabled and connected', () => {
    const scheduleSource = readRepoFile('ee/temporal-workflows/src/schedules/setupSchedules.ts');

    expect(scheduleSource).toContain('const ENTRA_SCHEDULE_ID_PREFIX = \'entra-all-tenants-sync-schedule\'');
    expect(scheduleSource).toContain('const entraConfigs = await loadEntraScheduleConfigs();');
    expect(scheduleSource).toContain('for (const config of entraConfigs)');
    expect(scheduleSource).toContain('if (!config.syncEnabled || !config.hasActiveConnection)');
    expect(scheduleSource).toContain('await upsertSchedule(client, tenantScheduleId, {');
    expect(scheduleSource).toContain('workflowType: entraAllTenantsSyncWorkflow');
    expect(scheduleSource).toContain("trigger: 'scheduled'");
  });

  it('T087: schedule setup updates existing Entra schedule definitions when schedule already exists', () => {
    const scheduleSource = readRepoFile('ee/temporal-workflows/src/schedules/setupSchedules.ts');

    expect(scheduleSource).toContain('async function upsertSchedule(client: Client, scheduleId: string, input: any)');
    expect(scheduleSource).toContain('await client.schedule.create({');
    expect(scheduleSource).toContain('if (!isAlreadyExistsError(error))');
    expect(scheduleSource).toContain('const handle = client.schedule.getHandle(scheduleId);');
    expect(scheduleSource).toContain('await handle.update((prev) => ({');
    expect(scheduleSource).toContain('spec: input.spec');
    expect(scheduleSource).toContain('action: input.action');
  });

  it('T089: no-mapped-tenant workflow paths complete with zero-processed summaries', () => {
    const initialWorkflow = readRepoFile('ee/temporal-workflows/src/workflows/entra-initial-sync-workflow.ts');
    const allTenantsWorkflow = readRepoFile('ee/temporal-workflows/src/workflows/entra-all-tenants-sync-workflow.ts');

    expect(initialWorkflow).toContain('const summary = createEmptySummary(mappedTenants.mappings.length);');
    expect(initialWorkflow).toContain('summary.failedTenants === 0');
    expect(initialWorkflow).toContain("? 'completed'");
    expect(initialWorkflow).toContain('processedTenants: 0');

    expect(allTenantsWorkflow).toContain('const summary = createEmptySummary(mappedTenants.mappings.length);');
    expect(allTenantsWorkflow).toContain('summary.failedTenants === 0');
    expect(allTenantsWorkflow).toContain("? 'completed'");
    expect(allTenantsWorkflow).toContain('processedTenants: 0');
  });
});
