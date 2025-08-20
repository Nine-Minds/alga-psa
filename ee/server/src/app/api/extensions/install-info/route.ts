import { NextResponse } from 'next/server';
import { createTenantKnex } from '@/lib/db';
import type { Knex } from 'knex';
import { ExtensionRegistry } from '../../../lib/extensions/registry';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const extensionId = searchParams.get('extensionId');
  if (!extensionId) {
    return NextResponse.json({ error: 'missing extensionId' }, { status: 400 });
  }

  let trxKnex: Knex | null = null;
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) return NextResponse.json({ error: 'tenant not found' }, { status: 400 });
    trxKnex = knex;
    const registry = new ExtensionRegistry(trxKnex);
    const ext = await registry.getExtension(extensionId, { tenant_id: tenant });
    if (!ext) return NextResponse.json({ error: 'extension not found' }, { status: 404 });

    const name = ext.manifest?.name || ext.name;
    const publisher = (ext.manifest as any)?.publisher as string | undefined;

    const reg = await trxKnex('extension_registry')
      .modify((qb) => {
        qb.where({ name });
        if (publisher) qb.andWhere({ publisher });
      })
      .first(['id']);
    if (!reg) return NextResponse.json({ error: 'registry not found' }, { status: 404 });

    const install = await trxKnex('tenant_extension_install')
      .where({ tenant_id: tenant, registry_id: reg.id })
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

