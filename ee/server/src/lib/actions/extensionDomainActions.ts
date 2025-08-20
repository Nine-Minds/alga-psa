'use server'

import { createTenantKnex } from '@/lib/db';
import type { Knex } from 'knex';
import { ExtensionRegistry } from '../../lib/extensions/registry';
import { computeDomain, enqueueProvisioningWorkflow } from '../../lib/extensions/runtime/provision';

export interface InstallInfo {
  install_id: string;
  runner_domain: string | null;
  runner_status: any;
}

export async function getInstallInfo(extensionId: string): Promise<InstallInfo | null> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');

  const registry = new ExtensionRegistry(knex);
  const ext = await registry.getExtension(extensionId, { tenant_id: tenant });
  if (!ext) return null;

  const name = ext.manifest?.name || ext.name;
  const publisher = (ext.manifest as any)?.publisher as string | undefined;

  const reg = await knex('extension_registry')
    .modify((qb: Knex.QueryBuilder) => {
      qb.where({ name });
      if (publisher) qb.andWhere({ publisher });
    })
    .first(['id']);
  if (!reg) return null;

  const install = await knex('tenant_extension_install')
    .where({ tenant_id: tenant, registry_id: reg.id })
    .first(['id', 'runner_domain', 'runner_status']);
  if (!install) return null;

  return {
    install_id: install.id,
    runner_domain: (install as any).runner_domain || null,
    runner_status: (install as any).runner_status || { state: 'pending' },
  };
}

export async function reprovisionExtension(extensionId: string): Promise<{ domain: string }> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');

  const registry = new ExtensionRegistry(knex);
  const ext = await registry.getExtension(extensionId, { tenant_id: tenant });
  if (!ext) throw new Error('Extension not found');

  const name = ext.manifest?.name || ext.name;
  const publisher = (ext.manifest as any)?.publisher as string | undefined;

  const reg = await knex('extension_registry')
    .modify((qb: Knex.QueryBuilder) => {
      qb.where({ name });
      if (publisher) qb.andWhere({ publisher });
    })
    .first(['id']);
  if (!reg) throw new Error('Registry not found');

  const install = await knex('tenant_extension_install')
    .where({ tenant_id: tenant, registry_id: reg.id })
    .first(['id', 'runner_domain']);
  if (!install) throw new Error('Install not found');

  const domain = computeDomain(tenant, reg.id);

  await knex('tenant_extension_install')
    .where({ id: install.id })
    .update({
      runner_domain: domain,
      runner_status: JSON.stringify({ state: 'provisioning', message: 'Enqueued domain provisioning' }),
      updated_at: knex.fn.now(),
    });

  await enqueueProvisioningWorkflow({ tenantId: tenant, extensionId: reg.id, installId: install.id }).catch(() => {});

  return { domain };
}

