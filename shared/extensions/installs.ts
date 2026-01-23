import type { Knex } from 'knex';
import { getAdminConnection } from '@alga-psa/db/admin';
import { computeDomain } from './domain';
import type { InstallInfo } from './types';

export async function getInstallInfoForTenant(tenantId: string, registryId: string): Promise<InstallInfo | null> {
  const adminDb: Knex = await getAdminConnection();
  const reg = await adminDb('extension_registry').where({ id: registryId }).first(['id']);
  if (!reg) return null;
  const install = await adminDb('tenant_extension_install')
    .where({ tenant_id: tenantId, registry_id: registryId })
    .first(['id', 'runner_domain', 'runner_status']);
  if (!install) return null;
  return {
    install_id: (install as any).id,
    runner_domain: (install as any).runner_domain || null,
    runner_status: (install as any).runner_status || { state: 'pending' },
  };
}

// Does not enqueue workflows; app should do that separately
export async function reprovisionInstallForTenant(tenantId: string, registryId: string): Promise<{ domain: string }> {
  const adminDb: Knex = await getAdminConnection();
  const reg = await adminDb('extension_registry').where({ id: registryId }).first(['id']);
  if (!reg) throw new Error('Registry not found');
  const install = await adminDb('tenant_extension_install')
    .where({ tenant_id: tenantId, registry_id: registryId })
    .first(['id']);
  if (!install) throw new Error('Install not found');
  const domain = computeDomain(tenantId, registryId);
  await adminDb('tenant_extension_install')
    .where({ id: (install as any).id })
    .update({
      runner_domain: domain,
      runner_status: JSON.stringify({ state: 'provisioning', message: 'Enqueued domain provisioning' }),
      updated_at: adminDb.fn.now(),
    });
  return { domain };
}

