import { getAdminConnection } from '@alga-psa/db/admin';
import type { Knex } from 'knex';

export interface ExtensionApiEndpointRow {
  id: string;
  version_id: string;
  method: string;
  path: string;
  handler: string;
}

function normalizeMethod(method: string): string {
  return String(method || '').toUpperCase();
}

function normalizePath(path: string): string {
  const raw = String(path || '').trim();
  if (!raw) return '';
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withSlash.replace(/\/{2,}/g, '/');
}

async function readVersionEndpoints(db: Knex, versionId: string): Promise<Array<{ method: string; path: string; handler: string }>> {
  const row = await db('extension_version')
    .where({ id: versionId })
    .first(['api_endpoints']);
  if (!row) return [];
  const raw = (row as any).api_endpoints;
  let endpoints: any[] = [];
  try {
    endpoints = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
  } catch {
    endpoints = [];
  }
  return endpoints
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({
      method: normalizeMethod((e as any).method),
      path: normalizePath((e as any).path),
      handler: String((e as any).handler || ''),
    }))
    .filter((e) => e.method && e.path && e.handler);
}

async function materializeEndpoints(db: Knex, versionId: string): Promise<void> {
  // Citus requires IMMUTABLE expressions in ON CONFLICT DO UPDATE;
  // use a precomputed literal timestamp instead of db.fn.now().
  const now = new Date();
  const endpoints = await readVersionEndpoints(db, versionId);
  if (endpoints.length === 0) return;

  // De-dupe within this version by (method,path) to avoid Postgres error:
  // "ON CONFLICT DO UPDATE command cannot affect row a second time".
  // Last entry wins (consistent with later manifest entries overriding earlier ones).
  const deduped = new Map<string, { method: string; path: string; handler: string }>();
  for (const endpoint of endpoints) {
    deduped.set(`${endpoint.method} ${endpoint.path}`, endpoint);
  }

  await db('extension_api_endpoint')
    .insert(
      Array.from(deduped.values()).map((e) => ({
        version_id: versionId,
        method: e.method,
        path: e.path,
        handler: e.handler,
        updated_at: now,
      }))
    )
    .onConflict(['version_id', 'method', 'path'])
    .merge({ handler: db.raw('excluded.handler'), updated_at: db.raw('excluded.updated_at') });
}

export async function listEndpointsForVersion(versionId: string): Promise<ExtensionApiEndpointRow[]> {
  const db = await getAdminConnection();
  return db('extension_api_endpoint')
    .where({ version_id: versionId })
    .orderBy([{ column: 'method', order: 'asc' }, { column: 'path', order: 'asc' }])
    .select(['id', 'version_id', 'method', 'path', 'handler']);
}

/**
 * Best-effort endpoint materialization used for older versions created before endpoint table existed.
 */
export async function listOrMaterializeEndpointsForVersion(versionId: string): Promise<ExtensionApiEndpointRow[]> {
  const db = await getAdminConnection();
  try {
    const existing = await listEndpointsForVersion(versionId);
    if (existing.length > 0) return existing;
    await materializeEndpoints(db, versionId);
    return await listEndpointsForVersion(versionId);
  } catch (error: any) {
    // If the table doesn't exist yet (migration not applied), return empty and let callers degrade gracefully.
    const msg = error?.message ?? String(error);
    if (msg.toLowerCase().includes('extension_api_endpoint') && msg.toLowerCase().includes('does not exist')) {
      return [];
    }
    throw error;
  }
}

export async function findEndpointIdByMethodPath(params: {
  versionId: string;
  method: string;
  path: string;
}): Promise<string | null> {
  const db = await getAdminConnection();
  const method = normalizeMethod(params.method);
  const path = normalizePath(params.path);
  const row = await db('extension_api_endpoint')
    .where({ version_id: params.versionId, method, path })
    .first(['id']);
  return row?.id ?? null;
}
