import logger from '@alga-psa/core/logger';
import { randomUUID } from 'crypto';
import { createTenantKnex, runWithTenant } from '@alga-psa/db/tenant';
import { getEntraProviderAdapter } from '@ee/lib/integrations/entra/providers';
import { EntraSyncResultAggregator } from '@ee/lib/integrations/entra/sync/syncResultAggregator';
import { filterEntraUsers } from '@ee/lib/integrations/entra/sync/userFilterPipeline';
import type { EntraConnectionType } from '@ee/interfaces/entra.interfaces';
import type {
  LoadMappedTenantsActivityInput,
  LoadMappedTenantsActivityOutput,
  SyncTenantUsersActivityInput,
  EntraTenantSyncResult,
  UpsertEntraSyncRunActivityInput,
  UpsertEntraSyncRunActivityOutput,
  FinalizeSyncRunActivityInput,
  RecordSyncTenantResultActivityInput,
} from '../types/entra-sync';

async function getActiveConnectionType(tenantId: string): Promise<EntraConnectionType> {
  const activeConnection = await runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();
    return knex('entra_partner_connections')
      .where({
        tenant: tenantId,
        is_active: true,
      })
      .orderBy('updated_at', 'desc')
      .first(['connection_type']);
  });

  if (!activeConnection?.connection_type) {
    throw new Error('No active Entra connection exists for this tenant.');
  }

  return activeConnection.connection_type as EntraConnectionType;
}

export async function loadMappedTenantsActivity(
  input: LoadMappedTenantsActivityInput
): Promise<LoadMappedTenantsActivityOutput> {
  logger.info('Running loadMappedTenantsActivity', {
    tenantId: input.tenantId,
    managedTenantId: input.managedTenantId,
  });

  const mappings = await runWithTenant(input.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const query = knex('entra_client_tenant_mappings as m')
      .join('entra_managed_tenants as t', function joinManagedTenants() {
        this.on('m.tenant', '=', 't.tenant').andOn(
          'm.managed_tenant_id',
          '=',
          't.managed_tenant_id'
        );
      })
      .where({
        'm.tenant': input.tenantId,
        'm.is_active': true,
        'm.mapping_state': 'mapped',
      })
      .select('m.managed_tenant_id', 'm.client_id', 't.entra_tenant_id')
      .orderBy('m.updated_at', 'asc');

    if (input.managedTenantId) {
      query.andWhere('m.managed_tenant_id', input.managedTenantId);
    }

    return query;
  });

  return {
    mappings: mappings.map((row: any) => ({
      managedTenantId: String(row.managed_tenant_id),
      entraTenantId: String(row.entra_tenant_id),
      clientId: row.client_id ? String(row.client_id) : null,
    })),
  };
}

export async function syncTenantUsersActivity(
  input: SyncTenantUsersActivityInput
): Promise<EntraTenantSyncResult> {
  logger.info('Running syncTenantUsersActivity', {
    tenantId: input.tenantId,
    runId: input.runId,
    managedTenantId: input.mapping.managedTenantId,
    clientId: input.mapping.clientId,
  });

  const connectionType = await getActiveConnectionType(input.tenantId);
  const adapter = getEntraProviderAdapter(connectionType);

  const users = await adapter.listUsersForTenant({
    tenant: input.tenantId,
    managedTenantId: input.mapping.managedTenantId,
  });
  const filteredUsers = filterEntraUsers(users);
  const counters = new EntraSyncResultAggregator();
  counters.increment('linked', filteredUsers.included.length);

  // Phase-1 activity pipeline currently tracks per-tenant pull + aggregate counters.
  // Contact-level reconciliation is implemented in later sync features.
  const aggregated = counters.toJSON();

  return {
    managedTenantId: input.mapping.managedTenantId,
    clientId: input.mapping.clientId || null,
    status: 'completed',
    created: aggregated.created,
    linked: aggregated.linked,
    updated: aggregated.updated,
    ambiguous: aggregated.ambiguous,
    inactivated: aggregated.inactivated,
    errorMessage: null,
  };
}

export async function upsertSyncRunActivity(
  input: UpsertEntraSyncRunActivityInput
): Promise<UpsertEntraSyncRunActivityOutput> {
  logger.info('Running upsertSyncRunActivity', {
    tenantId: input.tenantId,
    workflowId: input.workflowId,
    runType: input.runType,
    initiatedBy: input.initiatedBy,
  });

  return runWithTenant(input.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const now = knex.fn.now();

    const existing = await knex('entra_sync_runs')
      .where({
        tenant: input.tenantId,
        workflow_id: input.workflowId,
      })
      .first(['run_id']);

    if (existing?.run_id) {
      await knex('entra_sync_runs')
        .where({
          tenant: input.tenantId,
          run_id: existing.run_id,
        })
        .update({
          status: 'running',
          initiated_by: input.initiatedBy || null,
          updated_at: now,
        });
      return { runId: String(existing.run_id) };
    }

    const runId = randomUUID();
    await knex('entra_sync_runs').insert({
      tenant: input.tenantId,
      run_id: runId,
      workflow_id: input.workflowId,
      run_type: input.runType,
      status: 'running',
      initiated_by: input.initiatedBy || null,
      started_at: now,
      completed_at: null,
      total_tenants: 0,
      processed_tenants: 0,
      succeeded_tenants: 0,
      failed_tenants: 0,
      summary: knex.raw(`'{}'::jsonb`),
      created_at: now,
      updated_at: now,
    });

    return { runId };
  });
}

export async function finalizeSyncRunActivity(
  input: FinalizeSyncRunActivityInput
): Promise<void> {
  logger.info('Running finalizeSyncRunActivity', {
    tenantId: input.tenantId,
    runId: input.runId,
    status: input.status,
    summary: input.summary,
  });

  await runWithTenant(input.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const now = knex.fn.now();

    await knex('entra_sync_runs')
      .where({
        tenant: input.tenantId,
        run_id: input.runId,
      })
      .update({
        status: input.status,
        completed_at: now,
        total_tenants: input.summary.totalTenants,
        processed_tenants: input.summary.processedTenants,
        succeeded_tenants: input.summary.succeededTenants,
        failed_tenants: input.summary.failedTenants,
        summary: knex.raw('?::jsonb', [JSON.stringify(input.summary)]),
        updated_at: now,
      });
  });
}

export async function recordSyncTenantResultActivity(
  input: RecordSyncTenantResultActivityInput
): Promise<void> {
  logger.info('Running recordSyncTenantResultActivity', {
    tenantId: input.tenantId,
    runId: input.runId,
    managedTenantId: input.result.managedTenantId,
    status: input.result.status,
  });

  await runWithTenant(input.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const now = knex.fn.now();

    const existing = await knex('entra_sync_run_tenants')
      .where({
        tenant: input.tenantId,
        run_id: input.runId,
        managed_tenant_id: input.result.managedTenantId,
      })
      .first(['run_tenant_id']);

    const row = {
      tenant: input.tenantId,
      run_id: input.runId,
      managed_tenant_id: input.result.managedTenantId,
      client_id: input.result.clientId || null,
      status: input.result.status,
      created_count: input.result.created,
      linked_count: input.result.linked,
      updated_count: input.result.updated,
      ambiguous_count: input.result.ambiguous,
      inactivated_count: input.result.inactivated,
      error_message: input.result.errorMessage || null,
      started_at: now,
      completed_at: now,
      updated_at: now,
    };

    if (existing?.run_tenant_id) {
      await knex('entra_sync_run_tenants')
        .where({
          tenant: input.tenantId,
          run_tenant_id: existing.run_tenant_id,
        })
        .update(row);
      return;
    }

    await knex('entra_sync_run_tenants').insert({
      ...row,
      run_tenant_id: randomUUID(),
      created_at: now,
    });
  });
}
