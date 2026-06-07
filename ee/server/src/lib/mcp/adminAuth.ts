import { NextRequest } from 'next/server';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { getUserRoles } from '@alga-psa/auth/actions';
import type { IRole } from '@alga-psa/types';

export interface McpAdminContext {
  tenant: string;
  userId: string | null;
}

/**
 * Authenticate an MCP admin/provisioning request. Two callers:
 *  - the admin **UI** (session cookie) — internal users with the Admin role;
 *  - the programmatic **admin API** (x-api-key / Bearer).
 * Returns the tenant + user, or null.
 */
export async function authenticateMcpAdmin(req: NextRequest): Promise<McpAdminContext | null> {
  // 1. API key (programmatic). A provided-but-invalid key is a hard reject.
  const header = req.headers.get('authorization');
  const bearer = header && /^Bearer\s+(.+)$/i.test(header) ? header.replace(/^Bearer\s+/i, '') : null;
  const key = req.headers.get('x-api-key') ?? bearer;
  if (key) {
    const record = await ApiKeyServiceForApi.validateApiKeyAnyTenant(key);
    return record ? { tenant: record.tenant, userId: record.user_id ?? null } : null;
  }

  // 2. Session (admin UI) — internal Admin users only.
  try {
    const user = await getCurrentUser();
    if (user && user.user_type === 'internal' && user.tenant) {
      const roles: IRole[] = await getUserRoles(user.user_id);
      const isAdmin = roles.some((r) => (r.role_name ?? '').toLowerCase() === 'admin');
      if (isAdmin) return { tenant: user.tenant, userId: user.user_id };
    }
  } catch {
    // not authenticated
  }
  return null;
}
