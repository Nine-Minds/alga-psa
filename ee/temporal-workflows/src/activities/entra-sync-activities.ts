import logger from '@alga-psa/core/logger';
import { randomUUID } from 'crypto';
import { createTenantKnex, runWithTenant } from '@alga-psa/db/tenant';
import { getEntraProviderAdapter } from '@ee/lib/integrations/entra/providers';
import type { EntraConnectionType } from '@ee/interfaces/entra.interfaces';
import type {
  LoadMappedTenantsActivityInput,
  LoadMappedTenantsActivityOutput,
  SyncTenantUsersActivityInput,
  EntraTenantSyncResult,
  UpsertEntraSyncRunActivityInput,
  UpsertEntraSyncRunActivityOutput,
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

  // Phase-1 activity pipeline currently tracks per-tenant pull + aggregate counters.
  // Contact-level reconciliation is implemented in later sync features.
  const processedCount = users.length;

  return {
    managedTenantId: input.mapping.managedTenantId,
    clientId: input.mapping.clientId || null,
    status: 'completed',
    created: 0,
    linked: processedCount,
    updated: 0,
    ambiguous: 0,
    inactivated: 0,
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
