'use server'

import type { IContactPhoneNumber, CreateContactPhoneNumberInput, UpdateContactPhoneNumberInput } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { v4 as uuidv4 } from 'uuid';

// =============================================================================
// PRIVATE HELPERS
// =============================================================================

/**
 * Syncs the denormalized contacts.phone_number field with the primary phone number.
 */
async function syncContactPrimaryPhone(
  contactId: string,
  tenant: string,
  trx: Knex.Transaction
): Promise<void> {
  const primary = await trx('contact_phone_numbers')
    .where({ contact_id: contactId, tenant, is_primary: true })
    .first();

  await trx('contacts')
    .where({ contact_name_id: contactId, tenant })
    .update({
      phone_number: primary ? primary.phone_number : null,
      updated_at: new Date().toISOString()
    });
}

/**
 * Ensures exactly one primary phone number exists for a contact.
 * If none is primary, sets the first one as primary.
 */
async function ensurePrimaryExists(
  contactId: string,
  tenant: string,
  trx: Knex.Transaction
): Promise<void> {
  const primaryExists = await trx('contact_phone_numbers')
    .where({ contact_id: contactId, tenant, is_primary: true })
    .first();

  if (!primaryExists) {
    const first = await trx('contact_phone_numbers')
      .where({ contact_id: contactId, tenant })
      .orderBy('created_at', 'asc')
      .first();

    if (first) {
      await trx('contact_phone_numbers')
        .where({ phone_number_id: first.phone_number_id, tenant })
        .update({ is_primary: true, updated_at: new Date().toISOString() });
    }
  }
}

// =============================================================================
// PUBLIC SERVER ACTIONS
// =============================================================================

/**
 * Get all phone numbers for a contact.
 */
export const getPhoneNumbersByContact = withAuth(async (
  _user,
  { tenant },
  contactId: string
): Promise<IContactPhoneNumber[]> => {
  const { knex: db } = await createTenantKnex();

  try {
    const tableExists = await db.schema.hasTable('contact_phone_numbers');
    if (!tableExists) return [];

    const phoneNumbers = await db('contact_phone_numbers')
      .where({ contact_id: contactId, tenant })
      .orderByRaw('is_primary DESC, created_at ASC');

    return phoneNumbers as IContactPhoneNumber[];
  } catch {
    return [];
  }
});

/**
 * Add a phone number to a contact.
 */
export const addContactPhoneNumber = withAuth(async (
  _user,
  { tenant },
  contactId: string,
  data: CreateContactPhoneNumberInput
): Promise<IContactPhoneNumber> => {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    // Validate phone number is not blank
    if (!data.phone_number || data.phone_number.trim() === '') {
      throw new Error('VALIDATION_ERROR: Phone number is required');
    }

    // Verify contact exists
    const contact = await trx('contacts')
      .where({ contact_name_id: contactId, tenant })
      .first();

    if (!contact) {
      throw new Error('VALIDATION_ERROR: Contact not found');
    }

    // Check if this type already exists for this contact
    if (data.phone_type) {
      const existing = await trx('contact_phone_numbers')
        .where({ contact_id: contactId, tenant, phone_type: data.phone_type })
        .first();

      if (existing) {
        throw new Error(`VALIDATION_ERROR: A ${data.phone_type} phone number already exists for this contact`);
      }
    }

    // Count existing numbers
    const countResult = await trx('contact_phone_numbers')
      .where({ contact_id: contactId, tenant })
      .count('* as count')
      .first();
    const existingCount = parseInt(String(countResult?.count || 0), 10);

    // If this is the first number, force primary
    const isPrimary = existingCount === 0 ? true : (data.is_primary || false);

    // If setting as primary, clear other primaries first
    if (isPrimary && existingCount > 0) {
      await trx('contact_phone_numbers')
        .where({ contact_id: contactId, tenant })
        .update({ is_primary: false, updated_at: new Date().toISOString() });
    }

    const now = new Date().toISOString();
    const phoneNumberId = uuidv4();

    const insertData = {
      tenant,
      phone_number_id: phoneNumberId,
      contact_id: contactId,
      phone_type: data.phone_type || 'Office',
      phone_number: data.phone_number,
      extension: data.extension || null,
      country_code: data.country_code || null,
      is_primary: isPrimary,
      created_at: now,
      updated_at: now
    };

    const [created] = await trx('contact_phone_numbers')
      .insert(insertData)
      .returning('*');

    // Sync the denormalized primary phone on contacts table
    await syncContactPrimaryPhone(contactId, tenant, trx);

    return created as IContactPhoneNumber;
  });
});

/**
 * Update a phone number.
 */
export const updateContactPhoneNumber = withAuth(async (
  _user,
  { tenant },
  phoneNumberId: string,
  data: UpdateContactPhoneNumberInput
): Promise<IContactPhoneNumber> => {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const existing = await trx('contact_phone_numbers')
      .where({ phone_number_id: phoneNumberId, tenant })
      .first();

    if (!existing) {
      throw new Error('VALIDATION_ERROR: Phone number not found');
    }

    // If changing phone_type, check for duplicates
    if (data.phone_type && data.phone_type !== existing.phone_type) {
      const duplicate = await trx('contact_phone_numbers')
        .where({ contact_id: existing.contact_id, tenant, phone_type: data.phone_type })
        .whereNot('phone_number_id', phoneNumberId)
        .first();

      if (duplicate) {
        throw new Error(`VALIDATION_ERROR: A ${data.phone_type} phone number already exists for this contact`);
      }
    }

    // If setting as primary, clear other primaries
    if (data.is_primary === true) {
      await trx('contact_phone_numbers')
        .where({ contact_id: existing.contact_id, tenant })
        .whereNot('phone_number_id', phoneNumberId)
        .update({ is_primary: false, updated_at: new Date().toISOString() });
    }

    const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
    if (data.phone_type !== undefined) updateData.phone_type = data.phone_type;
    if (data.phone_number !== undefined) updateData.phone_number = data.phone_number;
    if (data.extension !== undefined) updateData.extension = data.extension || null;
    if (data.country_code !== undefined) updateData.country_code = data.country_code || null;
    if (data.is_primary !== undefined) updateData.is_primary = data.is_primary;

    const [updated] = await trx('contact_phone_numbers')
      .where({ phone_number_id: phoneNumberId, tenant })
      .update(updateData)
      .returning('*');

    // Sync the denormalized primary phone
    await syncContactPrimaryPhone(existing.contact_id, tenant, trx);

    return updated as IContactPhoneNumber;
  });
});

/**
 * Delete a phone number. Blocks deletion of the last remaining number.
 */
export const deleteContactPhoneNumber = withAuth(async (
  _user,
  { tenant },
  phoneNumberId: string
): Promise<void> => {
  const { knex: db } = await createTenantKnex();

  await withTransaction(db, async (trx: Knex.Transaction) => {
    const existing = await trx('contact_phone_numbers')
      .where({ phone_number_id: phoneNumberId, tenant })
      .first();

    if (!existing) {
      throw new Error('VALIDATION_ERROR: Phone number not found');
    }

    // Count remaining numbers for this contact
    const countResult = await trx('contact_phone_numbers')
      .where({ contact_id: existing.contact_id, tenant })
      .count('* as count')
      .first();
    const count = parseInt(String(countResult?.count || 0), 10);

    if (count <= 1) {
      throw new Error('VALIDATION_ERROR: Cannot delete the last phone number for a contact');
    }

    // Delete the phone number
    await trx('contact_phone_numbers')
      .where({ phone_number_id: phoneNumberId, tenant })
      .delete();

    // If deleted number was primary, assign a new primary
    if (existing.is_primary) {
      await ensurePrimaryExists(existing.contact_id, tenant, trx);
    }

    // Sync the denormalized primary phone
    await syncContactPrimaryPhone(existing.contact_id, tenant, trx);
  });
});

/**
 * Set a phone number as the primary for its contact.
 */
export const setPrimaryPhoneNumber = withAuth(async (
  _user,
  { tenant },
  phoneNumberId: string
): Promise<void> => {
  const { knex: db } = await createTenantKnex();

  await withTransaction(db, async (trx: Knex.Transaction) => {
    const existing = await trx('contact_phone_numbers')
      .where({ phone_number_id: phoneNumberId, tenant })
      .first();

    if (!existing) {
      throw new Error('VALIDATION_ERROR: Phone number not found');
    }

    // Clear all primaries for this contact
    await trx('contact_phone_numbers')
      .where({ contact_id: existing.contact_id, tenant })
      .update({ is_primary: false, updated_at: new Date().toISOString() });

    // Set this one as primary
    await trx('contact_phone_numbers')
      .where({ phone_number_id: phoneNumberId, tenant })
      .update({ is_primary: true, updated_at: new Date().toISOString() });

    // Sync the denormalized primary phone
    await syncContactPrimaryPhone(existing.contact_id, tenant, trx);
  });
});

/**
 * Batch save phone numbers for a contact.
 * Performs a diff-based sync: inserts new, updates changed, deletes removed.
 */
export const saveContactPhoneNumbers = withAuth(async (
  _user,
  { tenant },
  contactId: string,
  phoneNumbers: Array<Partial<IContactPhoneNumber> & { phone_number: string; phone_type: string }>
): Promise<IContactPhoneNumber[]> => {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    // Guard: table may not exist if migration hasn't run
    const tableExists = await trx.schema.hasTable('contact_phone_numbers');
    if (!tableExists) return [];

    // Filter out blank phone numbers before processing
    phoneNumbers = phoneNumbers.filter(pn => pn.phone_number && pn.phone_number.trim() !== '');
    if (phoneNumbers.length === 0) return [];

    // Verify contact exists
    const contact = await trx('contacts')
      .where({ contact_name_id: contactId, tenant })
      .first();

    if (!contact) {
      throw new Error('VALIDATION_ERROR: Contact not found');
    }

    // Fetch current phone numbers
    const current = await trx('contact_phone_numbers')
      .where({ contact_id: contactId, tenant });

    const currentIds = new Set(current.map((p: any) => p.phone_number_id));
    const currentByType = new Map(current.map((p: any) => [p.phone_type, p]));
    const isRealId = (id?: string) => id && !id.startsWith('temp-') && !id.startsWith('legacy-');
    const incomingIds = new Set(
      phoneNumbers
        .filter(p => isRealId(p.phone_number_id))
        .map(p => p.phone_number_id)
    );

    // Collect incoming types to know which current entries to keep
    const incomingTypes = new Set(phoneNumbers.map(p => p.phone_type));

    // Delete removed phone numbers (ones in current whose type is not in incoming)
    const toDelete = current.filter((p: any) => !incomingIds.has(p.phone_number_id) && !incomingTypes.has(p.phone_type));
    if (toDelete.length > 0 && toDelete.length < current.length) {
      await trx('contact_phone_numbers')
        .whereIn('phone_number_id', toDelete.map((p: any) => p.phone_number_id))
        .where({ tenant })
        .delete();
    }

    const now = new Date().toISOString();
    const results: IContactPhoneNumber[] = [];

    // Enforce exactly one primary: if none, set first; if multiple, keep only first
    const primaryIndices = phoneNumbers
      .map((p, i) => p.is_primary ? i : -1)
      .filter(i => i !== -1);

    if (primaryIndices.length === 0 && phoneNumbers.length > 0) {
      phoneNumbers[0].is_primary = true;
    } else if (primaryIndices.length > 1) {
      // Keep only the first primary, clear the rest
      for (let i = 1; i < primaryIndices.length; i++) {
        phoneNumbers[primaryIndices[i]].is_primary = false;
      }
    }

    for (const pn of phoneNumbers) {
      const isExisting = pn.phone_number_id && currentIds.has(pn.phone_number_id);
      // Also match by type for legacy/temp IDs that correspond to migrated data
      const existingByType = !isExisting ? currentByType.get(pn.phone_type) : null;

      if (isExisting) {
        // Update existing by ID
        const [updated] = await trx('contact_phone_numbers')
          .where({ phone_number_id: pn.phone_number_id, tenant })
          .update({
            phone_type: pn.phone_type,
            phone_number: pn.phone_number,
            extension: pn.extension || null,
            country_code: pn.country_code || null,
            is_primary: pn.is_primary || false,
            updated_at: now
          })
          .returning('*');
        results.push(updated as IContactPhoneNumber);
      } else if (existingByType) {
        // Update existing by type match (legacy/temp ID but same type exists in DB)
        const [updated] = await trx('contact_phone_numbers')
          .where({ phone_number_id: existingByType.phone_number_id, tenant })
          .update({
            phone_type: pn.phone_type,
            phone_number: pn.phone_number,
            extension: pn.extension || null,
            country_code: pn.country_code || null,
            is_primary: pn.is_primary || false,
            updated_at: now
          })
          .returning('*');
        // Remove from map so it's not matched again
        currentByType.delete(pn.phone_type);
        results.push(updated as IContactPhoneNumber);
      } else {
        // Insert new
        const phoneNumberId = uuidv4();
        const [created] = await trx('contact_phone_numbers')
          .insert({
            tenant,
            phone_number_id: phoneNumberId,
            contact_id: contactId,
            phone_type: pn.phone_type || 'Office',
            phone_number: pn.phone_number,
            extension: pn.extension || null,
            country_code: pn.country_code || null,
            is_primary: pn.is_primary || false,
            created_at: now,
            updated_at: now
          })
          .returning('*');
        results.push(created as IContactPhoneNumber);
      }
    }

    // Sync the denormalized primary phone
    await syncContactPrimaryPhone(contactId, tenant, trx);

    return results;
  });
});
