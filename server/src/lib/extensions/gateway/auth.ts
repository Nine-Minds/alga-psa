import { NextRequest } from 'next/server';

export async function getTenantFromAuth(_req: NextRequest): Promise<string> {
  // TODO: derive from session/auth; placeholder for scaffolding
  return 't_dev';
}

export async function assertAccess(_tenantId: string, _extensionId: string, _method: string, _path: string): Promise<void> {
  // TODO: implement RBAC and per-tenant checks
  return;
}

