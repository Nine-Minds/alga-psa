import { dynamic, ok, runtime } from './_responses';
import { requireEntraUiFlagEnabled } from './_guards';
import { createTenantKnex, runWithTenant } from '@enterprise/lib/db';
import { getActiveEntraPartnerConnection } from '@enterprise/lib/integrations/entra/connectionRepository';
import { getEntraCippCredentials } from '@enterprise/lib/integrations/entra/providers/cipp/cippSecretStore';
import { resolveMicrosoftCredentialsForTenant } from '@enterprise/lib/integrations/entra/auth/microsoftCredentialResolver';

export { dynamic, runtime };

export async function GET(): Promise<Response> {
  const flagGate = await requireEntraUiFlagEnabled('read');
  if (flagGate instanceof Response) {
    return flagGate;
  }

  const connection = await getActiveEntraPartnerConnection(flagGate.tenantId);

  const summary = await runWithTenant(flagGate.tenantId, async () => {
    const { knex } = await createTenantKnex();

    const [mappingCountRow, lastDiscoveryRow, syncSettingsRow] = await Promise.all([
      knex('entra_client_tenant_mappings')
        .where({ tenant: flagGate.tenantId, is_active: true, mapping_state: 'mapped' })
        .count<{ count: string }>('* as count')
        .first(),
      knex('entra_managed_tenants')
        .where({ tenant: flagGate.tenantId })
        .max<{ last_discovered_at: string | null }>('discovered_at as last_discovered_at')
        .first(),
      knex('entra_sync_settings')
        .where({ tenant: flagGate.tenantId })
        .first(['sync_interval_minutes']),
    ]);

    return {
      mappedTenantCount: Number(mappingCountRow?.count || 0),
      lastDiscoveryAt: lastDiscoveryRow?.last_discovered_at || null,
      nextSyncIntervalMinutes: Number(syncSettingsRow?.sync_interval_minutes || 0) || null,
    };
  });

  let connectionDetails: {
    cippBaseUrl: string | null;
    directTenantId: string | null;
    directCredentialSource: 'tenant-secret' | 'env' | 'app-secret' | null;
  } | null = null;

  if (connection?.connection_type === 'cipp') {
    const credentials = await getEntraCippCredentials(flagGate.tenantId).catch(() => null);
    connectionDetails = {
      cippBaseUrl: credentials?.baseUrl || null,
      directTenantId: null,
      directCredentialSource: null,
    };
  } else if (connection?.connection_type === 'direct') {
    const credentials = await resolveMicrosoftCredentialsForTenant(flagGate.tenantId).catch(() => null);
    connectionDetails = {
      cippBaseUrl: null,
      directTenantId: credentials?.tenantId || null,
      directCredentialSource: credentials?.source || null,
    };
  }

  return ok({
    status: connection?.status || 'not_connected',
    connectionType: connection?.connection_type || null,
    lastDiscoveryAt: summary.lastDiscoveryAt,
    mappedTenantCount: summary.mappedTenantCount,
    nextSyncIntervalMinutes: summary.nextSyncIntervalMinutes,
    availableConnectionTypes: ['direct', 'cipp'],
    lastValidatedAt: connection?.last_validated_at || null,
    lastValidationError:
      connection && connection.last_validation_error && Object.keys(connection.last_validation_error).length > 0
        ? connection.last_validation_error
        : null,
    connectionDetails,
  });
}
