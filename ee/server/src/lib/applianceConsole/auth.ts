/**
 * Master-tenant authorization gate for the Appliance Console API.
 *
 * Mirrors the platform-reports gate: the caller MUST belong to
 * MASTER_BILLING_TENANT_ID, via either API-key auth (extension uiProxy) or
 * session auth (direct browser). Operator identity is forwarded by the runner as
 * x-user-id / x-user-email for auditing.
 */

import { NextRequest } from 'next/server';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';

const MASTER_BILLING_TENANT_ID = process.env.MASTER_BILLING_TENANT_ID;

export interface MasterTenantCaller {
  tenantId: string;
  userId?: string;
  userEmail?: string;
}

export async function assertMasterTenantAccess(request: NextRequest): Promise<MasterTenantCaller> {
  if (!MASTER_BILLING_TENANT_ID) {
    throw new Error('MASTER_BILLING_TENANT_ID not configured on server');
  }

  const extensionId = request.headers.get('x-alga-extension');

  // API KEY AUTH (extension uiProxy → ext-proxy → here)
  const apiKey = request.headers.get('x-api-key');
  if (apiKey) {
    const keyRecord = await ApiKeyServiceForApi.validateApiKeyAnyTenant(apiKey);
    if (keyRecord) {
      if (keyRecord.tenant === MASTER_BILLING_TENANT_ID) {
        const headerUserId = request.headers.get('x-user-id');
        const headerUserEmail = request.headers.get('x-user-email');
        return {
          tenantId: MASTER_BILLING_TENANT_ID,
          userId: headerUserId || (extensionId ? `extension:${extensionId}` : keyRecord.user_id),
          userEmail: headerUserEmail || undefined,
        };
      }
      throw new Error('Access denied: API key not authorized for the appliance console');
    }
    console.warn('[appliance-installs] Invalid API key');
  }

  // SESSION AUTH (direct browser)
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Authentication required');
  }
  if (user.tenant !== MASTER_BILLING_TENANT_ID) {
    throw new Error('Access denied: appliance console requires master tenant access');
  }

  return { tenantId: MASTER_BILLING_TENANT_ID, userId: user.user_id, userEmail: user.email };
}

/** True for auth/authorization failures from assertMasterTenantAccess → map to 403. */
export function isAuthError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes('Access denied') || error.message.includes('Authentication'))
  );
}
