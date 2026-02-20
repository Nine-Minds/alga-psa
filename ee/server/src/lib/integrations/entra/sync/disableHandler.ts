import { createTenantKnex, runWithTenant } from '@/lib/db';

export interface EntraIdentityRef {
  entraTenantId: string;
  entraObjectId: string;
}

async function markIdentityInactive(
  tenantId: string,
  identity: EntraIdentityRef,
  reason: string
): Promise<number> {
  return runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();

    return knex.transaction(async (trx) => {
      const now = trx.fn.now();
      const links = await trx('entra_contact_links')
        .where({
          tenant: tenantId,
          entra_tenant_id: identity.entraTenantId,
          entra_object_id: identity.entraObjectId,
        })
        .select(['contact_name_id']);

      if (links.length === 0) {
        return 0;
      }

      const contactIds = links.map((row: any) => String(row.contact_name_id));
      await trx('contacts')
        .where({
          tenant: tenantId,
        })
        .whereIn('contact_name_id', contactIds)
        .update({
          is_inactive: true,
          entra_account_enabled: false,
          entra_sync_status: 'inactive',
          entra_sync_status_reason: reason,
          last_entra_sync_at: now,
          updated_at: now,
        });

      await trx('entra_contact_links')
        .where({
          tenant: tenantId,
          entra_tenant_id: identity.entraTenantId,
          entra_object_id: identity.entraObjectId,
        })
        .update({
          is_active: false,
          link_status: 'inactive',
          last_synced_at: now,
          updated_at: now,
        });

      return contactIds.length;
    });
  });
}

export async function markDisabledEntraUsersInactive(
  tenantId: string,
  identities: EntraIdentityRef[]
): Promise<number> {
  let updated = 0;
  for (const identity of identities) {
    updated += await markIdentityInactive(tenantId, identity, 'disabled_upstream');
  }
  return updated;
}
