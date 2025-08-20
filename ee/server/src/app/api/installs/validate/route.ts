import { NextResponse } from 'next/server';
import type { Knex } from 'knex';
import { getAdminConnection } from '@alga-psa/shared/db/admin.js';

export const dynamic = 'force-dynamic';

function normalizeHash(h?: string | null): string | null {
  if (!h) return null;
  const v = h.trim();
  if (!v) return null;
  if (v.startsWith('sha256:')) return v;
  if (/^[0-9a-f]{64}$/i.test(v)) return `sha256:${v.toLowerCase()}`;
  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tenant = searchParams.get('tenant');
  const extension = searchParams.get('extension'); // registry_id
  const hash = normalizeHash(searchParams.get('hash'));

  if (!tenant || !extension || !hash) {
    return NextResponse.json({ valid: false, error: 'missing or invalid parameters' }, { status: 400 });
  }

  let db: Knex | null = null;
  try {
    db = await getAdminConnection();
    const install = await db('tenant_extension_install')
      .where({ tenant_id: tenant, registry_id: extension })
      .first(['version_id']);
    if (!install) return NextResponse.json({ valid: false });

    const bundle = await db('extension_bundle')
      .where({ version_id: install.version_id, content_hash: hash })
      .first(['id']);
    return NextResponse.json({ valid: !!bundle });
  } catch (e) {
    console.error('[installs/validate] error', e);
    return NextResponse.json({ valid: false }, { status: 500 });
  } finally {
    // admin connection is pooled/shared; do not destroy here
  }
}
