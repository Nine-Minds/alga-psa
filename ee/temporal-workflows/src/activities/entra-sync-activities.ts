import logger from '@alga-psa/core/logger';
import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { createTenantKnex, runWithTenant } from '@alga-psa/db/tenant';
import { isTenantSuspended, retryOnTenantReadOnly, tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildClientCreatedPayload } from '@alga-psa/workflow-streams';
import { getEntraProviderAdapter } from '@ee/lib/integrations/entra/providers';
import { executeEntraSync } from '@ee/lib/integrations/entra/sync/syncEngine';
import { provisionEntraClientForMapping } from '@ee/lib/integrations/entra/sync/clientProvisioningService';
import { projectCompletedSyncUserCount } from '@ee/lib/integrations/entra/sync/completedSyncUserCountService';
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
  ProvisionEntraClientActivityInput,
  EntraManagedTenantRef,
} from '../types/entra-sync';

type MappingRow = {
  managed_tenant_id: string;
  entra_tenant_id: string;
  client_id: string | null;
  mapping_state: 'mapped' | 'create_new';
  display_name: string | null;
  primary_domain: string | null;
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
      })
      .select({
        managed_tenant_id: 'm.managed_tenant_id',
        client_id: 'm.client_id',
        mapping_state: 'm.mapping_state',
        entra_tenant_id: 't.entra_tenant_id',
        display_name: 't.display_name',
        primary_domain: 't.primary_domain',
      })
      .orderBy('m.updated_at', 'asc');
    db.tenantJoin(query, 'entra_managed_tenants as t', 'm.managed_tenant_id', 't.managed_tenant_id');

    if (input.includeCreateNew) {
      query.whereIn('m.mapping_state', ['mapped', 'create_new']);
    } else {
      query.andWhere('m.mapping_state', 'mapped');
    }

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
      mappingState: row.mapping_state,
      displayName: row.display_name ? String(row.display_name) : null,
      primaryDomain: row.primary_domain ? String(row.primary_domain) : null,
    })),
  };
}

/**
 * Turn one operator-approved create-new decision into a real mapped client.
 * The client insert, default billing rows and mapping promotion share one DB
 * transaction. A Temporal retry therefore either repeats no committed work or
 * observes the already-promoted mapping and reuses its client.
 */
export async function provisionEntraClientActivity(
  input: ProvisionEntraClientActivityInput
): Promise<EntraManagedTenantRef> {
  if (input.mapping.mappingState !== 'create_new') {
    if (!input.mapping.clientId) {
      throw new Error(`Mapped Entra tenant ${input.mapping.managedTenantId} has no client ID.`);
    }
    return input.mapping;
  }

  const provisioned = await retryOnTenantReadOnly(
    () => runWithTenant(input.tenantId, async () => {
      const { knex } = await createTenantKnex();
      return provisionEntraClientForMapping(knex, {
        tenantId: input.tenantId,
        managedTenantId: input.mapping.managedTenantId,
      });
    }),
    { logLabel: 'provisionEntraClientActivity' }
  );

  if (provisioned.created) {
    const createdAt = provisioned.client.created_at
      ? String(provisioned.client.created_at)
      : new Date().toISOString();
    try {
      await publishWorkflowEvent({
        eventType: 'CLIENT_CREATED',
        payload: buildClientCreatedPayload({
          clientId: String(provisioned.client.client_id),
          clientName: String(provisioned.client.client_name),
          createdByUserId: input.actorUserId,
          createdAt,
          status: 'active',
        }),
        ctx: {
          tenantId: input.tenantId,
          occurredAt: createdAt,
          actor: input.actorUserId
            ? { actorType: 'USER', actorUserId: input.actorUserId }
            : undefined,
        },
        idempotencyKey: `client_created:${provisioned.client.client_id}`,
      });
    } catch (error) {
      logger.warn('Provisioned Entra client but failed to publish CLIENT_CREATED event', {
        tenantId: input.tenantId,
        managedTenantId: input.mapping.managedTenantId,
        clientId: provisioned.client.client_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ...input.mapping,
    clientId: String(provisioned.client.client_id),
    mappingState: 'mapped',
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
    eligibleUserCount: filteredUsers.included.length,
    isDryRun: Boolean(input.dryRun),
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
        } catch (error: unknown) {
          logger.warn('Entra run notifications were not delivered', {
            tenantId: input.tenantId,
            runId: input.runId,
            error: error instanceof Error ? error.message : 'unknown error',
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
        await knex.transaction((trx) => recordSyncTenantResultWithDb(trx, input));
      }),
    { logLabel: 'recordSyncTenantResultActivity' }
  );
}

/**
 * Persist one tenant result and its completed-sync count projection together.
 * Exported as a DB-injected boundary so the tenant-scoped behavior can be
 * verified transactionally without mocking Knex or opening a second connection.
 */
export async function recordSyncTenantResultWithDb(
  knex: Knex,
  input: RecordSyncTenantResultActivityInput
): Promise<void> {
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
  } else {
    await db.table('entra_sync_run_tenants').insert({
      ...row,
      run_tenant_id: randomUUID(),
      created_at: now,
    });
  }

  await projectCompletedSyncUserCount(knex, {
    tenantId: input.tenantId,
    managedTenantId: input.result.managedTenantId,
    status: input.result.status,
    isDryRun: input.result.isDryRun,
    eligibleUserCount: input.result.eligibleUserCount,
  });
}
