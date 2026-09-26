/**
 * Master-tenant authorization gate for every platform-operator API surface
 * (tenant-management, platform-reports, platform-notifications,
 * platform-feature-flags, appliance-installs).
 *
 * Two credential types are accepted:
 *
 * - An API key (`x-api-key`) that validates and belongs to MASTER_BILLING_TENANT_ID.
 *   This is how the control-panel extensions reach these routes via uiProxy; the
 *   runner forwards the acting operator as `x-user-id` / `x-user-email` for audit only.
 * - A browser session for an internal user of the master billing tenant who holds
 *   TENANT_MANAGEMENT_PERMISSION. Membership of the master tenant alone is not enough.
 *
 * Request headers are never trusted as an identity on their own, and an invalid
 * API key is rejected rather than falling back to the session (GHSA-v72r-pvf8-6cq2).
 */

import type { NextRequest } from 'next/server';
import { hasPermission } from '@alga-psa/auth';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';

export interface MasterTenantCaller {
  tenantId: string;
  userId: string;
  userEmail?: string;
}

export const TENANT_MANAGEMENT_PERMISSION = { resource: 'system_settings', action: 'update' } as const;

export const MASTER_TENANT_ERRORS = {
  notConfigured: 'MASTER_BILLING_TENANT_ID not configured',
  invalidApiKey: 'Access denied: invalid API key',
  unauthenticated: 'Authentication required',
  wrongTenant: 'Access denied: master tenant required',
  missingPermission: 'Access denied: tenant management permission required',
} as const;

export async function assertMasterTenantAccess(request: NextRequest): Promise<MasterTenantCaller> {
  const masterTenantId = process.env.MASTER_BILLING_TENANT_ID;
  if (!masterTenantId) {
    throw new Error(MASTER_TENANT_ERRORS.notConfigured);
  }

  const apiKey = request.headers.get('x-api-key');
  if (apiKey) {
    const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
    if (!keyRecord) {
      throw new Error(MASTER_TENANT_ERRORS.invalidApiKey);
    }
    if (keyRecord.tenant !== masterTenantId) {
      throw new Error(MASTER_TENANT_ERRORS.wrongTenant);
    }

    const extensionId = request.headers.get('x-alga-extension');
    return {
      tenantId: masterTenantId,
      userId: request.headers.get('x-user-id') || (extensionId ? `extension:${extensionId}` : keyRecord.user_id),
      userEmail: request.headers.get('x-user-email') || undefined,
    };
  }

  const user = await getCurrentUser();
  if (!user) {
    throw new Error(MASTER_TENANT_ERRORS.unauthenticated);
  }
  if (user.tenant !== masterTenantId || user.user_type !== 'internal') {
    throw new Error(MASTER_TENANT_ERRORS.wrongTenant);
  }
  const permitted = await hasPermission(user, TENANT_MANAGEMENT_PERMISSION.resource, TENANT_MANAGEMENT_PERMISSION.action);
  if (!permitted) {
    throw new Error(MASTER_TENANT_ERRORS.missingPermission);
  }

  return { tenantId: masterTenantId, userId: user.user_id, userEmail: user.email };
}

/** True for auth/authorization failures from assertMasterTenantAccess → map to 401/403. */
export function isMasterTenantAuthError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.startsWith('Access denied') || error.message === MASTER_TENANT_ERRORS.unauthenticated)
  );
}
