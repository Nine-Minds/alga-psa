import { NextRequest } from 'next/server';
import { ApiKeyServiceForApi } from '@/lib/services/apiKeyServiceForApi';

export interface McpAdminContext {
  tenant: string;
  userId: string | null;
}

/**
 * Authenticate an MCP admin/provisioning request via an Alga API key
 * (x-api-key or Bearer). Returns the key's tenant + user, or null if invalid.
 * (Phase-2 MVP: a valid key suffices; a dedicated agent-admin permission gate
 * can be layered on later.)
 */
export async function authenticateMcpAdmin(req: NextRequest): Promise<McpAdminContext | null> {
  const header = req.headers.get('authorization');
  const bearer = header && /^Bearer\s+(.+)$/i.test(header) ? header.replace(/^Bearer\s+/i, '') : null;
  const key = req.headers.get('x-api-key') ?? bearer;
  if (!key) return null;
  const record = await ApiKeyServiceForApi.validateApiKeyAnyTenant(key);
  if (!record) return null;
  return { tenant: record.tenant, userId: record.user_id ?? null };
}
