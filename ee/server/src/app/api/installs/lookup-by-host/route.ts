import { NextResponse } from 'next/server';
import type { Knex } from 'knex';
import { getAdminConnection } from '@alga-psa/shared/db/admin.js';

export const dynamic = 'force-dynamic';

function normalizeHost(h?: string | null): string | null {
  if (!h) return null;
  // Strip port if present
  const host = h.split(':')[0].trim().toLowerCase();
  return host || null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const host = normalizeHost(searchParams.get('host'));
  if (!host) {
    return NextResponse.json({ error: 'missing host' }, { status: 400 });
  }

  let db: Knex | null = null;
  try {
    db = await getAdminConnection();

    // Find install by runner_domain
    const install = await db('tenant_extension_install')
      .where('runner_domain', host)
      .first(['tenant_id', 'registry_id as extension_id', 'version_id']);

    if (!install) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }

    // Resolve latest bundle content_hash for the installed version
    const bundle = await db('extension_bundle')
      .where('version_id', install.version_id)
      .orderBy('created_at', 'desc')
      .first(['content_hash']);

    if (!bundle) {
      return NextResponse.json({ error: 'bundle not found' }, { status: 404 });
    }

    return NextResponse.json({
      tenant_id: install.tenant_id,
      extension_id: install.extension_id,
      content_hash: bundle.content_hash,
    });
  } catch (e: any) {
    console.error('[lookup-by-host] error', e);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  } finally {
    // admin connection is pooled/shared; do not destroy here
  }
}
