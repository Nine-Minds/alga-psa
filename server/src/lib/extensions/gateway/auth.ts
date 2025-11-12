import { NextRequest } from 'next/server';
import { getSession } from 'server/src/lib/auth/getSession';

export async function getTenantFromAuth(req: NextRequest): Promise<string> {
  // Minimal scaffolding:
  // - Prefer internal header `x-alga-tenant` (e.g., set by edge/auth middleware)
  // - Fallback to DEV_TENANT_ID for local development
  // - Otherwise, reject (to avoid running as a fake tenant)
  const h = req.headers.get('x-alga-tenant');
  if (h && h.trim()) return h.trim();

  // Accept legacy header used by admin/publishing clients.
  const legacy = req.headers.get('x-tenant-id');
  if (legacy && legacy.trim()) return legacy.trim();

  const session = await getSession();
  const sessionTenant = (session?.user as any)?.tenant;
  if (sessionTenant && String(sessionTenant).trim()) {
    return String(sessionTenant).trim();
  }

  const dev = process.env.DEV_TENANT_ID;
  if (dev && dev.trim()) return dev.trim();
  throw new Error('unauthenticated');
}

export async function assertAccess(_tenantId: string, _extensionId: string, _method: string, _path: string): Promise<void> {
  // TODO: implement RBAC and per-tenant endpoint checks
  return;
}
