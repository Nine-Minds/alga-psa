import { NextRequest } from 'next/server';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { getUserRoles } from '@alga-psa/auth/actions';
import { createTenantKnex } from '@alga-psa/db';
import User from '@alga-psa/db/models/user';
import type { IRole } from '@alga-psa/types';

function rolesIncludeAdmin(roles: IRole[]): boolean {
  return roles.some((r) => (r.role_name ?? '').toLowerCase() === 'admin');
}

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
    if (!record || !record.user_id) {
      return null;
    }
    // Enforce the same Admin requirement as the session path. Previously ANY
    // valid API key was accepted here, letting a non-admin key holder call the
    // MCP provisioning endpoints (create agents / register IdP providers) and
    // self-escalate by minting an internal user bound to the Admin role.
    const { knex } = await createTenantKnex(record.tenant);
    const roles = await User.getUserRoles(knex, record.user_id, record.tenant);
    return rolesIncludeAdmin(roles) ? { tenant: record.tenant, userId: record.user_id } : null;
  }

  // 2. Session (admin UI) — internal Admin users only.
  try {
    const user = await getCurrentUser();
    if (user && user.user_type === 'internal' && user.tenant) {
      const roles: IRole[] = await getUserRoles(user.user_id);
      if (rolesIncludeAdmin(roles)) return { tenant: user.tenant, userId: user.user_id };
    }
  } catch {
    // not authenticated
  }
  return null;
}
