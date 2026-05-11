import logger from '@alga-psa/core/logger';
import { randomUUID } from 'crypto';
import { createTenantKnex, runWithTenant } from '@alga-psa/db/tenant';
import { retryOnTenantReadOnly } from '@alga-psa/db';
import { getEntraProviderAdapter } from '@ee/lib/integrations/entra/providers';
import { executeEntraSync } from '@ee/lib/integrations/entra/sync/syncEngine';
import {
  normalizeWorkspaceProvisioningMode,
  resolveEffectiveDefaultRoleName,
  resolveEffectiveProvisioningMode,
} from '@ee/lib/integrations/entra/sync/clientPortalEntitlementResolution';
import { handleIneligibleClientPortalLifecycle } from '@ee/lib/integrations/entra/sync/clientPortalProvisioning';
import { publishWorkflowManagedPortalProvisioningEvent } from '@ee/lib/integrations/entra/sync/workflowManagedProvisioning';
import { filterEntraUsersForTenant } from '@ee/lib/integrations/entra/settingsService';
import { markDisabledEntraUsersInactive } from '@ee/lib/integrations/entra/sync/disableHandler';
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

function parseWorkspaceSsoSettings(rawSettings: unknown): {
  defaultProvisioningMode: 'disabled' | 'built_in' | 'workflow_managed';
  defaultRoleName: string;
} {
  let settings: any = rawSettings;
  if (typeof settings === 'string') {
    try {
      settings = JSON.parse(settings);
    } catch {
      settings = {};
    }
  }
  const sso = settings?.sso ?? {};
  const provisioningMode = normalizeWorkspaceProvisioningMode(
    sso.clientPortalEntraProvisioningMode
  );
  const defaultRoleName = resolveEffectiveDefaultRoleName(
    null,
    sso.clientPortalDefaultRoleName
  );
  return {
    defaultProvisioningMode: provisioningMode,
    defaultRoleName,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
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
      .select(
        'm.managed_tenant_id',
        'm.client_id',
        't.entra_tenant_id',
        'm.client_portal_entra_provisioning_mode',
        'm.client_portal_entitlement_group_id',
        'm.client_portal_entitlement_membership_mode',
        'm.client_portal_default_role_name',
        'm.client_portal_workflow_target',
        'm.client_portal_workflow_config'
      )
      .orderBy('m.updated_at', 'asc');

    if (input.managedTenantId) {
      query.andWhere('m.managed_tenant_id', input.managedTenantId);
    }

    return query;
  });

  const workspaceSsoDefaults = await runWithTenant(input.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const tenantSettingsRow = await knex('tenant_settings')
      .where({ tenant: input.tenantId })
      .first(['settings']);
    return parseWorkspaceSsoSettings(tenantSettingsRow?.settings);
  });

  type MappingRow = {
    managed_tenant_id: string;
    entra_tenant_id: string;
    client_id: string | null;
    client_portal_entra_provisioning_mode:
      | 'inherit'
      | 'disabled'
      | 'built_in'
      | 'workflow_managed'
      | null;
    client_portal_entitlement_group_id: string | null;
    client_portal_entitlement_membership_mode: 'transitive' | null;
    client_portal_default_role_name: string | null;
    client_portal_workflow_target: string | null;
    client_portal_workflow_config: Record<string, unknown> | null;
  };

  return {
    mappings: (mappings as MappingRow[]).map((row) => ({
      managedTenantId: String(row.managed_tenant_id),
      entraTenantId: String(row.entra_tenant_id),
      clientId: row.client_id ? String(row.client_id) : null,
      clientPortalEntraProvisioningMode:
        resolveEffectiveProvisioningMode(
          row.client_portal_entra_provisioning_mode,
          workspaceSsoDefaults.defaultProvisioningMode
        ),
      clientPortalEntraProvisioningModeOverride:
        row.client_portal_entra_provisioning_mode === 'built_in' ||
        row.client_portal_entra_provisioning_mode === 'workflow_managed' ||
        row.client_portal_entra_provisioning_mode === 'disabled'
          ? row.client_portal_entra_provisioning_mode
          : 'inherit',
      clientPortalEntitlementGroupId: row.client_portal_entitlement_group_id
        ? String(row.client_portal_entitlement_group_id)
        : null,
      clientPortalEntitlementMembershipMode: 'transitive',
      clientPortalDefaultRoleName: resolveEffectiveDefaultRoleName(
        row.client_portal_default_role_name,
        workspaceSsoDefaults.defaultRoleName
      ),
      clientPortalDefaultRoleNameOverride: row.client_portal_default_role_name
        ? String(row.client_portal_default_role_name)
        : null,
      clientPortalWorkflowTarget: row.client_portal_workflow_target
        ? String(row.client_portal_workflow_target)
        : null,
      clientPortalWorkflowConfig:
        row.client_portal_workflow_config &&
        typeof row.client_portal_workflow_config === 'object' &&
        !Array.isArray(row.client_portal_workflow_config)
          ? row.client_portal_workflow_config
          : null,
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
  const portalEntitlementGroupId = input.mapping.clientPortalEntitlementGroupId || null;
  const portalEntitlementMode = input.mapping.clientPortalEntitlementMembershipMode || 'transitive';
  const membershipCheckConcurrency = 8;
  const usersWithEntitlement = portalEntitlementGroupId
    ? await mapWithConcurrency(
        filteredUsers.included,
        membershipCheckConcurrency,
        async (user) => {
          const isMember = await adapter.isUserInSecurityGroup({
            tenant: input.tenantId,
            managedTenantId: input.mapping.entraTenantId,
            userEntraObjectId: user.entraObjectId,
            groupId: portalEntitlementGroupId,
            membershipMode: portalEntitlementMode,
          });
          return {
            ...user,
            clientPortalEntitlement: {
              groupId: portalEntitlementGroupId,
              membershipMode: portalEntitlementMode,
              isMember,
            },
          };
        }
      )
    : filteredUsers.included.map((user) => ({
        ...user,
        clientPortalEntitlement: {
          groupId: null,
          membershipMode: portalEntitlementMode,
          isMember: null,
        },
      }));

  const fieldSyncConfig = await runWithTenant(input.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const [syncRow, tenantSettingsRow] = await Promise.all([
      knex('entra_sync_settings').where({ tenant: input.tenantId }).first(['field_sync_config']),
      knex('tenant_settings').where({ tenant: input.tenantId }).first(['settings']),
    ]);
    const raw = syncRow?.field_sync_config;
    const fieldSyncConfig =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    let ssoSettingsRaw: any = tenantSettingsRow?.settings;
    if (typeof ssoSettingsRaw === 'string') {
      try {
        ssoSettingsRaw = JSON.parse(ssoSettingsRaw);
      } catch {
        ssoSettingsRaw = {};
      }
    }
    const deactivateOnEntitlementRemoval =
      ssoSettingsRaw?.sso?.deactivateEntraManagedPortalUsersOnEntitlementRemoval === undefined
        ? true
        : Boolean(ssoSettingsRaw?.sso?.deactivateEntraManagedPortalUsersOnEntitlementRemoval);
    return { fieldSyncConfig, deactivateOnEntitlementRemoval };
  });

  const syncResult = await executeEntraSync({
    tenantId: input.tenantId,
    clientId: input.mapping.clientId,
    managedTenantId: input.mapping.managedTenantId,
    users: usersWithEntitlement,
    fieldSyncConfig: fieldSyncConfig.fieldSyncConfig,
    dryRun: false,
    portalEntitlement: {
      provisioningMode: input.mapping.clientPortalEntraProvisioningMode || 'disabled',
      groupId: input.mapping.clientPortalEntitlementGroupId || null,
      membershipMode: input.mapping.clientPortalEntitlementMembershipMode || 'transitive',
      defaultRoleName: input.mapping.clientPortalDefaultRoleName || 'User',
      workflowTarget: input.mapping.clientPortalWorkflowTarget || null,
      workflowConfig: input.mapping.clientPortalWorkflowConfig || null,
      deactivateOnEntitlementRemoval: fieldSyncConfig.deactivateOnEntitlementRemoval,
    },
    syncRunId: input.runId,
  });

  const disabledEntries = filteredUsers.excluded.filter(
    (entry) => entry.reason === 'account_disabled'
  );
  let portalDisabledCount = 0;
  if (input.mapping.clientPortalEntraProvisioningMode !== 'disabled') {
    for (const entry of disabledEntries) {
      const disabledUser = {
        ...entry.user,
        clientPortalEntitlement: {
          groupId: portalEntitlementGroupId,
          membershipMode: portalEntitlementMode,
          isMember: false,
        },
      };

      const contactLink = await runWithTenant(input.tenantId, async () => {
        const { knex } = await createTenantKnex();
        return knex('entra_contact_links')
          .where({
            tenant: input.tenantId,
            entra_tenant_id: entry.user.entraTenantId,
            entra_object_id: entry.user.entraObjectId,
          })
          .orderBy('updated_at', 'desc')
          .first(['contact_name_id']);
      });
      const contactNameId = contactLink?.contact_name_id
        ? String(contactLink.contact_name_id)
        : '';

      if (input.mapping.clientPortalEntraProvisioningMode === 'workflow_managed') {
        if (contactNameId) {
          await publishWorkflowManagedPortalProvisioningEvent(
            {
              tenantId: input.tenantId,
              clientId: input.mapping.clientId,
              managedTenantId: input.mapping.managedTenantId,
              contactNameId,
              defaultRoleName: input.mapping.clientPortalDefaultRoleName || 'User',
              syncRunId: input.runId,
              workflowTarget: input.mapping.clientPortalWorkflowTarget || null,
              workflowConfig: input.mapping.clientPortalWorkflowConfig || null,
            },
            disabledUser
          );
        }
      } else {
        const lifecycle = await handleIneligibleClientPortalLifecycle(
          {
            tenantId: input.tenantId,
            clientId: input.mapping.clientId,
            managedTenantId: input.mapping.managedTenantId,
            contactNameId,
            defaultRoleName: input.mapping.clientPortalDefaultRoleName || 'User',
          },
          disabledUser,
          { eligible: false, reason: 'account_disabled' },
          {
            deactivateOnEntitlementRemoval: fieldSyncConfig.deactivateOnEntitlementRemoval,
          }
        );
        if (lifecycle.outcome === 'deactivated') {
          portalDisabledCount += 1;
        }
      }
    }
  }

  const disabledIdentities = disabledEntries.map((entry) => ({
      entraTenantId: entry.user.entraTenantId,
      entraObjectId: entry.user.entraObjectId,
    }));
  const inactivatedCount = disabledIdentities.length
    ? await markDisabledEntraUsersInactive(input.tenantId, disabledIdentities)
    : 0;

  return {
    managedTenantId: input.mapping.managedTenantId,
    clientId: input.mapping.clientId,
    status: 'completed',
    created: syncResult.counters.created,
    linked: syncResult.counters.linked,
    updated: syncResult.counters.updated,
    ambiguous: syncResult.counters.ambiguous,
    inactivated: syncResult.counters.inactivated + portalDisabledCount + inactivatedCount,
    skipped: syncResult.counters.skipped,
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
      }),
    { logLabel: 'recordSyncTenantResultActivity' }
  );
}
