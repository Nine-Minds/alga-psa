'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { isFeatureFlagEnabled } from '@alga-psa/core';
import { createTenantKnex } from '@alga-psa/db';

function isClientPortalUser(user: unknown): boolean {
  return (user as { user_type?: string } | undefined)?.user_type === 'client';
}

/**
 * Start an Entra sync for a single client.
 *
 * This is a thin action that lives in @alga-psa/clients so that
 * ClientDetails.tsx can trigger a sync without importing from
 * @alga-psa/integrations (which would create a circular dependency).
 */
export const startClientEntraSync = withAuth(async (
  user,
  { tenant },
  input: { clientId: string }
) => {
  if (isClientPortalUser(user)) {
    return { success: false, error: 'Forbidden' } as const;
  }

  const canUpdate = await hasPermission(user as any, 'system_settings', 'update');
  if (!canUpdate) {
    return { success: false, error: 'Forbidden: insufficient permissions to configure Entra integration' } as const;
  }

  const enabled = await isFeatureFlagEnabled('entra-integration-ui', {
    tenantId: tenant,
    userId: (user as { user_id?: string } | undefined)?.user_id,
  });
  if (!enabled) {
    return { success: false, error: 'Microsoft Entra integration is disabled for this tenant.' } as const;
  }

  const clientId = String(input.clientId || '').trim();
  if (!clientId) {
    return { success: false, error: 'clientId is required for single-client sync.' } as const;
  }

  const { knex } = await createTenantKnex();
  const mapping = await knex('entra_client_tenant_mappings as m')
    .join('entra_managed_tenants as t', function joinManagedTenants() {
      this.on('m.tenant', '=', 't.tenant').andOn('m.managed_tenant_id', '=', 't.managed_tenant_id');
    })
    .where({
      'm.tenant': tenant,
      'm.client_id': clientId,
      'm.is_active': true,
      'm.mapping_state': 'mapped',
    })
    .first(['m.managed_tenant_id']);

  if (!mapping?.managed_tenant_id) {
    return { success: false, error: 'No active Entra mapping exists for this client.' } as const;
  }

  const isEnterpriseEdition =
    (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
    (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

  if (!isEnterpriseEdition) {
    return { success: false, error: 'Microsoft Entra integration is only available in Enterprise Edition.' } as const;
  }

  const workflowClient = await import('@enterprise/lib/integrations/entra/entraWorkflowClient');
  const workflowStart = await workflowClient.startEntraTenantSyncWorkflow({
    tenantId: tenant,
    managedTenantId: String(mapping.managed_tenant_id),
    clientId,
    actor: { userId: (user as { user_id?: string } | undefined)?.user_id },
  });

  return {
    success: true,
    data: {
      accepted: workflowStart.available,
      scope: 'single-client' as const,
      runId: workflowStart.runId || null,
      workflowId: workflowStart.workflowId || null,
      error: workflowStart.error || null,
    },
  } as const;
});
