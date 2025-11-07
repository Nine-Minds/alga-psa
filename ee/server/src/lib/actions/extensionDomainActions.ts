'use server'

import { createTenantKnex } from '@/lib/db';
import { getAdminConnection } from '@alga-psa/shared/db/admin';
import type { Knex } from 'knex';
import { computeDomain, enqueueProvisioningWorkflow } from '@ee/lib/extensions/runtime/provision';

export interface InstallInfo {
  install_id: string;
  runner_domain: string | null;
  runner_status: any;
  tenant_id: string;
  content_hash?: string | null;
  version_id?: string | null;
}

// Accepts only registryId (v2). Classic extension id is not supported.
export async function getInstallInfo(registryId: string): Promise<InstallInfo | null> {
  const { tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');
  const adminDb: Knex = await getAdminConnection();
  const reg = await adminDb('extension_registry').where({ id: registryId }).first(['id']);
  if (!reg) return null;

  // Join with extension_bundle to get content_hash for Docker backend
  const result = await adminDb('tenant_extension_install as ti')
    .leftJoin('extension_bundle as eb', 'eb.version_id', 'ti.version_id')
    .where({ 'ti.tenant_id': tenant, 'ti.registry_id': registryId })
    .orderBy('eb.created_at', 'desc')
    .first([
      'ti.id as install_id',
      'ti.runner_domain',
      'ti.runner_status',
      'ti.version_id',
      'eb.content_hash'
    ]);

  if (!result) return null;
  return {
    install_id: (result as any).install_id,
    runner_domain: (result as any).runner_domain || null,
    runner_status: (result as any).runner_status || { state: 'pending' },
    tenant_id: tenant,
    content_hash: (result as any).content_hash || null,
    version_id: (result as any).version_id || null,
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
