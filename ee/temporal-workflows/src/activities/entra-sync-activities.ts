import logger from '@alga-psa/core/logger';
import { randomUUID } from 'crypto';
import { createTenantKnex, runWithTenant } from '@alga-psa/db/tenant';
import { isTenantSuspended, retryOnTenantReadOnly, tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import { getEntraProviderAdapter } from '@ee/lib/integrations/entra/providers';
import { executeEntraSync } from '@ee/lib/integrations/entra/sync/syncEngine';
import { filterEntraUsersForTenant } from '@ee/lib/integrations/entra/settingsService';
import { decideEntraRunNotifications } from '@ee/lib/integrations/entra/notifications/entraSyncNotificationRules';
import {
  deliverEntraNotifications,
  getEntraNotificationConfig,
} from '@ee/lib/integrations/entra/notifications/entraSyncNotifications';
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

type MappingRow = {
  managed_tenant_id: string;
  entra_tenant_id: string;
  client_id: string | null;
};

async function getActiveConnectionType(tenantId: string): Promise<EntraConnectionType> {
  const activeConnection = await runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();
    return tenantDb(knex, tenantId).table('entra_partner_connections')
      .where({
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

  // Suspended tenants (cancelled, pending deletion) sync nothing; the
  // schedule may predate the suspension, so re-check per run.
  if (await isTenantSuspended(await getAdminConnection(), input.tenantId)) {
    logger.info('Skipping Entra mapping load for suspended tenant', {
      tenantId: input.tenantId,
    });
    return { mappings: [] };
  }

  const mappings = await runWithTenant(input.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, input.tenantId);
    const query = db.table('entra_client_tenant_mappings as m')
      .where({
        'm.is_active': true,
        'm.mapping_state': 'mapped',
      })
      .select({
        managed_tenant_id: 'm.managed_tenant_id',
        client_id: 'm.client_id',
        entra_tenant_id: 't.entra_tenant_id',
      })
      .orderBy('m.updated_at', 'asc');
    db.tenantJoin(query, 'entra_managed_tenants as t', 'm.managed_tenant_id', 't.managed_tenant_id');

    if (input.managedTenantId) {
      query.andWhere('m.managed_tenant_id', input.managedTenantId);
    }

    return query;
  });

  return {
    mappings: (mappings as MappingRow[]).map((row) => ({
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

  if (!input.mapping.clientId) {
    throw new Error(
      `Mapping ${input.mapping.managedTenantId} is missing clientId; cannot reconcile contacts.`
    );
  }

  const users = await adapter.listUsersForTenant({
    tenant: input.tenantId,
    // Adapter expects the Microsoft tenant GUID (used as `tenantId eq ...` filter
    // in the managedTenants/users Graph call). The DB's managed_tenant_id is a
    // local PK and must not be passed here.
    managedTenantId: input.mapping.entraTenantId,
  });
  const filteredUsers = await filterEntraUsersForTenant(input.tenantId, users);

  const fieldSyncConfig = await runWithTenant(input.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const row = await tenantDb(knex, input.tenantId).table('entra_sync_settings')
      .first(['field_sync_config']);
    const raw = row?.field_sync_config;
    return raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  });

  const disabledIdentities = filteredUsers.excluded
    .filter((entry) => entry.reason === 'account_disabled')
    .map((entry) => ({
      entraTenantId: entry.user.entraTenantId,
      entraObjectId: entry.user.entraObjectId,
      displayName: entry.user.displayName,
      email: entry.user.email,
      userPrincipalName: entry.user.userPrincipalName,
    }));

  // Inactivation goes through executeEntraSync rather than beside it, so the
  // dry-run guard covers every write this activity can cause.
  const syncResult = await executeEntraSync({
    tenantId: input.tenantId,
    clientId: input.mapping.clientId,
    managedTenantId: input.mapping.managedTenantId,
    users: filteredUsers.included,
    fieldSyncConfig,
    dryRun: Boolean(input.dryRun),
    disabledIdentities,
  });

  return {
    managedTenantId: input.mapping.managedTenantId,
    clientId: input.mapping.clientId,
    status: 'completed',
    created: syncResult.counters.created,
    linked: syncResult.counters.linked,
    updated: syncResult.counters.updated,
    ambiguous: syncResult.counters.ambiguous,
    inactivated: syncResult.counters.inactivated,
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

  return retryOnTenantReadOnly(
    () =>
      runWithTenant(input.tenantId, async () => {
        const { knex } = await createTenantKnex();
        const now = knex.fn.now();
        const db = tenantDb(knex, input.tenantId);

        const existing = await db.table('entra_sync_runs')
          .where({
            workflow_id: input.workflowId,
          })
          .first(['run_id']);

        if (existing?.run_id) {
          await db.table('entra_sync_runs')
            .where({
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
        await db.table('entra_sync_runs').insert({
          tenant: input.tenantId,
          run_id: runId,
          workflow_id: input.workflowId,
          run_type: input.runType,
          status: 'running',
          initiated_by: input.initiatedBy || null,
          scope_managed_tenant_id: input.scopeManagedTenantId || null,
          scope_client_id: input.scopeClientId || null,
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
      }),
    { logLabel: 'upsertSyncRunActivity' }
  );
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

  await retryOnTenantReadOnly(
    () =>
      runWithTenant(input.tenantId, async () => {
        const { knex } = await createTenantKnex();
        const now = knex.fn.now();

        const db = tenantDb(knex, input.tenantId);

        // The previous real runs decide whether this failure is "repeated";
        // previews changed nothing and are not part of that history.
        const previousRuns = await db.table('entra_sync_runs')
          .where({ is_dry_run: false })
          .whereNot({ run_id: input.runId })
          .orderBy('started_at', 'desc')
          .limit(3)
          .select(['status']);

        await db.table('entra_sync_runs')
          .where({
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

        // Best effort, and never inside the run's own success path: a sync that
        // worked must not be reported as failed because a notification was not
        // delivered.
        try {
          const config = await getEntraNotificationConfig(knex, input.tenantId);
          const notifications = decideEntraRunNotifications({
            status: input.status,
            summary: input.summary,
            previousRunStatuses: (previousRuns as Array<{ status?: unknown }>).map((row) =>
              String(row.status || '')
            ),
            config,
          });
          await deliverEntraNotifications({
            knex,
            tenantId: input.tenantId,
            notifications,
          });
        } catch (error: any) {
          logger.warn('Entra run notifications were not delivered', {
            tenantId: input.tenantId,
            runId: input.runId,
            error: error?.message || 'unknown error',
          });
        }
      }),
    { logLabel: 'finalizeSyncRunActivity' }
  );
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

  await retryOnTenantReadOnly(
    () =>
      runWithTenant(input.tenantId, async () => {
        const { knex } = await createTenantKnex();
        const now = knex.fn.now();
        const db = tenantDb(knex, input.tenantId);

        const existing = await db.table('entra_sync_run_tenants')
          .where({
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
          await db.table('entra_sync_run_tenants')
            .where({
              run_tenant_id: existing.run_tenant_id,
            })
            .update(row);
          return;
        }

        await db.table('entra_sync_run_tenants').insert({
          ...row,
          run_tenant_id: randomUUID(),
          created_at: now,
        });
      }),
    { logLabel: 'recordSyncTenantResultActivity' }
  );
}
