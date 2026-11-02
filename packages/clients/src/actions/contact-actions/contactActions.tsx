'use server'

import { queueContactCreated, queueContactUpdated } from '../../lib/contactEvents';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

import type {
  ContactEmailAddressInput,
  DeletionValidationResult,
  IClient,
  IContact,
  ImportContactResult,
  ITag,
} from '@alga-psa/types';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { isEnterprise, unparseCSV } from '@alga-psa/core';
import { deleteEntityWithValidation } from '@alga-psa/core/server';
import { getContactAvatarUrlsBatchAsync } from '../../lib/documentsHelpers';
import { createTagsForEntityWithTransaction } from '@alga-psa/tags/actions/tagActions';
import { isTagTextValidationFailure, validateTagText } from '@alga-psa/tags/lib/tagTextValidation';
import { deleteEntityTags } from '@alga-psa/tags/lib/tagCleanup';
import {
  assertMspOrClientPortalOwnClientPermission,
  assertMspPermission,
  hasMspPermission,
  isClientPortalUser,
  isMspUser,
} from '../../lib/authHelpers';
import type { IBoard } from '@alga-psa/types';
import { assertContactIsNotSharedMailbox, clearContactLinksBeforeDelete, ContactModel, CreateContactInput, UpdateContactInput } from '@alga-psa/shared/models/contactModel';
import { localizeActionError, withAuth } from '@alga-psa/auth';
import { publishWorkflowEvent, publishNonCatalogWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildContactArchivedPayload,
  buildContactCreatedPayload,
  buildContactUpdatedPayload,
} from '@alga-psa/workflow-streams';
import {
  formatContactCsvAdditionalEmailAddresses,
  formatContactCsvPrimaryEmailType,
  isValidContactCsvEmailValue,
  normalizeContactCsvEmailValue,
} from '../../lib/contactCsvEmailFields';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  contactCoreFieldsSchema,
  isUnchangedFromStored,
  normalizePhone,
  parseSubmittedFields
} from '@alga-psa/validation';
import { collectReportContactIds } from '../../lib/managerSubtree';
import { isStructuralFailure, type StructuralResult } from '../../lib/structuralResult';

// Keep the error key alongside localized text so classification never depends on
// the user's language. Prefixes remain stable for legacy callers.
type LocalizedContactError = Error & { messageKey: string; messageParams: Record<string, string | number>; permission: boolean };

async function contactText(key: string, params: Record<string, string | number> = {}): Promise<string> {
  const { t } = await getServerTranslation(undefined, 'msp/contacts');
  return t(key, params);
}

async function contactError(key: string, prefix = '', params: Record<string, string | number> = {}): Promise<LocalizedContactError> {
  return Object.assign(new Error(prefix + await contactText(key, params)), {
    messageKey: `msp/contacts:${key}`,
    messageParams: params,
    permission: prefix === 'Permission denied: ' || key === 'errors.contact.otherClient',
  });
}

function localizedContactActionError(error: unknown): ContactUpdateActionError | null {
  if (!(error instanceof Error) || !('messageKey' in error)) return null;
  const localized = error as LocalizedContactError;
  return localized.permission
    ? permissionError(localized.message, localized.messageKey, localized.messageParams)
    : actionError(stripExpectedContactErrorPrefix(localized.message), localized.messageKey, localized.messageParams);
}

/**
 * Structural validation, applied on write only. Pass `existing` on an update so a
 * value that arrives unchanged is skipped rather than re-validated: the contact
 * drawer round-trips the whole record, and a contact that predates the schema has
 * to stay editable on the fields the caller did touch.
 */
async function applyContactStructuralSchema<T extends Record<string, any>>(
  payload: T,
  options: { partial?: boolean; existing?: Record<string, unknown> | null } = {}
): Promise<StructuralResult<T>> {
  const result = parseSubmittedFields(contactCoreFieldsSchema, payload, options);
  if (!result.success) {
    return { ok: false, error: `VALIDATION_ERROR: ${result.error ?? await contactText('errors.contact.invalidData')}` };
  }
  return { ok: true, data: { ...payload, ...(result.data ?? {}) } };
}

type ContactPhoneRow = { contact_phone_number_id?: string; phone_number?: string | null; extension?: string | null };

/**
 * Structural check for the phone rows a contact carries, each in its own column pair.
 * A stored row resubmitted unchanged is grandfathered, same rule as the scalar fields.
 */
async function validateContactPhoneRows(
  rows: ContactPhoneRow[] | undefined,
  existingRows?: ContactPhoneRow[]
): Promise<string | null> {
  if (!rows?.length) {
    return null;
  }

  for (const [index, row] of rows.entries()) {
    const stored = row.contact_phone_number_id
      ? existingRows?.find((candidate) => candidate.contact_phone_number_id === row.contact_phone_number_id)
      : undefined;
    if (
      stored &&
      isUnchangedFromStored(row.phone_number, stored.phone_number) &&
      isUnchangedFromStored(row.extension, stored.extension)
    ) {
      continue;
    }

    const normalized = normalizePhone(row.phone_number, { extension: row.extension });
    if (normalized.error) {
      return `VALIDATION_ERROR: ${await contactText(
        normalized.error === 'extensionInvalid' ? 'errors.contact.phoneExtensionInvalid' : 'errors.contact.phoneNumberInvalid',
        { index: index + 1 },
      )}`;
    }
    if (normalized.value && !row.phone_number?.trim().startsWith('+')) {
      return `VALIDATION_ERROR: ${await contactText('errors.contact.phoneCountryRequired', { index: index + 1 })}`;
    }
    row.phone_number = normalized.value;
    if (normalized.extension) {
      row.extension = normalized.extension;
    }
  }

  return null;
}

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

function maybeUserActor(user: any) {
  const userId = user?.user_id;
  if (typeof userId !== 'string' || !userId) return undefined;
  return { actorType: 'USER' as const, actorUserId: userId };
}

function buildDefaultPhoneNumbers(phoneNumber?: string | null) {
  const trimmedPhoneNumber = phoneNumber?.trim();
  if (!trimmedPhoneNumber) {
    return [];
  }

  return [{
    phone_number: trimmedPhoneNumber,
    canonical_type: 'work' as const,
    is_default: true,
    display_order: 0,
  }];
}

type ContactActionInput = Omit<Partial<IContact>, 'phone_numbers' | 'additional_email_addresses'> & {
  phone_numbers?: CreateContactInput['phone_numbers'];
  primary_email_canonical_type?: CreateContactInput['primary_email_canonical_type'];
  primary_email_custom_type?: CreateContactInput['primary_email_custom_type'];
  additional_email_addresses?: CreateContactInput['additional_email_addresses'];
};
type ContactUpdateActionError = ActionMessageError | ActionPermissionError;

function stripExpectedContactErrorPrefix(message: string): string {
  return message.replace(/^(VALIDATION_ERROR|EMAIL_EXISTS|FOREIGN_KEY_ERROR):\s*/, '');
}

async function contactEmailConflictMessageFrom(error: unknown): Promise<string | null> {
  const dbError = error as { code?: string; constraint?: string };
  if (
    dbError?.code === '23505' &&
    (
      dbError.constraint === 'ux_contact_additional_email_addresses_tenant_normalized_email' ||
      dbError.constraint === 'contacts_email_tenant_unique' ||
      dbError.constraint === 'contacts_tenant_email_unique'
    )
  ) {
    return await contactText('errors.contact.emailExists');
  }

  if (!(error instanceof Error)) {
    return null;
  }

  const message = error.message;
  if (
    message.includes('duplicate key') &&
    (
      message.includes('ux_contact_additional_email_addresses_tenant_normalized_email') ||
      message.includes('contacts_email_tenant_unique') ||
      message.includes('contacts_tenant_email_unique')
    )
  ) {
    return await contactText('errors.contact.emailExists');
  }
  if (message.includes('A contact email already exists as an additional email address in this tenant')) {
    return await contactText('errors.contact.emailExists');
  }
  if (message.includes('An additional email address already exists as a contact primary email in this tenant')) {
    return await contactText('errors.contact.tenantEmailExists');
  }

  return null;
}

async function contactUpdateActionErrorFrom(error: unknown): Promise<ContactUpdateActionError | null> {
  const localized = localizedContactActionError(error);
  if (localized) return localized;
  if (error instanceof Error) {
    const message = error.message;
    if (message.includes('Permission denied:') || message.includes('You do not have permission')) {
      return permissionError(message);
    }
    if (message === 'Cannot manage contacts for another client') {
      return permissionError('Permission denied: Cannot manage contacts for another client', 'msp/contacts:errors.contact.otherClient');
    }
    if (message === 'Contact not found') {
      return actionError('Contact not found', 'msp/contacts:errors.contact.notFound');
    }
    if (message === 'Contact is not associated with a client') {
      return actionError('Contact is not associated with a client', 'msp/contacts:errors.contact.notAssociatedWithClient');
    }
    if (
      message.startsWith('VALIDATION_ERROR:') ||
      message.startsWith('EMAIL_EXISTS:') ||
      message.startsWith('FOREIGN_KEY_ERROR:')
    ) {
      return actionError(stripExpectedContactErrorPrefix(message));
    }

    if (message.includes('duplicate key') && message.includes('contacts_email_tenant_unique')) {
      return actionError('A contact with this email address already exists in the system', 'msp/contacts:errors.contact.emailExists');
    }
    if (message.includes('violates not-null constraint')) {
      const field = message.match(/column "([^"]+)"/)?.[1] || await contactText('errors.contact.field');
      return actionError(`The ${field} is required`, 'msp/contacts:errors.contact.fieldRequired', { field });
    }
    if (message.includes('violates foreign key constraint') && message.includes('client_id')) {
      return actionError('The selected client is no longer valid', 'msp/contacts:errors.contact.clientInvalid');
    }
  }

  const emailConflict = await contactEmailConflictMessageFrom(error);
  if (emailConflict) {
    return actionError(emailConflict);
  }

  const dbError = error as { code?: string; constraint?: string; column?: string };
  if (dbError?.code === '23505') {
    if (dbError.constraint?.includes('contacts_email_tenant_unique')) {
      return actionError('A contact with this email address already exists in the system', 'msp/contacts:errors.contact.emailExists');
    }
    return actionError('A contact with these details already exists.', 'msp/contacts:errors.contact.duplicate');
  }
  if (dbError?.code === '23502') {
    return actionError(`The ${dbError.column || await contactText('errors.contact.field')} is required`, 'msp/contacts:errors.contact.fieldRequired', { field: dbError.column || await contactText('errors.contact.field') });
  }
  if (dbError?.code === '23503') {
    return actionError('The selected client or inbound ticket destination is no longer valid', 'msp/contacts:errors.contact.destinationInvalid');
  }
  if (dbError?.code === '22P02') {
    return actionError('Invalid contact data provided. Please refresh and try again.', 'msp/contacts:errors.contact.invalidDataRefresh');
  }
  if (dbError?.code === '23514') {
    return actionError('Invalid contact data provided. Please check all fields and try again.', 'msp/contacts:errors.contact.invalidDataFields');
  }

  return null;
}

// Reported as a bare string rather than returned as a payload, so withAuth's
// boundary never sees the messageKey. Localize before flattening.
async function contactActionResultErrorFrom(error: unknown, fallback: string): Promise<string> {
  const expected = await contactUpdateActionErrorFrom(error);
  if (expected) {
    const candidate = (await localizeActionError(expected)) as unknown as {
      actionError?: unknown;
      permissionError?: unknown;
    };
    return typeof candidate.actionError === 'string'
      ? candidate.actionError
      : String(candidate.permissionError ?? fallback);
  }

  return fallback;
}

async function prefixedContactActionErrorFrom(error: unknown, fallback: string): Promise<string> {
  const emailConflict = await contactEmailConflictMessageFrom(error);
  if (emailConflict) {
    return `EMAIL_EXISTS: ${emailConflict}`;
  }

  if (error instanceof Error) {
    const message = error.message;
    if (
      message.startsWith('VALIDATION_ERROR:') ||
      message.startsWith('EMAIL_EXISTS:') ||
      message.startsWith('FOREIGN_KEY_ERROR:') ||
      message.startsWith('Permission denied:')
    ) {
      return message;
    }

    if (message.includes('duplicate key') && message.includes('contacts_email_tenant_unique')) {
      return `EMAIL_EXISTS: ${await contactText('errors.contact.emailExists')}`;
    }

    if (message.includes('violates not-null constraint')) {
      const field = message.match(/column "([^"]+)"/)?.[1] || await contactText('errors.contact.field');
      return `VALIDATION_ERROR: ${await contactText('errors.contact.fieldRequired', { field })}`;
    }

    if (message.includes('violates foreign key constraint') && message.includes('client_id')) {
      return `FOREIGN_KEY_ERROR: ${await contactText('errors.contact.clientInvalid')}`;
    }
  }

  return fallback;
}

async function contactImportRowMessageFrom(error: unknown): Promise<string> {
  return stripExpectedContactErrorPrefix(
    await prefixedContactActionErrorFrom(
      error,
      await contactText('errors.contact.importRowFailed'),
    ),
  );
}

function contactImportFailureResults(
  contactsData: Array<ContactImportData> | null | undefined,
  message: string
): ImportContactResult[] {
  const rows = contactsData && contactsData.length > 0 ? contactsData : [{} as ContactImportData];
  return rows.map((originalData) => ({
    success: false,
    message,
    originalData,
  }));
}

type ContactImportData = Omit<Partial<IContact>, 'additional_email_addresses'> & {
  additional_email_addresses?: CreateContactInput['additional_email_addresses'];
  tags?: string;
  primary_email_custom_type?: string | null;
};

export type AddContactResult =
  | { success: true; contact: IContact }
  | { success: false; error: string };

function getDerivedDefaultPhone(contact: Pick<IContact, 'default_phone_number' | 'phone_numbers'>): string {
  return contact.default_phone_number
    || contact.phone_numbers.find((phoneNumber) => phoneNumber.is_default)?.phone_number
    || '';
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

async function cleanupEntraReferencesBeforeContactDelete(
  trx: Knex.Transaction,
  tenantId: string,
  contactId: string
): Promise<void> {
  if (!isEnterprise) {
    return;
  }

  const queueTableExists = await trx('information_schema.tables')
    .where({ table_schema: 'public', table_name: 'entra_contact_reconciliation_queue' })
    .first('table_name');

  if (!queueTableExists) {
    return;
  }

  await tenantScopedTable(trx, 'entra_contact_reconciliation_queue', tenantId)
    .where({ resolved_contact_id: contactId })
    .update({
      resolved_contact_id: null,
      updated_at: trx.fn.now(),
    });
}


export const getContactByContactNameId = withAuth(async (
  user,
  { tenant },
  contactNameId: string
): Promise<IContact | null> => {
  const { knex: db } = await createTenantKnex();
  try {
    // Validate input
    if (!contactNameId) {
      throw await contactError('errors.contact.idRequired', 'VALIDATION_ERROR: ');
    }

    await assertMspPermission(user, 'contact', 'read', `Permission denied: ${await contactText('errors.contact.permissions.readContacts')}`, db);

    // Fetch contact with client information
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => ContactModel.getContactById(contactNameId, tenant, trx));
    if (!contact) {
      return null;
    }

    // The model doesn't resolve avatars (they live in document associations),
    // but single-contact reads feed avatar-bearing surfaces (bento hero, quick view).
    const avatarUrlsMap = await getContactAvatarUrlsBatchAsync([contact.contact_name_id], tenant);
    return { ...contact, avatarUrl: avatarUrlsMap.get(contact.contact_name_id) ?? null };
  } catch (err) {
    console.error('Error getting contact by contact_name_id:', err);

    if (err instanceof Error) {
      const message = err.message;
      if (message.includes('VALIDATION_ERROR:') ||
        message.includes('Permission denied:') ||
        message.includes('SYSTEM_ERROR:')) {
        throw err;
      }
      if (message.includes('relation') && message.includes('does not exist')) {
        throw await contactError('errors.contact.schemaError', 'SYSTEM_ERROR: ');
      }
    }

    throw await contactError('errors.contact.readFailed', 'SYSTEM_ERROR: ');
  }
});

export const deleteContact = withAuth(async (
  user,
  { tenant },
  contactId: string
): Promise<DeletionValidationResult & {
  success: boolean;
  deleted?: boolean;
  counts?: Record<string, number>;
}> => {
  const { knex: db } = await createTenantKnex();

  try {
    if (!contactId) {
      throw await contactError('errors.contact.idRequired', 'VALIDATION_ERROR: ');
    }

    await assertMspPermission(user, 'contact', 'delete', `Permission denied: ${await contactText('errors.contact.permissions.deleteContacts')}`, db);

    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantScopedTable(trx, 'contacts', tenant)
        .where({ contact_name_id: contactId })
        .first();
    });

    if (!contact) {
      return {
        success: false,
        canDelete: false,
        code: 'NOT_FOUND',
        message: await contactText('errors.contact.deleteMissing'),
        dependencies: [],
        alternatives: []
      };
    }

    const result = await deleteEntityWithValidation('contact', contactId, db, tenant, async (trx, tenantId) => {
      await deleteEntityTags(trx, contactId, 'contact');

      // Clean up child records owned by the contact
      await tenantScopedTable(trx, 'contact_phone_numbers', tenantId).where({ contact_name_id: contactId }).delete();
      await tenantScopedTable(trx, 'contact_additional_email_addresses', tenantId).where({ contact_name_id: contactId }).delete();
      await tenantScopedTable(trx, 'comments', tenantId).where({ contact_id: contactId }).delete();
      await tenantScopedTable(trx, 'portal_invitations', tenantId).where({ contact_id: contactId }).delete();

      await clearContactLinksBeforeDelete(trx, tenantId, contactId);

      // Unlink from any RMM org mapping using this contact as its default
      // notification contact (no FK; Citus rejects ON DELETE SET NULL).
      await tenantScopedTable(trx, 'rmm_organization_mappings', tenantId)
        .where({ default_contact_id: contactId })
        .update({ default_contact_id: null });

      const contactRecord = await tenantScopedTable(trx, 'contacts', tenantId)
        .where({ contact_name_id: contactId })
        .select('notes_document_id')
        .first();

      if (contactRecord?.notes_document_id) {
        await tenantScopedTable(trx, 'document_block_content', tenantId)
          .where({ document_id: contactRecord.notes_document_id })
          .delete();

        await tenantScopedTable(trx, 'document_associations', tenantId)
          .where({ document_id: contactRecord.notes_document_id })
          .delete();

        await tenantScopedTable(trx, 'documents', tenantId)
          .where({ document_id: contactRecord.notes_document_id })
          .delete();
      }

      await cleanupEntraReferencesBeforeContactDelete(trx, tenantId, contactId);

      const deleted = await tenantScopedTable(trx, 'contacts', tenantId)
        .where({ contact_name_id: contactId })
        .delete();

      if (!deleted || deleted === 0) {
        throw new Error(await contactText('errors.contact.deleteRecordFailed'));
      }
    });

    const counts = result.dependencies.reduce<Record<string, number>>((acc, dependency) => {
      acc[dependency.type] = dependency.count;
      return acc;
    }, {});

    if (result.deleted) {
      const occurredAt = new Date().toISOString();
      await publishNonCatalogWorkflowEvent({
        eventType: 'CONTACT_DELETED',
        payload: {
          contactId,
          clientId: typeof contact.client_id === 'string' ? contact.client_id : undefined,
          deletedByUserId: user.user_id,
          deletedAt: occurredAt,
        },
        ctx: {
          tenantId: tenant,
          occurredAt,
          actor: maybeUserActor(user),
        },
        idempotencyKey: `contact_deleted:${contactId}:${occurredAt}`,
      });
    }

    return {
      ...result,
      deleted: result.deleted,
      success: result.deleted === true,
      counts,
    };
  } catch (err) {
    console.error('Error deleting contact:', err);

    const expected = await contactUpdateActionErrorFrom(err);
    if (expected) {
      return {
        success: false,
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: await contactActionResultErrorFrom(err, await contactText('errors.contact.deleteFailed')),
        dependencies: [],
        alternatives: []
      };
    }

    if (err instanceof Error) {
      const message = err.message;

      if (message.includes('violates foreign key constraint')) {
        return {
          success: false,
          canDelete: false,
          code: 'VALIDATION_FAILED',
          message: await contactText('errors.contact.deleteDependencies'),
          dependencies: [],
          alternatives: []
        };
      }

      if (message.includes('connection') || message.includes('timeout')) {
        return {
          success: false,
          canDelete: false,
          code: 'VALIDATION_FAILED',
          message: await contactText('errors.contact.connectionFailed'),
          dependencies: [],
          alternatives: []
        };
      }

      return {
        success: false,
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: await contactText('errors.contact.deleteFailed'),
        dependencies: [],
        alternatives: []
      };
    }

    return {
      success: false,
      canDelete: false,
      code: 'VALIDATION_FAILED',
      message: await contactText('errors.contact.deleteUnexpected'),
      dependencies: [],
      alternatives: []
    };
  }
});

type ContactFilterStatus = 'active' | 'inactive' | 'all';

export const getContactsEligibleForInvitation = withAuth(async (
  user,
  { tenant },
  clientId?: string,
  status: ContactFilterStatus = 'active'
): Promise<IContact[]> => {
  const { knex: db } = await createTenantKnex();

  const canRead = await hasMspPermission(user, 'contact', 'read', db);
  if (!canRead) {
    return [];
  }

  try {
    const contacts = await withTransaction(db, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
      const q = scopedDb.table('contacts as c');
      scopedDb.tenantJoin(q, 'users as u', 'u.contact_id', 'c.contact_name_id', {
        type: 'left',
        on(join) {
          join.andOn(trx.raw('u.user_type = ?', ['client']));
        },
      });
      scopedDb.tenantJoin(q, 'clients as comp', 'c.client_id', 'comp.client_id', { type: 'left' });
      q
        .whereNull('u.user_id')
        .modify((qb: Knex.QueryBuilder) => {
          if (clientId) qb.andWhere('c.client_id', clientId);
          if (status !== 'all') qb.andWhere('c.is_inactive', status === 'inactive');
        })
        .select('c.*', 'comp.client_name')
        .orderBy('c.full_name', 'asc');

      const rows = await q;
      return ContactModel.hydrateContactsWithPhoneNumbers(rows as any[], tenant, trx);
    });

    const contactIds = contacts.map((c: IContact) => c.contact_name_id);
    const avatarUrlsMap = await getContactAvatarUrlsBatchAsync(contactIds, tenant);

    const contactsWithAvatars = contacts.map((contact: IContact) => ({
      ...contact,
      avatarUrl: avatarUrlsMap.get(contact.contact_name_id) || null,
    } as IContact));

    return contactsWithAvatars;
  } catch (err) {
    console.error('Error fetching contacts eligible for invitation:', err);
    throw err;
  }
});

export const addContact = withAuth(async (
  user,
  { tenant },
  contactData: ContactActionInput
): Promise<AddContactResult> => {
  const { knex: db } = await createTenantKnex();

  try {
    await assertMspPermission(user, 'contact', 'create', `Permission denied: ${await contactText('errors.contact.permissions.createContacts')}`, db);

    const structural = await applyContactStructuralSchema(
      { full_name: contactData.full_name || '', email: contactData.email ?? undefined },
      { partial: false }
    );
    if (isStructuralFailure(structural)) {
      throw new Error(structural.error);
    }

    const phoneRowError = await validateContactPhoneRows(contactData.phone_numbers);
    if (phoneRowError) {
      throw new Error(phoneRowError);
    }

    const createInput: CreateContactInput = {
      full_name: structural.data.full_name,
      email: structural.data.email ?? undefined,
      primary_email_canonical_type: contactData.primary_email_canonical_type ?? undefined,
      primary_email_custom_type: contactData.primary_email_custom_type ?? undefined,
      additional_email_addresses: contactData.additional_email_addresses ?? [],
      phone_numbers: contactData.phone_numbers ?? [],
      client_id: contactData.client_id || undefined,
      manager_contact_id: contactData.manager_contact_id || undefined,
      role: contactData.role ?? undefined,
      notes: contactData.notes || undefined,
      is_inactive: contactData.is_inactive ?? undefined
    };

    // LEVERAGE: pattern contact-create-with-event
    // Use the shared ContactModel to create the contact.
    // The model handles validation and business rules.
    const created = await withTransaction(db, async (trx: Knex.Transaction) => {
      return ContactModel.createContact(createInput, tenant, trx);
    });

    const clientId = (created as any)?.client_id;
    // Client-less contacts emit too: the webhook layer carries client_id only when present.
    const occurredAt = (created as any)?.created_at ?? new Date().toISOString();
    const actor = maybeUserActor(user);
    await publishWorkflowEvent({
      eventType: 'CONTACT_CREATED',
      payload: buildContactCreatedPayload({
        contactId: created.contact_name_id,
        clientId,
        fullName: created.full_name,
        email: created.email || undefined,
        primaryEmailCanonicalType: created.primary_email_canonical_type ?? null,
        primaryEmailCustomTypeId: created.primary_email_custom_type_id ?? null,
        primaryEmailType: created.primary_email_type ?? null,
        additionalEmailAddresses: created.additional_email_addresses ?? [],
        phoneNumbers: created.phone_numbers,
        defaultPhoneNumber: created.default_phone_number || undefined,
        defaultPhoneType: created.default_phone_type || undefined,
        createdByUserId: user?.user_id,
        createdAt: occurredAt,
      }),
      ctx: { tenantId: tenant, occurredAt, actor },
      idempotencyKey: `contact_created:${created.contact_name_id}`,
    });

    return { success: true, contact: created };
  } catch (err) {
    console.error('Error adding contact:', err);

    return {
      success: false,
      error: await prefixedContactActionErrorFrom(
        err,
        `SYSTEM_ERROR: ${await contactText('errors.contact.createFailed')}`,
      ),
    };
  }
});

export const listContactPhoneTypeSuggestions = withAuth(async (
  user,
  { tenant }
): Promise<string[]> => {
  const { knex: db } = await createTenantKnex();

  if (!await hasMspPermission(user, 'contact', 'read', db)) {
    return [];
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const rows = await tenantScopedTable(trx, 'contact_phone_type_definitions', tenant)
      .orderBy('label', 'asc')
      .select('label');

    return rows
      .map((row: { label?: string | null }) => row.label?.trim() ?? '')
      .filter((label: string): label is string => label.length > 0);
  });
});

export const getCustomPhoneTypeUsageCount = withAuth(async (
  user,
  { tenant },
  customTypeLabel: string
): Promise<{ label: string; usageCount: number }> => {
  const { knex: db } = await createTenantKnex();

  if (!await hasMspPermission(user, 'contact', 'read', db)) {
    return { label: customTypeLabel, usageCount: 0 };
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    return ContactModel.getCustomPhoneTypeUsageCount(customTypeLabel, tenant, trx);
  });
});

export const getContactLastUsagePhoneTypes = withAuth(async (
  user,
  { tenant },
  contactId: string
): Promise<Array<{ contact_phone_type_id: string; label: string }>> => {
  const { knex: db } = await createTenantKnex();

  if (!await hasMspPermission(user, 'contact', 'read', db)) {
    return [];
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    return ContactModel.findLastUsagePhoneTypes(contactId, tenant, trx);
  });
});

export const deleteOrphanedPhoneTypes = withAuth(async (
  user,
  { tenant },
  typeLabels: string[]
): Promise<number> => {
  const { knex: db } = await createTenantKnex();

  await assertMspPermission(user, 'contact', 'update', `Permission denied: ${await contactText('errors.contact.permissions.managePhoneTypes')}`, db);

  if (typeLabels.length === 0) return 0;

  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Only delete types that are actually orphaned (safety check)
    const orphaned = await ContactModel.findOrphanedPhoneTypeDefinitions(tenant, trx);
    const normalizedRequested = new Set(
      typeLabels.map(l => l.trim().replace(/\s+/g, ' ').toLowerCase())
    );
    const idsToDelete = orphaned
      .filter(o => normalizedRequested.has(o.label.trim().replace(/\s+/g, ' ').toLowerCase()))
      .map(o => o.contact_phone_type_id);
    return ContactModel.deletePhoneTypeDefinitions(idsToDelete, tenant, trx);
  });
});

export const updateContact = withAuth(async (
  user,
  { tenant },
  contactData: ContactActionInput
): Promise<IContact | ContactUpdateActionError> => {
  const { knex: db } = await createTenantKnex();

  try {
    if (!contactData.contact_name_id) {
      throw await contactError('errors.contact.updateIdRequired', 'VALIDATION_ERROR: ');
    }

    await assertMspPermission(user, 'contact', 'update', `Permission denied: ${await contactText('errors.contact.permissions.updateContacts')}`, db);

    if (contactData.email) {
      const existingContact = await withTransaction(db, async (trx: Knex.Transaction) => {
        return await tenantScopedTable(trx, 'contacts', tenant)
          .where({ email: contactData.email!.trim().toLowerCase() })
          .whereNot({ contact_name_id: contactData.contact_name_id })
          .first();
      });

      if (existingContact) {
        throw await contactError('errors.contact.emailExists', 'EMAIL_EXISTS: ');
      }
    }

    if ('client_id' in contactData && contactData.client_id) {
      const client = await withTransaction(db, async (trx: Knex.Transaction) => {
        return await tenantScopedTable(trx, 'clients', tenant)
          .where({ client_id: contactData.client_id })
          .first();
      });

      if (!client) {
        throw await contactError('errors.contact.clientMissing', 'FOREIGN_KEY_ERROR: ');
      }
    }

    const inboundDestinationIdRaw = (contactData as any).inbound_ticket_defaults_id;
    if (
      inboundDestinationIdRaw !== undefined &&
      inboundDestinationIdRaw !== null &&
      String(inboundDestinationIdRaw).trim() !== ''
    ) {
      const inboundDestinationId = String(inboundDestinationIdRaw).trim();
      const destination = await withTransaction(db, async (trx: Knex.Transaction) => {
        return await tenantScopedTable(trx, 'inbound_ticket_defaults', tenant)
          .where({ id: inboundDestinationId })
          .first();
      });

      if (!destination) {
        throw await contactError('errors.contact.destinationMissing', 'FOREIGN_KEY_ERROR: ');
      }

      (contactData as any).inbound_ticket_defaults_id = inboundDestinationId;
    }

    const updateResult = await withTransaction(db, async (trx: Knex.Transaction) => {
      const existingContact = await ContactModel.getContactById(contactData.contact_name_id!, tenant, trx);

      if (!existingContact) {
        throw await contactError('errors.contact.updateMissing', 'VALIDATION_ERROR: ');
      }

      // Structural rules come from the shared schema, measured against the stored
      // row: a contact that predates the schema keeps its legacy values until
      // somebody actually edits them.
      const structural = await applyContactStructuralSchema(contactData, { existing: existingContact as Record<string, unknown> });
      if (isStructuralFailure(structural)) {
        throw new Error(structural.error);
      }
      Object.assign(contactData, structural.data);

      const phoneRowError = await validateContactPhoneRows(contactData.phone_numbers, existingContact.phone_numbers);
      if (phoneRowError) {
        throw new Error(phoneRowError);
      }

      const updated = await ContactModel.updateContact(contactData.contact_name_id!, {
        full_name: contactData.full_name,
        client_id: contactData.client_id === '' ? undefined : contactData.client_id || undefined,
        // undefined = leave unchanged; null/'' = clear. Validated (same client,
        // acyclic) and reconciled with client changes inside ContactModel.
        manager_contact_id:
          contactData.manager_contact_id === undefined ? undefined : contactData.manager_contact_id || null,
        phone_numbers: contactData.phone_numbers,
        email: contactData.email ?? undefined,
        primary_email_canonical_type: contactData.primary_email_canonical_type ?? undefined,
        primary_email_custom_type: contactData.primary_email_custom_type ?? undefined,
        additional_email_addresses: contactData.additional_email_addresses,
        // Persist the validated inbound ticket destination override. An empty string
        // clears it (null); undefined leaves it unchanged.
        inbound_ticket_defaults_id:
          (contactData as any).inbound_ticket_defaults_id === ''
            ? null
            : ((contactData as any).inbound_ticket_defaults_id ?? undefined),
        role: contactData.role ?? undefined,
        notes: contactData.notes ?? undefined,
        is_inactive: contactData.is_inactive ?? undefined,
      }, tenant, trx);

      if (contactData.is_inactive === true) {
        await tenantScopedTable(trx, 'users', tenant)
          .where({ contact_id: contactData.contact_name_id, user_type: 'client' })
          .update({ is_inactive: true });
      }

      return {
        before: existingContact,
        after: updated,
        updatedFieldKeys: Object.keys(contactData).filter((key) => key !== 'contact_name_id'),
        occurredAt: updated.updated_at,
      };
    });

    const updatedContact = updateResult.after;
    if (!updatedContact) {
      throw new Error(await contactText('errors.contact.updateRecordMissing'));
    }

    const occurredAt = updateResult.occurredAt ?? (updatedContact as any)?.updated_at ?? new Date().toISOString();
    const actor = maybeUserActor(user);
    const clientId = (updatedContact as any)?.client_id ?? (updateResult.before as any)?.client_id;

    // Client-less contacts emit too: the webhook layer carries client_id only when present.
    const wasInactive = Boolean((updateResult.before as any)?.is_inactive);
    const isInactive = Boolean((updatedContact as any)?.is_inactive);
    if (!wasInactive && isInactive) {
      await publishWorkflowEvent({
        eventType: 'CONTACT_ARCHIVED',
        payload: buildContactArchivedPayload({
          contactId: updatedContact.contact_name_id,
          clientId,
          archivedByUserId: user?.user_id,
          archivedAt: occurredAt,
        }),
        ctx: { tenantId: tenant, occurredAt, actor },
        idempotencyKey: `contact_archived:${updatedContact.contact_name_id}:${occurredAt}`,
      });
    }

    const updatedPayload = buildContactUpdatedPayload({
      contactId: updatedContact.contact_name_id,
      clientId,
      before: updateResult.before as any,
      after: updatedContact as any,
      updatedFieldKeys: updateResult.updatedFieldKeys ?? [],
      updatedByUserId: user?.user_id,
      updatedAt: occurredAt,
    });

    const updatedFields = (updatedPayload as any).updatedFields;
    const changes = (updatedPayload as any).changes;
    if ((Array.isArray(updatedFields) && updatedFields.length) || (changes && Object.keys(changes).length)) {
      await publishWorkflowEvent({
        eventType: 'CONTACT_UPDATED',
        payload: updatedPayload,
        ctx: { tenantId: tenant, occurredAt, actor },
        idempotencyKey: `contact_updated:${updatedContact.contact_name_id}:${occurredAt}`,
      });
    }

    return updatedContact;
  } catch (err) {
    console.error('Error updating contact:', err);

    const expected = await contactUpdateActionErrorFrom(err);
    if (expected) return expected;

    throw err;
  }
});

export const updateContactsForClient = withAuth(async (
  user,
  { tenant },
  clientId: string,
  updateData: Partial<IContact>
): Promise<void | ContactUpdateActionError> => {
  const { knex: db } = await createTenantKnex();

  try {
    if (!clientId) {
      throw await contactError('errors.contact.clientIdRequired', 'VALIDATION_ERROR: ');
    }

    await assertMspPermission(user, 'contact', 'update', `Permission denied: ${await contactText('errors.contact.permissions.updateContacts')}`, db);

    const client = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantScopedTable(trx, 'clients', tenant)
        .where({ client_id: clientId })
        .first();
    });

    if (!client) {
      throw await contactError('errors.contact.specifiedClientMissing', 'VALIDATION_ERROR: ');
    }

    if (Object.keys(updateData).length === 0) {
      throw await contactError('errors.contact.updateDataRequired', 'VALIDATION_ERROR: ');
    }

    if (updateData.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(updateData.email.trim())) {
        throw await contactError('errors.contact.emailInvalid', 'VALIDATION_ERROR: ');
      }
    }

    const sanitizedData = Object.entries(updateData).reduce<Partial<IContact>>((acc, [key, value]) => {
      const contactKey = key as keyof IContact;
      if (value === undefined) return acc;

      switch (contactKey) {
        case 'email':
        case 'full_name':
        case 'role':
          acc[contactKey] = typeof value === 'string' ? value.trim() : String(value);
          if (contactKey === 'email' && acc[contactKey]) {
            acc[contactKey] = acc[contactKey]!.toLowerCase();
          }
          break;
        case 'notes':
          if (value === null) {
            acc[contactKey] = undefined;
          } else {
            acc[contactKey] = typeof value === 'string' ? value.trim() : String(value);
          }
          break;
        case 'client_id':
          acc[contactKey] = value === null ? null : String(value);
          break;
        case 'is_inactive':
          acc[contactKey] = Boolean(value);
          break;
        case 'created_at':
        case 'updated_at':
          if (typeof value === 'string') {
            acc[contactKey] = value;
          } else if (value instanceof Date) {
            acc[contactKey] = value.toISOString();
          } else if (typeof value === 'number') {
            acc[contactKey] = new Date(value).toISOString();
          }
          break;
      }
      return acc;
    }, {});

    await withTransaction(db, async (trx: Knex.Transaction) => {
      const beforeRows = await tenantScopedTable(trx, 'contacts', tenant)
        .where({ client_id: clientId })
        .select('*');

      const updated = await tenantScopedTable(trx, 'contacts', tenant)
        .where({ client_id: clientId })
        .update({
          ...sanitizedData,
          updated_at: new Date().toISOString()
        });

      if (!updated) {
        throw new Error(await contactText('errors.contact.bulkUpdateFailed'));
      }

      // One contact.updated (and contact.deactivated on an active -> inactive flip) per affected contact.
      // A client_id change (bulk move) shows up as `client_id` in changed_fields.
      const afterRows = await tenantScopedTable(trx, 'contacts', tenant)
        .whereIn('contact_name_id', beforeRows.map((row: any) => row.contact_name_id))
        .select('*');
      const afterById = new Map<string, any>(afterRows.map((row: any) => [row.contact_name_id, row]));
      for (const beforeRow of beforeRows as any[]) {
        const afterRow = afterById.get(beforeRow.contact_name_id);
        if (afterRow) {
          queueContactUpdated(trx, tenant, beforeRow, afterRow, Object.keys(sanitizedData), { actorUserId: user?.user_id });
        }
      }
    });
  } catch (err) {
    console.error('Error updating contacts for client:', err);

    const expected = await contactUpdateActionErrorFrom(err);
    if (expected) return expected;

    if (err instanceof Error) {
      const message = err.message;
      if (message.includes('duplicate key') && message.includes('contacts_email_tenant_unique')) {
        return actionError('One or more contacts already have this email address', 'msp/contacts:errors.contact.bulkEmailExists');
      }

      if (message.includes('violates not-null constraint')) {
        const field = message.match(/column "([^"]+)"/)?.[1] || await contactText('errors.contact.field');
        return actionError(`The ${field} is required`, 'msp/contacts:errors.contact.fieldRequired', { field });
      }

      if (message.includes('violates foreign key constraint')) {
        return actionError('Invalid reference in update data', 'msp/contacts:errors.contact.invalidReference');
      }
    }

    throw await contactError('errors.contact.updateFailed', 'SYSTEM_ERROR: ');
  }
});

export async function exportContactsToCSV(
  contacts: IContact[],
  clients: IClient[],
  contactTags: Record<string, ITag[]>
): Promise<string> {
  const fields = [
    'full_name',
    'email',
    'primary_email_type',
    'additional_email_addresses',
    'phone_number',
    'client',
    'role',
    'notes',
    'tags',
  ];

  const data = contacts.map((contact): Record<string, string> => {
    const client = clients.find(c => c.client_id === contact.client_id);
    const tags = contactTags[contact.contact_name_id] || [];
    const tagText = tags.map((tag: ITag) => tag.tag_text).join(', ');

    return {
      full_name: contact.full_name || '',
      email: contact.email || '',
      primary_email_type: formatContactCsvPrimaryEmailType(contact),
      additional_email_addresses: formatContactCsvAdditionalEmailAddresses(contact.additional_email_addresses),
      phone_number: getDerivedDefaultPhone(contact),
      client: client?.client_name || '',
      role: contact.role || '',
      notes: contact.notes || '',
      tags: tagText
    };
  });

  return unparseCSV(data, fields);
}

export async function generateContactCSVTemplate(): Promise<string> {
  const templateData = [
    {
      full_name: 'Alice Liddell',
      email: 'alice@wonderland.com',
      primary_email_type: 'work',
      additional_email_addresses: 'personal:alice.home@wonderland.com | billing:accounts@wonderland.com',
      phone_number: '+1 212-555-0107',
      client: 'Mad Hatter Tea Client',
      role: await contactText('csvTemplate.explorerRole'),
      notes: await contactText('csvTemplate.explorerNotes'),
      tags: await contactText('csvTemplate.explorerTags')
    },
    {
      full_name: 'Mad Hatter',
      email: 'hatter@teaparty.wonderland',
      primary_email_type: 'other',
      additional_email_addresses: 'billing:tea-bills@teaparty.wonderland | personal:hatter.afterhours@teaparty.wonderland',
      phone_number: '+1 212-555-0108',
      client: 'Mad Hatter Tea Client',
      role: await contactText('csvTemplate.teaRole'),
      notes: await contactText('csvTemplate.teaNotes'),
      tags: await contactText('csvTemplate.teaTags')
    }
  ];

  const fields = [
    'full_name',
    'email',
    'primary_email_type',
    'additional_email_addresses',
    'phone_number',
    'client',
    'role',
    'notes',
    'tags',
  ];

  return unparseCSV(templateData, fields);
}

function normalizeImportedEmailList(emails: Array<string | null | undefined>): string[] {
  return [...new Set(
    emails
      .map((email) => normalizeContactCsvEmailValue(email))
      .filter((email): email is string => Boolean(email))
  )];
}

async function findExistingContactByImportedEmails(
  trx: Knex.Transaction,
  tenant: string,
  emails: string[]
): Promise<IContact | undefined> {
  if (emails.length === 0) {
    return undefined;
  }

  const directMatches = await tenantScopedTable(trx, 'contacts', tenant)
    .select('contact_name_id')
    .whereIn('email', emails);

  const additionalMatches = await tenantScopedTable(trx, 'contact_additional_email_addresses', tenant)
    .select('contact_name_id')
    .whereIn('normalized_email_address', emails);

  const contactIds = [...new Set([
    ...directMatches.map((row: { contact_name_id: string }) => row.contact_name_id),
    ...additionalMatches.map((row: { contact_name_id: string }) => row.contact_name_id),
  ])];

  if (contactIds.length > 1) {
    throw await contactError('errors.contact.importMultipleMatches', 'VALIDATION_ERROR: ');
  }

  if (contactIds.length === 0) {
    return undefined;
  }

  const contact = await ContactModel.getContactById(contactIds[0], tenant, trx);
  return contact ?? undefined;
}

function toContactEmailAddressInput(
  row: Pick<NonNullable<IContact['additional_email_addresses']>[number], 'email_address' | 'canonical_type' | 'custom_type' | 'display_order'>
): ContactEmailAddressInput {
  return {
    email_address: row.email_address,
    canonical_type: row.canonical_type ?? null,
    custom_type: row.custom_type ?? null,
    display_order: row.display_order,
  };
}

export const importContactsFromCSV = withAuth(async (
  user,
  { tenant },
  contactsData: Array<ContactImportData>,
  updateExisting: boolean = false
): Promise<ImportContactResult[]> => {
  const { knex: db } = await createTenantKnex();

  try {
    await assertMspPermission(user, 'contact', 'create', `Permission denied: ${await contactText('errors.contact.permissions.createContacts')}`, db);
    if (updateExisting && !await hasMspPermission(user, 'contact', 'update', db)) {
      throw await contactError('errors.contact.updatePermission', 'Permission denied: ');
    }

    if (!contactsData || contactsData.length === 0) {
      throw await contactError('errors.contact.importDataRequired', 'VALIDATION_ERROR: ');
    }

    const results: ImportContactResult[] = [];

    await withTransaction(db, async (trx: Knex.Transaction) => {
      for (const contactData of contactsData) {
        try {
          if (!contactData.full_name?.trim()) {
            throw await contactError('errors.contact.fullNameRequired', 'VALIDATION_ERROR: ');
          }

          const normalizedPrimaryEmail = normalizeContactCsvEmailValue(contactData.email);
          if (normalizedPrimaryEmail !== contactData.email) {
            contactData.email = normalizedPrimaryEmail ?? undefined;
          }

          if (contactData.email && !isValidContactCsvEmailValue(contactData.email)) {
            throw await contactError('errors.contact.importEmailInvalid', 'VALIDATION_ERROR: ', { name: contactData.full_name! });
          }

          if (contactData.client_id) {
            const client = await tenantScopedTable(trx, 'clients', tenant)
              .where({ client_id: contactData.client_id })
              .first();

            if (!client) {
              throw await contactError('errors.contact.importClientMissing', 'FOREIGN_KEY_ERROR: ', { name: contactData.full_name! });
            }
          }

          const importEmails = normalizeImportedEmailList([
            contactData.email,
            ...(contactData.additional_email_addresses ?? []).map((row) => row.email_address),
          ]);

          let existingContact: IContact | undefined = undefined;
          let matchedByEmail = false;
          existingContact = await findExistingContactByImportedEmails(trx, tenant, importEmails);
          matchedByEmail = Boolean(existingContact);

          if (!existingContact) {
            const existingContactRow = await tenantScopedTable(trx, 'contacts', tenant)
              .select('contact_name_id')
              .where({
                full_name: contactData.full_name.trim(),
                client_id: contactData.client_id
              })
              .first();

            if (existingContactRow?.contact_name_id) {
              existingContact = await ContactModel.getContactById(existingContactRow.contact_name_id, tenant, trx) ?? undefined;
            }
          }

          if (existingContact && !updateExisting) {
            const duplicateField = matchedByEmail ? 'email' : 'name';
            results.push({
              success: false,
              message: `VALIDATION_ERROR: ${await contactText(duplicateField === 'email' ? 'errors.contact.importDuplicateEmail' : 'errors.contact.importDuplicateName', { value: (duplicateField === 'email' ? importEmails[0] ?? contactData.email : contactData.full_name) ?? '' })}`,
              originalData: contactData
            });
            continue;
          }

          const importedPhoneRows = contactData.phone_numbers
            ?? (contactData.phone_number !== undefined
              ? buildDefaultPhoneNumbers(contactData.phone_number)
              : existingContact
                ? undefined
                : []);
          if (importedPhoneRows) {
            const phoneRowError = await validateContactPhoneRows(importedPhoneRows, existingContact?.phone_numbers);
            if (phoneRowError) {
              throw new Error(phoneRowError);
            }
            contactData.phone_numbers = importedPhoneRows;
          }

          let savedContact: IContact;

          if (existingContact && updateExisting) {
            const normalizedImportedPrimaryEmail = normalizeContactCsvEmailValue(contactData.email);
            if (
              normalizedImportedPrimaryEmail &&
              normalizedImportedPrimaryEmail !== existingContact.email?.toLowerCase()
            ) {
              const baseAdditionalRows = (
                contactData.additional_email_addresses
                ?? existingContact.additional_email_addresses?.map(toContactEmailAddressInput)
                ?? []
              )
                .filter((row) =>
                  normalizeContactCsvEmailValue(row.email_address) !== existingContact.email?.toLowerCase()
                )
                .map((row, index) => ({
                  ...row,
                  display_order: index,
                }));

              const hasPromotedEmailRow = baseAdditionalRows.some((row) =>
                normalizeContactCsvEmailValue(row.email_address) === normalizedImportedPrimaryEmail
              );

              if (!hasPromotedEmailRow) {
                const matchingExistingAdditionalRow = existingContact.additional_email_addresses?.find((row) =>
                  normalizeContactCsvEmailValue(row.email_address) === normalizedImportedPrimaryEmail
                );

                if (matchingExistingAdditionalRow) {
                  baseAdditionalRows.push({
                    email_address: matchingExistingAdditionalRow.email_address,
                    canonical_type: matchingExistingAdditionalRow.canonical_type ?? null,
                    custom_type: matchingExistingAdditionalRow.custom_type ?? null,
                    display_order: baseAdditionalRows.length,
                  });
                }
              }

              contactData.additional_email_addresses = baseAdditionalRows;
            }

            const updateData: UpdateContactInput = {
              full_name: contactData.full_name.trim(),
              email: contactData.email ?? existingContact.email ?? undefined,
              phone_numbers: contactData.phone_numbers
                ?? (contactData.phone_number !== undefined
                  ? buildDefaultPhoneNumbers(contactData.phone_number)
                  : existingContact.phone_numbers),
              client_id: contactData.client_id || undefined,
              is_inactive: contactData.is_inactive ?? undefined,
              role: normalizeOptionalText(contactData.role) ?? existingContact.role ?? undefined,
              notes: normalizeOptionalText(contactData.notes) ?? existingContact.notes ?? undefined,
            };

            if (contactData.primary_email_canonical_type !== undefined || contactData.primary_email_custom_type !== undefined) {
              updateData.primary_email_canonical_type = contactData.primary_email_canonical_type ?? null;
              updateData.primary_email_custom_type = contactData.primary_email_custom_type ?? null;
            }

            if (contactData.additional_email_addresses !== undefined) {
              updateData.additional_email_addresses = contactData.additional_email_addresses;
            }

            savedContact = await ContactModel.updateContact(existingContact.contact_name_id, updateData, tenant, trx);
            queueContactUpdated(trx, tenant, existingContact as any, savedContact as any, Object.keys(updateData), { actorUserId: user?.user_id });

            // A blank Tags value is "no opinion": it neither clears nor writes tags.
            if (hasImportedTags(contactData.tags)) {
              await writeImportedContactTags(trx, tenant, savedContact.contact_name_id, contactData.tags, true);
            }

            results.push({
              success: true,
              message: await contactText('messages.success.updated'),
              contact: savedContact,
              originalData: contactData
            });
          } else {
            const contactToCreate = {
              full_name: contactData.full_name.trim(),
              email: contactData.email || '',
              primary_email_canonical_type: contactData.primary_email_canonical_type,
              primary_email_custom_type: contactData.primary_email_custom_type,
              additional_email_addresses: contactData.additional_email_addresses,
              phone_numbers: contactData.phone_numbers ?? buildDefaultPhoneNumbers(contactData.phone_number),
              client_id: contactData.client_id || undefined,
              is_inactive: contactData.is_inactive || false,
              role: normalizeOptionalText(contactData.role),
              notes: normalizeOptionalText(contactData.notes),
            };

            savedContact = await ContactModel.createContact(contactToCreate, tenant, trx);
            queueContactCreated(trx, tenant, savedContact as any, { actorUserId: user?.user_id });

            if (hasImportedTags(contactData.tags)) {
              await writeImportedContactTags(trx, tenant, savedContact.contact_name_id, contactData.tags, false);
            }

            results.push({
              success: true,
              message: await contactText('messages.success.created'),
              contact: savedContact,
              originalData: contactData
            });
          }
        } catch (err) {
          console.error('Error processing contact:', contactData, err);

          results.push({
            success: false,
            message: await contactImportRowMessageFrom(err),
            originalData: contactData
          });
        }
      }
    });

    return results;
  } catch (err) {
    console.error('Error importing contacts:', err);

    const expected = await contactUpdateActionErrorFrom(err);
    if (expected) {
      return contactImportFailureResults(
        contactsData,
        await contactActionResultErrorFrom(err, await contactText('errors.contact.importFileFailed')),
      );
    }

    if (err instanceof Error) {
      const message = err.message;
      if (message.includes('relation') && message.includes('does not exist')) {
        throw await contactError('errors.contact.schemaError', 'SYSTEM_ERROR: ');
      }
    }

    throw await contactError('errors.contact.importFailed', 'SYSTEM_ERROR: ');
  }
});

function hasImportedTags(tagsColumn: string | undefined): tagsColumn is string {
  return typeof tagsColumn === 'string' && tagsColumn.trim() !== '';
}

/**
 * Writes a CSV row's tags in the import transaction; `replace` first clears the
 * contact's existing tags. Tag texts are trimmed, de-duplicated
 * case-insensitively and validated through the shared tag rules (invalid ones
 * are skipped with a warning). The write runs in a savepoint on the import
 * transaction, so a failed tag write cannot abort the rest of the import and
 * nothing opens a second connection that would wait on this transaction's rows.
 * Tag events are queued after-commit on the owning import transaction.
 *
 * A tag failure is logged and swallowed: the contact row is still imported
 * and only its tags are lost, as before.
 */
// LEVERAGE: pattern tag-write-primitive — writeImportedContactTags embeds savepoint + dedupe + validation for "tags from a cell"; if a third importer needs it, this belongs beside createTagsForEntityWithTransaction
async function writeImportedContactTags(
  importTrx: Knex.Transaction,
  tenant: string,
  contactId: string,
  tagsColumn: string,
  replace: boolean,
): Promise<void> {
  const seen = new Set<string>();
  const tagTexts: string[] = [];
  for (const raw of tagsColumn.split(',')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const validation = validateTagText(trimmed);
    if (isTagTextValidationFailure(validation)) {
      console.warn(`Skipping invalid tag during CSV import: ${validation.message}`, { tag: trimmed });
      continue;
    }
    const key = validation.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tagTexts.push(validation.text);
  }

  try {
    await importTrx.transaction(async (trx) => {
      if (replace) {
        await tenantScopedTable(trx, 'tag_mappings', tenant)
          .where({ tagged_id: contactId, tagged_type: 'contact' })
          .delete();
      }
      if (tagTexts.length > 0) {
        await createTagsForEntityWithTransaction(
          trx,
          tenant,
          contactId,
          'contact',
          tagTexts.map((tag_text) => ({ tag_text, isNew: false })),
        );
      }
    });
  } catch (tagError) {
    console.error('Failed to write tags during CSV import:', tagError);
  }
}

export const checkExistingEmails = withAuth(async (
  user,
  { tenant },
  emails: string[]
): Promise<string[] | ContactUpdateActionError> => {
  const { knex: db } = await createTenantKnex();

  try {
    await assertMspPermission(user, 'contact', 'read', `Permission denied: ${await contactText('errors.contact.permissions.readContacts')}`, db);

    if (!emails || emails.length === 0) {
      throw await contactError('errors.contact.emailsRequired', 'VALIDATION_ERROR: ');
    }

    const invalidEmail = emails.find((email) => !isValidContactCsvEmailValue(email));
    if (invalidEmail) {
      throw await contactError('errors.contact.invalidEmailValue', 'VALIDATION_ERROR: ', { email: invalidEmail });
    }

    const sanitizedEmails = normalizeImportedEmailList(emails);
    if (sanitizedEmails.length === 0) {
      throw await contactError('errors.contact.validEmailsRequired', 'VALIDATION_ERROR: ');
    }

    const existingEmails = await withTransaction(db, async (trx: Knex.Transaction) => {
      const primaryEmails = await tenantScopedTable(trx, 'contacts', tenant)
        .select('email')
        .whereIn('email', sanitizedEmails);

      const additionalEmails = await tenantScopedTable(trx, 'contact_additional_email_addresses', tenant)
        .select('normalized_email_address')
        .whereIn('normalized_email_address', sanitizedEmails);

      return [
        ...primaryEmails.map((contact: { email: string }) => contact.email),
        ...additionalEmails.map((row: { normalized_email_address: string }) => row.normalized_email_address),
      ];
    });

    return [...new Set(existingEmails)];
  } catch (err) {
    console.error('Error checking existing emails:', err);

    const expected = await contactUpdateActionErrorFrom(err);
    if (expected) return expected;

    if (err instanceof Error) {
      const message = err.message;
      if (message.includes('relation') && message.includes('does not exist')) {
        throw await contactError('errors.contact.schemaError', 'SYSTEM_ERROR: ');
      }
    }

    throw await contactError('errors.contact.checkEmailsFailed', 'SYSTEM_ERROR: ');
  }
});

export const getContactByEmail = withAuth(async (
  user,
  { tenant },
  email: string,
  clientId: string
) => {
  try {
    const { knex } = await createTenantKnex();
    await assertMspOrClientPortalOwnClientPermission(
      user,
      tenant,
      clientId,
      'contact',
      'read',
      `Permission denied: ${await contactText('errors.contact.permissions.readContacts')}`,
      knex
    );

    const contact = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const existingContact = await tenantScopedTable(trx, 'contacts', tenant)
        .where({ email: email.toLowerCase(), client_id: clientId })
        .first<{ contact_name_id: string }>();

      if (!existingContact) {
        return null;
      }

      return ContactModel.getContactById(existingContact.contact_name_id, tenant, trx);
    });

    return contact;
  } catch (error) {
    console.error('Error getting contact by email:', error);
    throw error;
  }
});

/**
 * Create a new contact for a client
 * @deprecated Use createOrFindContactByEmail instead for better duplicate handling
 */
export const createClientContact = withAuth(async (
  user,
  { tenant },
  {
    clientId,
    fullName,
    email,
    primaryEmailCanonicalType,
    primaryEmailCustomType,
    additionalEmailAddresses,
    phone = '',
    phoneNumbers,
    jobTitle = ''
  }: {
    clientId: string;
    fullName: string;
    email: string;
    primaryEmailCanonicalType?: CreateContactInput['primary_email_canonical_type'];
    primaryEmailCustomType?: CreateContactInput['primary_email_custom_type'];
    additionalEmailAddresses?: CreateContactInput['additional_email_addresses'];
    phone?: string;
    phoneNumbers?: CreateContactInput['phone_numbers'];
    jobTitle?: string;
  }
) => {
  try {
    const { knex } = await createTenantKnex();
    await assertMspPermission(user, 'contact', 'create', `Permission denied: ${await contactText('errors.contact.permissions.createContacts')}`, knex);

    const structural = await applyContactStructuralSchema(
      { full_name: fullName, email },
      { partial: false }
    );
    if (isStructuralFailure(structural)) {
      throw new Error(structural.error);
    }
    const normalizedEmail = structural.data.email ?? '';

    const resolvedPhoneNumbers = phoneNumbers ?? buildDefaultPhoneNumbers(phone);
    const phoneRowError = await validateContactPhoneRows(resolvedPhoneNumbers);
    if (phoneRowError) {
      throw new Error(phoneRowError);
    }

    const existingContact = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await tenantScopedTable(trx, 'contacts', tenant)
        .where({ email: normalizedEmail })
        .first();
    });

    if (existingContact) {
      throw await contactError('errors.contact.emailExists', 'EMAIL_EXISTS: ');
    }

    const contact = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const created = await ContactModel.createContact({
        full_name: structural.data.full_name,
        email: normalizedEmail,
        primary_email_canonical_type: primaryEmailCanonicalType,
        primary_email_custom_type: primaryEmailCustomType,
        additional_email_addresses: additionalEmailAddresses ?? [],
        phone_numbers: resolvedPhoneNumbers,
        client_id: clientId,
        role: jobTitle,
      }, tenant, trx);
      queueContactCreated(trx, tenant, created as any, { actorUserId: user?.user_id });
      return created;
    });

    return contact;
  } catch (error) {
    console.error('Error creating client contact:', error);
    throw error;
  }
});

/**
 * Update contact's portal admin status
 */
export const updateContactPortalAdminStatus = withAuth(async (
  user,
  { tenant },
  contactId: string,
  isPortalAdmin: boolean
): Promise<{ success: boolean; error?: string }> => {
  try {
    const { knex } = await createTenantKnex();

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      await resolveContactAndVerifyPermission(
        user,
        trx,
        tenant,
        contactId,
        'user',
        'update',
        `Permission denied: ${await contactText('errors.contact.permissions.updateClientUsers')}`
      );

      if (isPortalAdmin) {
        await assertContactIsNotSharedMailbox(trx, tenant, contactId, await contactText('errors.contact.sharedMailboxAdmin'));
      }

      const updated = await tenantScopedTable(trx, 'contacts', tenant)
        .where({ contact_name_id: contactId })
        .update({
          is_client_admin: isPortalAdmin,
          updated_at: new Date().toISOString()
        });

      if (updated === 0) {
        throw await contactError('errors.contact.notFound');
      }
    });

    return { success: true };
  } catch (error) {
    console.error('[contactActions.updateContactPortalAdminStatus]', error);
    return {
      success: false,
      error: await contactActionResultErrorFrom(
        error,
        await contactText('errors.contact.portalAdminUpdateFailed'),
      )
    };
  }
});

/**
 * Get user associated with a contact
 */
export const getUserByContactId = withAuth(async (
  user,
  { tenant },
  contactId: string
): Promise<{ user: any | null; error?: string }> => {
  try {
    const { knex } = await createTenantKnex();

    const userWithRoles = await withTransaction(knex, async (trx: Knex.Transaction) => {
      await resolveContactAndVerifyPermission(
        user,
        trx,
        tenant,
        contactId,
        'user',
        'read',
        `Permission denied: ${await contactText('errors.contact.permissions.viewClientUsers')}`
      );

      const foundUser = await tenantScopedTable(trx, 'users', tenant)
        .where({ contact_id: contactId, user_type: 'client' })
        .first();

      if (!foundUser) {
        return null;
      }

      const scopedDb = tenantDb(trx, tenant);
      const rolesQuery = scopedDb.table('user_roles')
        .select('roles.role_id', 'roles.role_name')
        .where({
          'user_roles.user_id': foundUser.user_id
        });
      scopedDb.tenantJoin(rolesQuery, 'roles', 'user_roles.role_id', 'roles.role_id');
      const roles = await rolesQuery;

      return {
        ...foundUser,
        roles: roles || []
      };
    });

    if (!userWithRoles) {
      return { user: null, error: undefined };
    }

    return { user: userWithRoles, error: undefined };
  } catch (error) {
    console.error('[contactActions.getUserByContactId]', error);
    return {
      user: null,
      error: await contactActionResultErrorFrom(error, await contactText('errors.contact.userLoadFailed'))
    };
  }
});

type VisibilityGroupListItem = {
  group_id: string;
  name: string;
  description: string | null;
  board_count: number;
  ticket_scope: 'client' | 'contact';
  asset_scope: 'client' | 'contact';
  project_scope: 'client' | 'contact';
};

type VisibilityGroupRow = Pick<VisibilityGroupListItem, 'group_id' | 'name' | 'description' | 'ticket_scope' | 'asset_scope' | 'project_scope'>;

type VisibilityGroupPayload = {
  name: string;
  description?: string | null;
  boardIds?: string[];
  ticketScope?: 'client' | 'contact';
  assetScope?: 'client' | 'contact';
  projectScope?: 'client' | 'contact';
};

function isVisibilityScope(value: unknown): boolean {
  return value === undefined || value === 'client' || value === 'contact';
}

function hasValidVisibilityScopes(input: VisibilityGroupPayload): boolean {
  return isVisibilityScope(input.ticketScope) && isVisibilityScope(input.assetScope) && isVisibilityScope(input.projectScope);
}

type VisibilityGroupActionError = ActionMessageError | ActionPermissionError;

function visibilityGroupActionErrorFrom(error: unknown): VisibilityGroupActionError | null {
  const localized = localizedContactActionError(error);
  if (localized) return localized;
  if (error instanceof Error) {
    const message = error.message;
    if (message.includes('Permission denied:')) {
      return permissionError(message);
    }
    if (message.startsWith('Validation error:')) {
      return actionError(message.replace(/^Validation error:\s*/, ''));
    }
    if (message === 'Cannot manage contacts for another client') {
      return permissionError('Permission denied: Cannot manage contacts for another client', 'msp/contacts:errors.contact.otherClient');
    }
    if (
      message === 'Contact not found' ||
      message === 'Contact is not associated with a client' ||
      message === 'Assigned visibility group is invalid for this contact' ||
      message === 'Visibility group not found' ||
      message === 'One or more boards are invalid for this tenant' ||
      message === 'Cannot delete visibility group while it is assigned to contacts'
    ) {
      return actionError(message);
    }
  }

  const dbError = error as { code?: string; column?: string; constraint?: string };
  if (dbError?.code === '23502') {
    return dbError.column
      ? actionError(
          `Missing required visibility group field: ${dbError.column}.`,
          'msp/contacts:errors.contact.visibilityMissingFieldNamed',
          { field: dbError.column },
        )
      : actionError('Missing required visibility group field.', 'msp/contacts:errors.contact.visibilityMissingField');
  }
  if (dbError?.code === '23503') {
    return actionError('The selected contact, visibility group, or board is no longer valid. Please refresh and try again.', 'msp/contacts:errors.contact.visibilityReferenceInvalid');
  }
  if (dbError?.code === '23505') {
    return actionError('A visibility group with these details already exists for this client.', 'msp/contacts:errors.contact.visibilityDuplicate');
  }
  if (dbError?.code === '23514') {
    return actionError('Invalid visibility group data provided. Please check the group details and selected boards.', 'msp/contacts:errors.contact.visibilityInvalidData');
  }

  return null;
}

async function resolveContactClientId(
  trx: Knex.Transaction,
  tenant: string,
  contactId: string
): Promise<string> {
  const contact = await tenantScopedTable(trx, 'contacts', tenant)
    .where({ contact_name_id: contactId })
    .first('contact_name_id', 'client_id');

  if (!contact) {
    throw await contactError('errors.contact.notFound');
  }

  if (!contact.client_id) {
    throw await contactError('errors.contact.notAssociatedWithClient');
  }

  return contact.client_id;
}

async function getClientPortalAdminClientId(
  user: any,
  trx: Knex.Transaction,
  tenant: string
): Promise<string> {
  if (!isClientPortalUser(user) || !user.contact_id) {
    throw await contactError('errors.contact.portalAdminRequired', 'Permission denied: ');
  }

  const actorContact = await tenantScopedTable(trx, 'contacts', tenant)
    .where({
      contact_name_id: user.contact_id
    })
    .select('client_id', 'is_client_admin')
    .first();

  if (!actorContact?.is_client_admin || !actorContact.client_id) {
    throw await contactError('errors.contact.portalAdminRequired', 'Permission denied: ');
  }

  return actorContact.client_id;
}

async function resolveContactAndVerifyPermission(
  user: any,
  trx: Knex.Transaction,
  tenant: string,
  contactId: string,
  resource: string = 'contact',
  action: string = 'update',
  message?: string
): Promise<string> {
  message ??= `Permission denied: ${await contactText('errors.contact.permissions.updateContacts')}`;
  if (isMspUser(user)) {
    await assertMspPermission(user, resource, action, message, trx);
    return resolveContactClientId(trx, tenant, contactId);
  }

  if (!isClientPortalUser(user)) {
    throw new Error(message);
  }

  const actorClientId = await getClientPortalAdminClientId(user, trx, tenant);
  await assertMspOrClientPortalOwnClientPermission(
    user,
    tenant,
    actorClientId,
    resource,
    action,
    message,
    trx
  );

  const targetClientId = await resolveContactClientId(trx, tenant, contactId);
  if (targetClientId !== actorClientId) {
    throw await contactError('errors.contact.otherClient');
  }

  return targetClientId;
}

async function ensureContactPortalGroupsScope(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string,
  groupId: string
): Promise<void> {
  const group = await tenantScopedTable(trx, 'client_portal_visibility_groups', tenant)
    .where({ client_id: clientId, group_id: groupId })
    .first('group_id');

  if (!group) {
    throw await contactError('errors.contact.assignedGroupInvalid');
  }
}

export const getClientPortalVisibilityGroupsForContact = withAuth(async (
  user,
  { tenant },
  contactId: string
): Promise<VisibilityGroupListItem[] | VisibilityGroupActionError> => {
  try {
    const { knex } = await createTenantKnex();

    return withTransaction(knex, async (trx: Knex.Transaction) => {
      const clientId = await resolveContactAndVerifyPermission(user, trx, tenant, contactId);

      const groups = await tenantScopedTable(trx, 'client_portal_visibility_groups', tenant)
        .where({ client_id: clientId })
        .select('group_id', 'name', 'description', 'ticket_scope', 'asset_scope', 'project_scope')
        .orderBy('name') as VisibilityGroupRow[];

      const boardCounts = groups.length
        ? await tenantScopedTable(trx, 'client_portal_visibility_group_boards', tenant)
          .whereIn('group_id', groups.map((group) => group.group_id))
          .count('board_id as board_count')
          .select('group_id')
          .groupBy('group_id')
        : [];

      const boardCountRows = boardCounts as Array<{ group_id: string; board_count: string | number }>;
      const boardCountMap = new Map<string, number>(
        boardCountRows.map((row) => [
          row.group_id,
          Number(row.board_count)
        ])
      );

      return groups.map((group) => ({
        ...group,
        board_count: boardCountMap.get(group.group_id) || 0
      }));
    });
  } catch (error) {
    const expected = visibilityGroupActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('[contactActions.getClientPortalVisibilityGroupsForContact]', error);
    throw error;
  }
});

/** Number of people (transitively) reporting to this contact; drives the portal tab's "also sees" note. */
export const getContactReportCount = withAuth(async (
  user,
  { tenant },
  contactId: string
): Promise<number | VisibilityGroupActionError> => {
  try {
    const { knex } = await createTenantKnex();

    return withTransaction(knex, async (trx: Knex.Transaction) => {
      const clientId = await resolveContactAndVerifyPermission(user, trx, tenant, contactId);

      const edges = await tenantScopedTable(trx, 'contacts', tenant)
        .where({ client_id: clientId })
        .whereNotNull('manager_contact_id')
        .select('contact_name_id', 'manager_contact_id') as Array<{ contact_name_id: string; manager_contact_id: string | null }>;

      return collectReportContactIds(edges, contactId).size;
    });
  } catch (error) {
    const expected = visibilityGroupActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('[contactActions.getContactReportCount]', error);
    throw error;
  }
});

export const getClientPortalVisibilityBoardsByClient = withAuth(async (
  user,
  { tenant },
  contactId: string
): Promise<IBoard[] | VisibilityGroupActionError> => {
  try {
    const { knex } = await createTenantKnex();

    return withTransaction(knex, async (trx: Knex.Transaction) => {
      await resolveContactAndVerifyPermission(user, trx, tenant, contactId);

      return tenantScopedTable(trx, 'boards', tenant)
        .andWhere('is_inactive', false)
        .select('board_id', 'board_name');
    });
  } catch (error) {
    const expected = visibilityGroupActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('[contactActions.getClientPortalVisibilityBoardsByClient]', error);
    throw error;
  }
});

export const getClientPortalVisibilityGroupById = withAuth(async (
  user,
  { tenant },
  contactId: string,
  groupId: string
): Promise<{ group_id: string; name: string; description: string | null; board_ids: string[]; ticket_scope: 'client' | 'contact'; asset_scope: 'client' | 'contact'; project_scope: 'client' | 'contact' } | VisibilityGroupActionError> => {
  try {
    const { knex } = await createTenantKnex();

    return withTransaction(knex, async (trx: Knex.Transaction) => {
      const clientId = await resolveContactAndVerifyPermission(user, trx, tenant, contactId);

      const group = await tenantScopedTable(trx, 'client_portal_visibility_groups', tenant)
        .where({ client_id: clientId, group_id: groupId })
        .first('group_id', 'name', 'description', 'ticket_scope', 'asset_scope', 'project_scope');

      if (!group) {
        throw await contactError('errors.contact.groupNotFound');
      }

      const rows = await tenantScopedTable(trx, 'client_portal_visibility_group_boards', tenant)
        .where({ group_id: groupId })
        .select('board_id') as Array<{ board_id: string }>;

      return {
        ...group,
        board_ids: rows.map((row) => row.board_id)
      };
    });
  } catch (error) {
    const expected = visibilityGroupActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    console.error('[contactActions.getClientPortalVisibilityGroupById]', error);
    throw error;
  }
});

async function ensureBoardsAreActiveInTenant(
  trx: Knex.Transaction,
  tenant: string,
  boardIds: string[]
): Promise<void> {
  if (boardIds.length === 0) {
    return;
  }

  const validBoardCount = await tenantScopedTable(trx, 'boards', tenant)
    .andWhere('is_inactive', false)
    .whereIn('board_id', boardIds)
    .count('* as count')
    .first();

  if (Number(validBoardCount?.count || 0) !== boardIds.length) {
    throw await contactError('errors.contact.boardsInvalid');
  }
}

async function ensureBoardsAreActiveOrAlreadyAssignedToGroup(
  trx: Knex.Transaction,
  tenant: string,
  groupId: string,
  boardIds: string[]
): Promise<void> {
  if (boardIds.length === 0) {
    return;
  }

  const activeRows = await tenantScopedTable(trx, 'boards', tenant)
    .andWhere('is_inactive', false)
    .whereIn('board_id', boardIds)
    .select('board_id') as Array<{ board_id: string }>;

  const existingMembershipRows = await tenantScopedTable(trx, 'client_portal_visibility_group_boards', tenant)
    .where({ group_id: groupId })
    .whereIn('board_id', boardIds)
    .select('board_id') as Array<{ board_id: string }>;

  const allowedBoardIds = new Set<string>([
    ...activeRows.map((row) => row.board_id),
    ...existingMembershipRows.map((row) => row.board_id),
  ]);

  if (boardIds.some((boardId) => !allowedBoardIds.has(boardId))) {
    throw await contactError('errors.contact.boardsInvalid');
  }
}

export const createClientPortalVisibilityGroupForContact = withAuth(async (
  user,
  { tenant },
  contactId: string,
  input: VisibilityGroupPayload
): Promise<{ group_id: string } | VisibilityGroupActionError> => {
  if (!hasValidVisibilityScopes(input)) {
    return actionError('Invalid visibility group data provided.', 'msp/contacts:errors.contact.visibilityInvalidData');
  }
  const name = input.name?.trim();
  if (!name) {
    return actionError('Group name is required', 'msp/contacts:errors.contact.groupNameRequired');
  }

  const { knex } = await createTenantKnex();
  const boardIds = Array.from(new Set((input.boardIds ?? []).filter(Boolean)));

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const clientId = await resolveContactAndVerifyPermission(user, trx, tenant, contactId);

      await ensureBoardsAreActiveInTenant(trx, tenant, boardIds);

      const [group] = await tenantScopedTable(trx, 'client_portal_visibility_groups', tenant)
        .insert({
          tenant,
          client_id: clientId,
          name,
          description: input.description?.trim() || null,
          ticket_scope: input.ticketScope ?? 'client',
          asset_scope: input.assetScope ?? 'client',
          project_scope: input.projectScope ?? 'client',
        })
        .returning('group_id');

      if (!group?.group_id) {
        throw new Error(await contactText('errors.contact.groupCreateFailed'));
      }

      if (boardIds.length > 0) {
        await tenantScopedTable(trx, 'client_portal_visibility_group_boards', tenant)
          .insert(boardIds.map((boardId) => ({
            tenant,
            group_id: group.group_id,
            board_id: boardId
          })));
      }

      return { group_id: group.group_id };
    });
  } catch (error) {
    const expected = visibilityGroupActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const updateClientPortalVisibilityGroupForContact = withAuth(async (
  user,
  { tenant },
  contactId: string,
  groupId: string,
  input: VisibilityGroupPayload
): Promise<void | VisibilityGroupActionError> => {
  if (!hasValidVisibilityScopes(input)) {
    return actionError('Invalid visibility group data provided.', 'msp/contacts:errors.contact.visibilityInvalidData');
  }
  const name = input.name?.trim();
  if (!name) {
    return actionError('Group name is required', 'msp/contacts:errors.contact.groupNameRequired');
  }

  const boardIds = Array.from(new Set((input.boardIds ?? []).filter(Boolean)));
  const { knex } = await createTenantKnex();

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const clientId = await resolveContactAndVerifyPermission(user, trx, tenant, contactId);

      const existing = await tenantScopedTable(trx, 'client_portal_visibility_groups', tenant)
        .where({ client_id: clientId, group_id: groupId })
        .first('group_id');

      if (!existing) {
        throw await contactError('errors.contact.groupNotFound');
      }

      await ensureBoardsAreActiveOrAlreadyAssignedToGroup(trx, tenant, groupId, boardIds);

      await tenantScopedTable(trx, 'client_portal_visibility_groups', tenant)
        .where({ group_id: groupId })
        .update({
          name,
          description: input.description?.trim() || null,
          ...(input.ticketScope !== undefined ? { ticket_scope: input.ticketScope } : {}),
          ...(input.assetScope !== undefined ? { asset_scope: input.assetScope } : {}),
          ...(input.projectScope !== undefined ? { project_scope: input.projectScope } : {}),
          updated_at: new Date().toISOString()
        });

      await tenantScopedTable(trx, 'client_portal_visibility_group_boards', tenant)
        .where({ group_id: groupId })
        .delete();

      if (boardIds.length > 0) {
        await tenantScopedTable(trx, 'client_portal_visibility_group_boards', tenant)
          .insert(boardIds.map((boardId) => ({
            tenant,
            group_id: groupId,
            board_id: boardId
          })));
      }
    });
  } catch (error) {
    const expected = visibilityGroupActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const deleteClientPortalVisibilityGroupForContact = withAuth(async (
  user,
  { tenant },
  contactId: string,
  groupId: string
): Promise<void | VisibilityGroupActionError> => {
  const { knex } = await createTenantKnex();

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const clientId = await resolveContactAndVerifyPermission(user, trx, tenant, contactId);

      const existing = await tenantScopedTable(trx, 'client_portal_visibility_groups', tenant)
        .where({ client_id: clientId, group_id: groupId })
        .first('group_id');

      if (!existing) {
        throw await contactError('errors.contact.groupNotFound');
      }

      const assignedCount = await tenantScopedTable(trx, 'contacts', tenant)
        .where({ client_id: clientId, portal_visibility_group_id: groupId })
        .count('contact_name_id as count')
        .first();

      if (Number(assignedCount?.count || 0) > 0) {
        throw await contactError('errors.contact.groupInUse');
      }

      await tenantScopedTable(trx, 'client_portal_visibility_group_boards', tenant)
        .where({ group_id: groupId })
        .delete();

      await tenantScopedTable(trx, 'client_portal_visibility_groups', tenant)
        .where({ group_id: groupId })
        .delete();
    });
  } catch (error) {
    const expected = visibilityGroupActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const assignClientPortalVisibilityGroupToContact = withAuth(async (
  user,
  { tenant },
  contactId: string,
  groupId: string | null
): Promise<void | VisibilityGroupActionError> => {
  const { knex } = await createTenantKnex();

  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const clientId = await resolveContactAndVerifyPermission(user, trx, tenant, contactId);

      if (groupId) {
        await ensureContactPortalGroupsScope(trx, tenant, clientId, groupId);
      }

      await tenantScopedTable(trx, 'contacts', tenant)
        .where({ contact_name_id: contactId })
        .update({
          portal_visibility_group_id: groupId,
          updated_at: new Date().toISOString()
        });
    });
  } catch (error) {
    const expected = visibilityGroupActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});
