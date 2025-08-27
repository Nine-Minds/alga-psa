'use server'

import { createTenantKnex } from '@/lib/db';
import { getAdminConnection } from '@alga-psa/shared/db/admin.js';
import type { Knex } from 'knex';
import { ExtensionRegistry } from '../../lib/extensions/registry';
import { computeDomain, enqueueProvisioningWorkflow } from '../../lib/extensions/runtime/provision';

export interface InstallInfo {
  install_id: string;
  runner_domain: string | null;
  runner_status: any;
}

// Accepts only registryId (v2). Classic extension id is not supported.
export async function getInstallInfo(registryId: string): Promise<InstallInfo | null> {
  const { tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');
  const adminDb: Knex = await getAdminConnection();
  const reg = await adminDb('extension_registry').where({ id: registryId }).first(['id']);
  if (!reg) return null;
  const install = await adminDb('tenant_extension_install')
    .where({ tenant_id: tenant, registry_id: registryId })
    .first(['id', 'runner_domain', 'runner_status']);
  if (!install) return null;
  return {
    install_id: (install as any).id,
    runner_domain: (install as any).runner_domain || null,
    runner_status: (install as any).runner_status || { state: 'pending' },
  };
}

// Accepts only registryId (v2). Classic extension id is not supported.
export async function reprovisionExtension(registryId: string): Promise<{ domain: string }> {
  const { tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');
  const adminDb: Knex = await getAdminConnection();
  const reg = await adminDb('extension_registry').where({ id: registryId }).first(['id']);
  if (!reg) throw new Error('Registry not found');
  const install = await adminDb('tenant_extension_install')
    .where({ tenant_id: tenant, registry_id: registryId })
    .first(['id', 'runner_domain']);
  if (!install) throw new Error('Install not found');
  const domain = computeDomain(tenant, registryId);
  await adminDb('tenant_extension_install')
    .where({ id: install.id })
    .update({
      runner_domain: domain,
      runner_status: JSON.stringify({ state: 'provisioning', message: 'Enqueued domain provisioning' }),
      updated_at: adminDb.fn.now(),
    });
  await enqueueProvisioningWorkflow({ tenantId: tenant, extensionId: registryId, installId: install.id }).catch(() => {});
  return { domain };
}
