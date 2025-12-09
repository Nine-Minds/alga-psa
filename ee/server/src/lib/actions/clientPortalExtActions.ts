"use server";

import { createTenantKnex } from '@/lib/db';

export type ClientPortalMenuItem = {
  id: string;    // registry_id
  label: string; // ui.hooks.clientPortalMenu.label
};

/**
 * Return enabled extension installs for the current tenant that expose a clientPortalMenu hook.
 * Uses Postgres JSON operators to filter on ev.ui.hooks.clientPortalMenu.label.
 */
export async function listClientPortalMenuItemsForTenant(): Promise<ClientPortalMenuItem[]> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');

  // Query: enabled installs where extension_version.ui contains hooks.clientPortalMenu.label (non-empty)
  const rows = await knex('tenant_extension_install as ti')
    .join('extension_version as ev', 'ev.id', 'ti.version_id')
    .join('extension_registry as er', 'er.id', 'ti.registry_id')
    .where('ti.tenant_id', tenant)
    .andWhere('ti.is_enabled', true)
    .whereNotNull('ev.ui')
    .andWhereRaw("(ev.ui::jsonb #> '{hooks,clientPortalMenu,label}') is not null")
    .andWhereRaw("(ev.ui::jsonb #>> '{hooks,clientPortalMenu,label}') <> ''")
    .select({ id: 'er.id' })
    .select(knex.raw("(ev.ui::jsonb #>> '{hooks,clientPortalMenu,label}') as label"));

  // Normalize/validate output types
  return (rows || [])
    .map((r: any) => ({ id: String(r.id), label: String(r.label || '') }))
    .filter((r: any) => r.label.length > 0);
}
