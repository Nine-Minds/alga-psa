import { dynamic, ok, runtime } from './_responses';
import { requireEntraAccess } from './_guards';
import { createTenantKnex, runWithTenant } from '@enterprise/lib/db';
import { tenantDb } from '@alga-psa/db';
import { getActiveEntraPartnerConnection } from '@enterprise/lib/integrations/entra/connectionRepository';
import { getEntraCippCredentials } from '@enterprise/lib/integrations/entra/providers/cipp/cippSecretStore';
import { resolveMicrosoftCredentialsForTenant } from '@enterprise/lib/integrations/entra/auth/microsoftCredentialResolver';

export { dynamic, runtime };

export async function GET(): Promise<Response> {
  const accessGate = await requireEntraAccess('read');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  const connection = await getActiveEntraPartnerConnection(accessGate.tenantId);

  const summary = await runWithTenant(accessGate.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, accessGate.tenantId);

    const [mappingCountRow, pendingCreateCountRow, lastDiscoveryRow, syncSettingsRow, completedRunRow] = await Promise.all([
      db.table('entra_client_tenant_mappings')
        .where({ is_active: true, mapping_state: 'mapped' })
        .count<{ count: string }>('* as count')
        .first(),
      db.table('entra_client_tenant_mappings')
        .where({ is_active: true, mapping_state: 'create_new' })
        .count<{ count: string }>('* as count')
        .first(),
      db.table('entra_managed_tenants')
        .max<{ last_discovered_at: string | null }>('discovered_at as last_discovered_at')
        .first(),
      db.table('entra_sync_settings')
        .first(['sync_interval_minutes']),
      // One completed real sync is what moves the tenant from guided setup to
      // the operations console, permanently. A preflight is not a sync: it
      // wrote nothing, so it cannot end onboarding.
      db.table('entra_sync_runs')
        .where({ status: 'completed', is_dry_run: false })
        .first(['run_id']),
    ]);

    return {
      mappedTenantCount: Number(mappingCountRow?.count || 0),
      pendingCreateTenantCount: Number(pendingCreateCountRow?.count || 0),
      lastDiscoveryAt: lastDiscoveryRow?.last_discovered_at || null,
      nextSyncIntervalMinutes: Number(syncSettingsRow?.sync_interval_minutes || 0) || null,
      hasCompletedFirstSync: Boolean(completedRunRow),
    };
  });

  let connectionDetails: {
    cippBaseUrl: string | null;
    directTenantId: string | null;
    directCredentialSource: 'profile' | null;
    directProfileId: string | null;
    directProfileName: string | null;
    directProfileMissing: boolean;
  } | null = null;

  if (connection?.connection_type === 'cipp') {
    const credentials = await getEntraCippCredentials(accessGate.tenantId).catch(() => null);
    connectionDetails = {
      cippBaseUrl: credentials?.baseUrl || null,
      directTenantId: null,
      directCredentialSource: null,
      directProfileId: null,
      directProfileName: null,
      directProfileMissing: false,
    };
  } else if (connection?.connection_type === 'direct') {
    const credentials = await resolveMicrosoftCredentialsForTenant(accessGate.tenantId).catch(() => null);
    connectionDetails = {
      cippBaseUrl: null,
      directTenantId: credentials?.tenantId || null,
      directCredentialSource: credentials?.source || null,
      directProfileId: credentials?.profileId || null,
      directProfileName: credentials?.profileDisplayName || null,
      directProfileMissing: !credentials,
    };
  }

  return ok({
    status: connection?.status || 'not_connected',
    connectionType: connection?.connection_type || null,
    lastDiscoveryAt: summary.lastDiscoveryAt,
    mappedTenantCount: summary.mappedTenantCount,
    pendingCreateTenantCount: summary.pendingCreateTenantCount,
    nextSyncIntervalMinutes: summary.nextSyncIntervalMinutes,
    hasCompletedFirstSync: summary.hasCompletedFirstSync,
    availableConnectionTypes: ['direct', 'cipp'],
    lastValidatedAt: connection?.last_validated_at || null,
    lastValidationError:
      connection && connection.last_validation_error && Object.keys(connection.last_validation_error).length > 0
        ? connection.last_validation_error
        : null,
    connectionDetails,
  });
}
