import type { ContactPhoneNumberInput } from '@alga-psa/types';
import { createTenantKnex, runWithTenant } from '@/lib/db';
import { ContactModel } from '@alga-psa/shared/models/contactModel';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { queueAmbiguousEntraMatch } from '../reconciliationQueueService';
import { findContactMatchesByEmail } from './contactMatcher';
import { upsertEntraContactLinkActive } from './contactLinkRepository';
import type { EntraSyncUser } from './types';
import type { EntraContactMatchCandidate } from './contactMatcher';
import { buildContactFieldSyncPatch, buildEntraContactPhoneNumbers } from './contactFieldSync';

export interface EntraLinkedContactResult {
  action: 'linked';
  /** True when the enabled field-sync rules actually changed a contact value. */
  fieldsUpdated: boolean;
  contactNameId: string;
  linkIdentity: {
    entraTenantId: string;
    entraObjectId: string;
  };
}

export interface EntraCreatedContactResult {
  action: 'created' | 'linked';
  /** Present so the result unions narrow cleanly on `action`; creation never counts as an update. */
  fieldsUpdated?: boolean;
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

/**
 * Whether the enabled field-sync rules would actually change the contact.
 * The caller reports this as the run's `updated` count, so it has to mean
 * "a value on this contact changed", not "a field-sync rule is enabled".
 */
async function detectContactFieldChanges(
  trx: Knex.Transaction,
  tenantId: string,
  contactNameId: string,
  directContactPatch: Record<string, unknown>,
  phoneNumbers: ContactPhoneNumberInput[] | undefined
): Promise<boolean> {
  const patchColumns = Object.keys(directContactPatch);

  if (patchColumns.length > 0) {
    const existing = await tenantDb(trx, tenantId).table('contacts')
      .where({ contact_name_id: contactNameId })
      .first(patchColumns);

    const changed = patchColumns.some((column) => {
      const nextValue = directContactPatch[column] ?? null;
      const currentValue = (existing as Record<string, unknown> | undefined)?.[column] ?? null;
      return nextValue !== currentValue;
    });

    if (changed) {
      return true;
    }
  }

  if (phoneNumbers === undefined) {
    return false;
  }

  const existingPhones = await tenantDb(trx, tenantId).table('contact_phone_numbers')
    .where({ contact_name_id: contactNameId })
    .orderBy('display_order')
    .select(['phone_number', 'canonical_type']);

  const describe = (rows: Array<{ phone_number?: unknown; canonical_type?: unknown }>): string =>
    JSON.stringify(rows.map((row) => [String(row.phone_number ?? ''), String(row.canonical_type ?? '')]));

  return describe(existingPhones) !== describe(phoneNumbers);
}

async function upsertContactLink(
  trx: Knex.Transaction,
  tenantId: string,
  clientId: string,
  contactNameId: string,
  user: EntraSyncUser,
  fieldSyncConfig?: Record<string, unknown>
): Promise<boolean> {
  const now = trx.fn.now();
  await upsertEntraContactLinkActive(trx, {
    tenantId,
    clientId,
    contactNameId,
    user,
  });

  const syncedFieldPatch = buildContactFieldSyncPatch(user, fieldSyncConfig || {});
  const { phone_numbers, ...directContactPatch } = syncedFieldPatch as Record<string, unknown> & {
    phone_numbers?: unknown;
  };

  const fieldsUpdated = await detectContactFieldChanges(
    trx,
    tenantId,
    contactNameId,
    directContactPatch,
    phone_numbers as ContactPhoneNumberInput[] | undefined
  );

  if (phone_numbers !== undefined) {
    await ContactModel.updateContact(
      contactNameId,
      {
        phone_numbers: phone_numbers as ReturnType<typeof buildEntraContactPhoneNumbers>,
      },
      tenantId,
      trx
    );
  }

  await tenantDb(trx, tenantId).table('contacts')
    .where({
      contact_name_id: contactNameId,
    })
    .update({
      entra_object_id: user.entraObjectId,
      entra_sync_source: 'entra_sync',
      last_entra_sync_at: now,
      entra_user_principal_name: user.userPrincipalName,
      entra_account_enabled: user.accountEnabled,
      ...directContactPatch,
      updated_at: now,
    });

  return fieldsUpdated;
}

async function findExistingLinkedContactId(
  trx: Knex.Transaction,
  tenantId: string,
  user: EntraSyncUser
): Promise<string | null> {
  const existing = await tenantDb(trx, tenantId).table('entra_contact_links')
    .where({
      entra_tenant_id: user.entraTenantId,
      entra_object_id: user.entraObjectId,
    })
    .orderBy('updated_at', 'desc')
    .first(['contact_name_id']);

  return existing?.contact_name_id ? String(existing.contact_name_id) : null;
}

async function findExistingClientContactByEmail(
  trx: Knex.Transaction,
  tenantId: string,
  clientId: string,
  email: string
): Promise<string | null> {
  const existing = await tenantDb(trx, tenantId).table('contacts')
    .where({
      client_id: clientId,
    })
    .andWhereRaw('lower(email) = ?', [email.trim().toLowerCase()])
    .orderBy('updated_at', 'desc')
    .first(['contact_name_id']);

  return existing?.contact_name_id ? String(existing.contact_name_id) : null;
}

export async function linkExistingMatchedContact(
  tenantId: string,
  clientId: string,
  matchedContact: EntraContactMatchCandidate,
  user: EntraSyncUser,
  fieldSyncConfig?: Record<string, unknown>
): Promise<EntraLinkedContactResult> {
  const fieldsUpdated = await runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();
    return knex.transaction(async (trx) => {
      return upsertContactLink(
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
    fieldsUpdated,
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

  const createdContact = await runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();
    const normalizedEmail = email.trim().toLowerCase();

    return knex.transaction(async (trx) => {
      const linkedContactId = await findExistingLinkedContactId(trx, tenantId, user);
      if (linkedContactId) {
        await upsertContactLink(trx, tenantId, clientId, linkedContactId, user, {});
        return { contactNameId: linkedContactId, action: 'linked' as const };
      }

      const existingClientContactId = await findExistingClientContactByEmail(
        trx,
        tenantId,
        clientId,
        normalizedEmail
      );
      if (existingClientContactId) {
        await upsertContactLink(trx, tenantId, clientId, existingClientContactId, user, {});
        return { contactNameId: existingClientContactId, action: 'linked' as const };
      }

      let createdContactNameId: string | null = null;
      const created = await ContactModel.createContact(
        {
          full_name: fallbackDisplayName(user),
          email: normalizedEmail,
          client_id: clientId,
          phone_numbers: buildEntraContactPhoneNumbers(user),
          role: user.jobTitle || undefined,
          is_inactive: false,
        },
        tenantId,
        trx
      );
      createdContactNameId = String(created.contact_name_id);

      await upsertContactLink(trx, tenantId, clientId, createdContactNameId, user, {});
      return { contactNameId: createdContactNameId, action: 'created' as const };
    });
  });

  return {
    action: createdContact.action,
    contactNameId: createdContact.contactNameId,
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
