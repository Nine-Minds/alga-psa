import { randomUUID } from 'crypto';
import { createTenantKnex, runWithTenant } from '@/lib/db';
import { tenantDb } from '@alga-psa/db';
import { getEntraProviderAdapter } from '../providers';
import { getActiveEntraPartnerConnection } from '../connectionRepository';
import { filterEntraUsersForManagedTenant } from '../settingsService';
import type { EntraUserFilterConfig } from './userFilterConfig';
import { DEACTIVATABLE_EXCLUSION_REASONS } from './userFilterPipeline';
import {
  executeEntraSync,
  type EntraSyncPreviewBucket,
  type EntraSyncPreviewIdentity,
} from './syncEngine';

/**
 * The preflight: run the sync against the directory, decide what it would do to
 * every identity, and write nothing but the audit row saying a preview happened.
 *
 * It goes through executeEntraSync with dryRun set rather than reimplementing
 * the classification, so the preview cannot drift from the sync it previews —
 * a preflight whose counts disagree with the run that follows is worse than no
 * preflight at all.
 */

export const ENTRA_PREVIEW_BUCKETS: readonly EntraSyncPreviewBucket[] = [
  'create',
  'link',
  'needs_decision',
  'no_change',
  'mark_inactive',
] as const;

export interface EntraPreflightBucket {
  bucket: EntraSyncPreviewBucket;
  count: number;
  /** A readable slice, not the whole directory. */
  samples: EntraSyncPreviewIdentity[];
}

export interface EntraPreflightResult {
  runId: string;
  managedTenantId: string;
  clientId: string;
  checkedAt: string;
  totalIdentities: number;
  excludedByReason: Record<string, number>;
  unknownFieldCounts: { userType: number; assignedLicenseCount: number };
  warnings: string[];
  excludedContactsOutOfScope: number;
  counters: {
    created: number;
    linked: number;
    updated: number;
    ambiguous: number;
    inactivated: number;
  };
  buckets: EntraPreflightBucket[];
}

const DEFAULT_SAMPLE_LIMIT = 25;

function bucketize(
  preview: EntraSyncPreviewIdentity[],
  sampleLimit: number
): EntraPreflightBucket[] {
  return ENTRA_PREVIEW_BUCKETS.map((bucket) => {
    const matching = preview.filter((identity) => identity.bucket === bucket);
    return {
      bucket,
      count: matching.length,
      samples: matching.slice(0, sampleLimit),
    };
  });
}

async function loadMappingForPreflight(
  tenantId: string,
  params: { managedTenantId?: string | null; clientId?: string | null }
): Promise<{ managedTenantId: string; clientId: string; entraTenantId: string } | null> {
  return runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenantId);

    const query = db.table('entra_client_tenant_mappings as m')
      .where({
        'm.is_active': true,
        'm.mapping_state': 'mapped',
      })
      .select({
        managed_tenant_id: 'm.managed_tenant_id',
        client_id: 'm.client_id',
        entra_tenant_id: 't.entra_tenant_id',
      });
    db.tenantJoin(query, 'entra_managed_tenants as t', 'm.managed_tenant_id', 't.managed_tenant_id');

    if (params.managedTenantId) {
      query.andWhere('m.managed_tenant_id', params.managedTenantId);
    }
    if (params.clientId) {
      query.andWhere('m.client_id', params.clientId);
    }

    const row = await query.first();
    if (!row?.managed_tenant_id || !row?.client_id) {
      return null;
    }

    return {
      managedTenantId: String(row.managed_tenant_id),
      clientId: String(row.client_id),
      entraTenantId: String(row.entra_tenant_id),
    };
  });
}

async function recordPreflightRun(params: {
  tenantId: string;
  managedTenantId: string;
  clientId: string;
  userId?: string | null;
  totalIdentities: number;
  counters: EntraPreflightResult['counters'];
}): Promise<string> {
  const runId = randomUUID();

  await runWithTenant(params.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const now = knex.fn.now();

    await tenantDb(knex, params.tenantId).table('entra_sync_runs').insert({
      tenant: params.tenantId,
      run_id: runId,
      workflow_id: null,
      run_type: 'preflight',
      status: 'completed',
      is_dry_run: true,
      scope_managed_tenant_id: params.managedTenantId,
      scope_client_id: params.clientId,
      initiated_by: params.userId || null,
      started_at: now,
      completed_at: now,
      total_tenants: 1,
      processed_tenants: 1,
      succeeded_tenants: 1,
      failed_tenants: 0,
      summary: knex.raw('?::jsonb', [
        JSON.stringify({
          totalTenants: 1,
          processedTenants: 1,
          succeededTenants: 1,
          failedTenants: 0,
          totalIdentities: params.totalIdentities,
          ...params.counters,
        }),
      ]),
      created_at: now,
      updated_at: now,
    });
  });

  return runId;
}

export async function runEntraPreflight(params: {
  tenantId: string;
  managedTenantId?: string | null;
  clientId?: string | null;
  userId?: string | null;
  sampleLimit?: number;
  /**
   * Rules to preview instead of the stored ones, so "what would turning this
   * on do?" can be answered before saving it.
   */
  fieldSyncConfigOverride?: Record<string, unknown> | null;
  userFilterConfigOverride?: EntraUserFilterConfig | null;
}): Promise<EntraPreflightResult> {
  const mapping = await loadMappingForPreflight(params.tenantId, {
    managedTenantId: params.managedTenantId,
    clientId: params.clientId,
  });

  if (!mapping) {
    throw new Error('No confirmed mapping matches the requested preflight scope.');
  }

  const connection = await getActiveEntraPartnerConnection(params.tenantId);
  if (!connection?.connection_type) {
    throw new Error('No active Entra connection exists for this tenant.');
  }

  const adapter = getEntraProviderAdapter(connection.connection_type);
  const users = await adapter.listUsersForTenant({
    tenant: params.tenantId,
    managedTenantId: mapping.entraTenantId,
  });
  const filtered = await filterEntraUsersForManagedTenant({ tenant: params.tenantId, managedTenantId: mapping.managedTenantId, entraTenantId: mapping.entraTenantId, adapter, users, configOverride: params.userFilterConfigOverride ?? undefined });

  const fieldSyncConfig = params.fieldSyncConfigOverride
    ? params.fieldSyncConfigOverride
    : await runWithTenant(params.tenantId, async () => {
      const { knex } = await createTenantKnex();
      const row = await tenantDb(knex, params.tenantId).table('entra_sync_settings')
        .first(['field_sync_config']);
      const raw = row?.field_sync_config;
      return raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    });

  const disabledIdentities = filtered.excluded
    .filter((entry) => entry.reason === 'account_disabled')
    .map((entry) => ({
      entraTenantId: entry.user.entraTenantId,
      entraObjectId: entry.user.entraObjectId,
      displayName: entry.user.displayName,
      email: entry.user.email,
      userPrincipalName: entry.user.userPrincipalName,
    }));
  const excludedIdentities = filtered.deactivateExcludedContacts ? filtered.excluded
    .filter((entry) => DEACTIVATABLE_EXCLUSION_REASONS.includes(entry.reason as typeof DEACTIVATABLE_EXCLUSION_REASONS[number]))
    .map(({ user, reason }) => ({ reason, entraTenantId: user.entraTenantId, entraObjectId: user.entraObjectId, displayName: user.displayName, email: user.email, userPrincipalName: user.userPrincipalName })) : [];
  const excludedByReason = filtered.excluded.reduce<Record<string, number>>((counts, entry) => { counts[entry.reason] = (counts[entry.reason] || 0) + 1; return counts; }, {});

  const result = await executeEntraSync({
    tenantId: params.tenantId,
    clientId: mapping.clientId,
    managedTenantId: mapping.managedTenantId,
    users: filtered.included,
    fieldSyncConfig,
    dryRun: true,
    disabledIdentities,
    excludedIdentities,
    deactivateExcludedContacts: filtered.deactivateExcludedContacts,
    enabledSourceUserCount: users.filter((user) => user.accountEnabled).length,
    entraTenantId: mapping.entraTenantId,
  });

  const preview = result.preview || [];
  const runId = await recordPreflightRun({
    tenantId: params.tenantId,
    managedTenantId: mapping.managedTenantId,
    clientId: mapping.clientId,
    userId: params.userId,
    totalIdentities: preview.length,
    counters: result.counters,
  });

  return {
    runId,
    managedTenantId: mapping.managedTenantId,
    clientId: mapping.clientId,
    checkedAt: new Date().toISOString(),
    totalIdentities: preview.length,
    excludedByReason,
    unknownFieldCounts: filtered.unknownFieldCounts,
    warnings: [
      ...(result.warnings || []),
      ...(filtered.unknownFieldCounts.userType > 0 ? [`User type data unavailable for ${filtered.unknownFieldCounts.userType} users; unknown users were kept.`] : []),
      ...(filtered.unknownFieldCounts.assignedLicenseCount > 0 ? [`License data unavailable for ${filtered.unknownFieldCounts.assignedLicenseCount} users; unknown users were kept.`] : []),
    ],
    excludedContactsOutOfScope: result.excludedContactsOutOfScope ?? 0,
    counters: result.counters,
    buckets: bucketize(preview, params.sampleLimit ?? DEFAULT_SAMPLE_LIMIT),
  };
}
