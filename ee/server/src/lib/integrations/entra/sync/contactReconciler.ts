import { createTenantKnex, runWithTenant } from '@/lib/db';
import { ContactModel } from '@alga-psa/shared/models/contactModel';
import type { Knex } from 'knex';
import { queueAmbiguousEntraMatch } from '../reconciliationQueueService';
import { findContactMatchesByEmail } from './contactMatcher';
import type { EntraSyncUser } from './types';
import type { EntraContactMatchCandidate } from './contactMatcher';
import { buildContactFieldSyncPatch } from './contactFieldSync';

export interface EntraLinkedContactResult {
  action: 'linked';
  contactNameId: string;
  linkIdentity: {
    entraTenantId: string;
    entraObjectId: string;
  };
}

export interface EntraCreatedContactResult {
  action: 'created';
  contactNameId: string;
  linkIdentity: {
    entraTenantId: string;
    entraObjectId: string;
  };
}

export interface EntraAmbiguousContactResult {
  action: 'ambiguous';
  queueItemId: string;
}

export type EntraReconcileContactResult =
  | EntraLinkedContactResult
  | EntraCreatedContactResult
  | EntraAmbiguousContactResult;

export interface ReconcileEntraUserInput {
  tenantId: string;
  clientId: string;
  managedTenantId: string | null;
  user: EntraSyncUser;
  fieldSyncConfig?: Record<string, unknown>;
  allowDestructiveOperations?: boolean;
}

function fallbackDisplayName(user: EntraSyncUser): string {
  if (user.displayName && user.displayName.trim()) {
    return user.displayName.trim();
  }

  const givenName = user.givenName?.trim() || '';
  const surname = user.surname?.trim() || '';
  const fullName = `${givenName} ${surname}`.trim();
  if (fullName) {
    return fullName;
  }

  const emailIdentity = user.email || user.userPrincipalName || 'Entra Contact';
  return emailIdentity.split('@')[0] || emailIdentity;
}

async function upsertContactLink(
  trx: Knex.Transaction,
  tenantId: string,
  clientId: string,
  contactNameId: string,
  user: EntraSyncUser,
  fieldSyncConfig?: Record<string, unknown>
): Promise<void> {
  const now = trx.fn.now();

  await trx('entra_contact_links')
    .insert({
      tenant: tenantId,
      contact_name_id: contactNameId,
      client_id: clientId,
      entra_tenant_id: user.entraTenantId,
      entra_object_id: user.entraObjectId,
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
      contact_name_id: contactNameId,
      client_id: clientId,
      link_status: 'active',
      is_active: true,
      last_seen_at: now,
      last_synced_at: now,
      updated_at: now,
    });

  const syncedFieldPatch = buildContactFieldSyncPatch(user, fieldSyncConfig || {});
  await trx('contacts')
    .where({
      tenant: tenantId,
      contact_name_id: contactNameId,
    })
    .update({
      entra_object_id: user.entraObjectId,
      entra_sync_source: 'entra_sync',
      last_entra_sync_at: now,
      entra_user_principal_name: user.userPrincipalName,
      entra_account_enabled: user.accountEnabled,
      ...syncedFieldPatch,
      updated_at: now,
    });
}

export async function linkExistingMatchedContact(
  tenantId: string,
  clientId: string,
  matchedContact: EntraContactMatchCandidate,
  user: EntraSyncUser,
  fieldSyncConfig?: Record<string, unknown>
): Promise<EntraLinkedContactResult> {
  await runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();
    await knex.transaction(async (trx) => {
      await upsertContactLink(
        trx,
        tenantId,
        clientId,
        matchedContact.contactNameId,
        user,
        fieldSyncConfig
      );
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

export async function createContactForEntraUser(
  tenantId: string,
  clientId: string,
  user: EntraSyncUser
): Promise<EntraCreatedContactResult> {
  const email = user.email || user.userPrincipalName;
  if (!email) {
    throw new Error('Cannot create contact for Entra user without email/UPN.');
  }

  const createdContactNameId = await runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();

    return knex.transaction(async (trx) => {
      const created = await ContactModel.createContact(
        {
          full_name: fallbackDisplayName(user),
          email,
          client_id: clientId,
          phone_number: user.mobilePhone || user.businessPhones[0] || undefined,
          role: user.jobTitle || undefined,
          is_inactive: false,
        },
        tenantId,
        trx
      );

      await upsertContactLink(trx, tenantId, clientId, String(created.contact_name_id), user, {});
      return String(created.contact_name_id);
    });
  });

  return {
    action: 'created',
    contactNameId: createdContactNameId,
    linkIdentity: {
      entraTenantId: user.entraTenantId,
      entraObjectId: user.entraObjectId,
    },
  };
}

export async function queueAmbiguousContactMatch(
  tenantId: string,
  clientId: string,
  managedTenantId: string | null,
  user: EntraSyncUser,
  candidates: EntraContactMatchCandidate[]
): Promise<EntraAmbiguousContactResult> {
  const queued = await queueAmbiguousEntraMatch({
    tenantId,
    clientId,
    managedTenantId,
    user,
    candidates,
  });

  return {
    action: 'ambiguous',
    queueItemId: queued.queueItemId,
  };
}

export async function reconcileEntraUserToContact(
  input: ReconcileEntraUserInput
): Promise<EntraReconcileContactResult> {
  if (input.allowDestructiveOperations) {
    throw new Error('Entra sync is non-destructive: delete/purge operations are not allowed.');
  }

  const candidates = await findContactMatchesByEmail(input.tenantId, input.clientId, input.user);
  if (candidates.length > 1) {
    return queueAmbiguousContactMatch(
      input.tenantId,
      input.clientId,
      input.managedTenantId,
      input.user,
      candidates
    );
  }

  if (candidates.length === 1) {
    return linkExistingMatchedContact(
      input.tenantId,
      input.clientId,
      candidates[0],
      input.user,
      input.fieldSyncConfig
    );
  }

  return createContactForEntraUser(input.tenantId, input.clientId, input.user);
}
