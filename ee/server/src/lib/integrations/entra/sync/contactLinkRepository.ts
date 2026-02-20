import type { Knex } from 'knex';
import type { EntraSyncUser } from './types';

export interface UpsertEntraContactLinkInput {
  tenantId: string;
  clientId: string;
  contactNameId: string;
  user: EntraSyncUser;
}

export async function upsertEntraContactLinkActive(
  trx: Knex.Transaction,
  input: UpsertEntraContactLinkInput
): Promise<void> {
  const now = trx.fn.now();

  await trx('entra_contact_links')
    .insert({
      tenant: input.tenantId,
      contact_name_id: input.contactNameId,
      client_id: input.clientId,
      entra_tenant_id: input.user.entraTenantId,
      entra_object_id: input.user.entraObjectId,
      link_status: 'active',
      is_active: true,
      last_seen_at: now,
      last_synced_at: now,
      metadata: trx.raw(`'{}'::jsonb`),
      created_at: now,
      updated_at: now,
    })
    .onConflict(['tenant', 'entra_tenant_id', 'entra_object_id'])
    .merge({
      contact_name_id: input.contactNameId,
      client_id: input.clientId,
      link_status: 'active',
      is_active: true,
      last_seen_at: now,
      last_synced_at: now,
      updated_at: now,
    });
}
