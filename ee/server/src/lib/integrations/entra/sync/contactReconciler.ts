import { createTenantKnex, runWithTenant } from '@/lib/db';
import type { EntraSyncUser } from './types';
import type { EntraContactMatchCandidate } from './contactMatcher';

export interface EntraLinkedContactResult {
  action: 'linked';
  contactNameId: string;
  linkIdentity: {
    entraTenantId: string;
    entraObjectId: string;
  };
}

export async function linkExistingMatchedContact(
  tenantId: string,
  clientId: string,
  matchedContact: EntraContactMatchCandidate,
  user: EntraSyncUser
): Promise<EntraLinkedContactResult> {
  await runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();
    const now = knex.fn.now();

    await knex('entra_contact_links')
      .insert({
        tenant: tenantId,
        contact_name_id: matchedContact.contactNameId,
        client_id: clientId,
        entra_tenant_id: user.entraTenantId,
        entra_object_id: user.entraObjectId,
        link_status: 'active',
        is_active: true,
        last_seen_at: now,
        last_synced_at: now,
        metadata: knex.raw(`'{}'::jsonb`),
        created_at: now,
        updated_at: now,
      })
      .onConflict(['tenant', 'entra_tenant_id', 'entra_object_id'])
      .merge({
        contact_name_id: matchedContact.contactNameId,
        client_id: clientId,
        link_status: 'active',
        is_active: true,
        last_seen_at: now,
        last_synced_at: now,
        updated_at: now,
      });
  });

  return {
    action: 'linked',
    contactNameId: matchedContact.contactNameId,
    linkIdentity: {
      entraTenantId: user.entraTenantId,
      entraObjectId: user.entraObjectId,
    },
  };
}
