import { NextResponse } from 'next/server';
import { createTenantKnex } from '@/lib/db';
import type { Knex } from 'knex';
import { ExtensionRegistry } from '../../../lib/extensions/registry';
import { computeDomain, enqueueProvisioningWorkflow } from '../../../lib/extensions/runtime/provision';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let trxKnex: Knex | null = null;
  try {
    const body = await request.json().catch(() => ({}));
    const extensionId: string | undefined = body?.extensionId;
    if (!extensionId) return NextResponse.json({ error: 'missing extensionId' }, { status: 400 });

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

    // Find install entry
    const install = await trxKnex('tenant_extension_install')
      .where({ tenant_id: tenant, registry_id: reg.id })
      .first(['id', 'runner_domain']);

    // Compute domain and update
    const domain = computeDomain(tenant, reg.id);
    if (!install) {
      // If install missing, create a minimal row (requires version_id in schema; skip create to avoid violating constraints)
      // Instead, return error indicating missing install
      return NextResponse.json({ error: 'install not found' }, { status: 404 });
    }

    await trxKnex('tenant_extension_install')
      .where({ id: install.id })
      .update({
        runner_domain: domain,
        runner_status: JSON.stringify({ state: 'provisioning', message: 'Enqueued domain provisioning' }),
        updated_at: trxKnex.fn.now(),
      });

    // Kick off Temporal workflow (best-effort)
    await enqueueProvisioningWorkflow({ tenantId: tenant, extensionId: reg.id, installId: install.id }).catch((e) => {
      console.warn('[reprovision] enqueueProvisioningWorkflow failed (will rely on status polling)', e);
    });

    return NextResponse.json({ domain });
  } catch (e) {
    console.error('[extensions/reprovision] error', e);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}

