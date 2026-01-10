/**
 * Registry DB Check (EE admin-only)
 * - Introspects the database to report existence and shape of registry v2 tables.
 * - Tables: extension_registry, extension_version, extension_bundle, tenant_extension_install
 * - Returns presence of key columns and expected indexes.
 */
import { NextResponse } from 'next/server';
import type { Knex } from 'knex';
import { createTenantKnex } from '@/lib/db';
import { requireExtensionApiAccess } from '../_auth';

function isAdmin(req: Request) {
  const v = req.headers.get('x-alga-admin');
  return typeof v === 'string' && v.toLowerCase() === 'true';
}

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = await requireExtensionApiAccess('read');
  if (auth) return auth;
  if (!isAdmin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let db: Knex | null = null;
  try {
    const { knex } = await createTenantKnex();
    db = knex;

    async function tableInfo(name: string, columns: string[], indexNames: string[] = []) {
      const exists = await db!.schema.hasTable(name);
      if (!exists) return { exists: false };
      const cols: Record<string, boolean> = {};
      for (const c of columns) {
        cols[c] = await db!.schema.hasColumn(name, c);
      }
      // indexes
      let indexes: Record<string, boolean> = {};
      try {
        const res = await db!.raw(
          `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ?`,
          [name]
        );
        const present = new Set<string>((res?.rows ?? []).map((r: any) => String(r.indexname)));
        indexes = Object.fromEntries(indexNames.map((n) => [n, present.has(n)]));
      } catch {
        indexes = Object.fromEntries(indexNames.map((n) => [n, false]));
      }
      return { exists: true, columns: cols, indexes };
    }

    const report = {
      extension_registry: await tableInfo('extension_registry', [
        'id', 'publisher', 'name', 'display_name', 'description', 'created_at', 'updated_at'
      ], ['extension_registry_publisher_name_idx']),
      extension_version: await tableInfo('extension_version', [
        'id', 'registry_id', 'version', 'runtime', 'main_entry', 'api_endpoints', 'ui', 'capabilities', 'created_at'
      ], ['extension_version_registry_version_idx']),
      extension_bundle: await tableInfo('extension_bundle', [
        'id', 'version_id', 'content_hash', 'signature', 'precompiled', 'storage_url', 'size_bytes', 'created_at'
      ], ['extension_bundle_content_hash_idx']),
      tenant_extension_install: await tableInfo('tenant_extension_install', [
        'id', 'tenant_id', 'registry_id', 'version_id', 'status', 'granted_caps', 'config', 'is_enabled', 'runner_domain', 'runner_status', 'runner_ref', 'created_at', 'updated_at'
      ], ['tenant_extension_install_tenant_registry_idx', 'tenant_extension_install_runner_domain_idx'])
    };

    return NextResponse.json({ ok: true, report });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'unexpected error' }, { status: 500 });
  }
}
