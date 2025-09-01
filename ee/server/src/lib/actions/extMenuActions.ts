"use server";

import { createTenantKnex } from '@/lib/db';

export type AppMenuItem = {
  id: string;    // registry_id
  label: string; // ui.hooks.appMenu.label
};

/**
 * Return enabled extension installs for the current tenant that expose an appMenu hook.
 * Uses Postgres JSON operators to filter on ev.ui.hooks.appMenu.label.
 */
export async function listAppMenuItemsForTenant(): Promise<AppMenuItem[]> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');

  // Query: enabled installs where extension_version.ui contains hooks.appMenu.label (non-empty)
  const rows = await knex('tenant_extension_install as ti')
    .join('extension_version as ev', 'ev.id', 'ti.version_id')
    .join('extension_registry as er', 'er.id', 'ti.registry_id')
    .where('ti.tenant_id', tenant)
    .andWhere('ti.is_enabled', true)
    .whereNotNull('ev.ui')
    .andWhereRaw("(ev.ui::jsonb #> '{hooks,appMenu,label}') is not null")
    .andWhereRaw("(ev.ui::jsonb #>> '{hooks,appMenu,label}') <> ''")
    .select({ id: 'er.id' })
    .select(knex.raw("(ev.ui::jsonb #>> '{hooks,appMenu,label}') as label"));

  // Normalize/validate output types
  return (rows || [])
    .map((r: any) => ({ id: String(r.id), label: String(r.label || '') }))
    .filter((r) => r.label.length > 0);
}

