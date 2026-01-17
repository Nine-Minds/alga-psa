import { NextResponse } from 'next/server';
import { createTenantKnex } from '@/lib/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import type { Knex } from 'knex';
import { requireExtensionApiAccess } from '../_auth';
// Classic extension lookups removed; this endpoint expects registryId

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireExtensionApiAccess('read');
  if (auth) return auth;
  const { searchParams } = new URL(request.url);
  const registryId = searchParams.get('registryId');
  if (!registryId) {
    return NextResponse.json({ error: 'missing registryId' }, { status: 400 });
  }

  let trxKnex: Knex | null = null;
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) return NextResponse.json({ error: 'tenant not found' }, { status: 400 });
    trxKnex = knex;
    const adminDb: Knex = await getAdminConnection();
    const reg = await adminDb('extension_registry').where({ id: registryId }).first(['id']);
    if (!reg) return NextResponse.json({ error: 'registry not found' }, { status: 404 });

    const install = await adminDb('tenant_extension_install')
      .where({ tenant_id: tenant, registry_id: registryId })
      .first(['id', 'runner_domain', 'runner_status']);
    if (!install) return NextResponse.json({ error: 'install not found' }, { status: 404 });

    return NextResponse.json({
      install_id: install.id,
      runner_domain: install.runner_domain || null,
      runner_status: install.runner_status || { state: 'pending' },
    });
  } catch (e) {
    console.error('[extensions/install-info] error', e);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
