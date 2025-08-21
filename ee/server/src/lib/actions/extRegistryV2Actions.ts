"use server";

import { createTenantKnex } from '@/lib/db';
import type { Knex } from 'knex';

export type V2ExtensionListItem = {
  id: string; // registry_id
  name: string;
  version: string;
  author?: string;
  is_enabled: boolean;
  tenant_id: string;
  description?: string | null;
};

export async function fetchInstalledExtensionsV2(): Promise<V2ExtensionListItem[]> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');

  const rows = await knex('tenant_extension_install as ti')
    .join('extension_registry as er', 'er.id', 'ti.registry_id')
    .join('extension_version as ev', 'ev.id', 'ti.version_id')
    .where('ti.tenant_id', tenant)
    .select({
      id: 'er.id',
      name: 'er.name',
      author: 'er.publisher',
      version: 'ev.version',
      is_enabled: 'ti.is_enabled',
      tenant_id: 'ti.tenant_id',
    })
    .orderBy([{ column: 'er.publisher', order: 'asc' }, { column: 'er.name', order: 'asc' }]);

  return rows as V2ExtensionListItem[];
}

export async function toggleExtensionV2(registryId: string): Promise<{ success: boolean; message: string; is_enabled?: boolean }>{
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');

  return await knex.transaction(async (trx: Knex.Transaction) => {
    const row = await trx('tenant_extension_install')
      .where({ tenant_id: tenant, registry_id: registryId })
      .first(['is_enabled']);
    if (!row) return { success: false, message: 'Install not found' };
    const next = !row.is_enabled;
    await trx('tenant_extension_install')
      .where({ tenant_id: tenant, registry_id: registryId })
      .update({ is_enabled: next, updated_at: trx.fn.now() });
    return { success: true, message: next ? 'Enabled' : 'Disabled', is_enabled: next };
  });
}

export async function uninstallExtensionV2(registryId: string): Promise<{ success: boolean; message: string }>{
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');

  await knex('tenant_extension_install').where({ tenant_id: tenant, registry_id: registryId }).del();
  return { success: true, message: 'Uninstalled' };
}

export async function installExtensionForCurrentTenantV2(params: { registryId: string; version: string }): Promise<{ success: boolean }>{
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');

  // Upsert install row
  const ev = await knex('extension_version')
    .where({ registry_id: params.registryId, version: params.version })
    .first(['id']);
  if (!ev) throw new Error('Version not found');

  const payload = {
    tenant_id: tenant,
    registry_id: params.registryId,
    version_id: ev.id,
    status: 'enabled',
    granted_caps: JSON.stringify([]),
    config: JSON.stringify({}),
    is_enabled: true,
    updated_at: knex.fn.now(),
  };

  await knex('tenant_extension_install')
    .insert({ ...payload, created_at: knex.fn.now() })
    .onConflict(['tenant_id', 'registry_id'])
    .merge(payload);

  return { success: true };
}

