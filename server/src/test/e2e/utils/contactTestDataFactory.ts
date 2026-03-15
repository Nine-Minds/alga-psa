import { Knex } from 'knex';
import { faker } from '@faker-js/faker';
import { ContactModel, type CreateContactInput, type UpdateContactInput } from '@alga-psa/shared/models/contactModel';
import type { ContactEmailAddressInput, ContactEmailCanonicalType } from '@alga-psa/shared/interfaces/contact.interfaces';
import type { IContact } from '@alga-psa/types';

/**
 * Contact interface matching database schema
 */
export type TestContact = IContact;

/**
 * Contact creation options
 */
export interface CreateContactOptions {
  full_name?: string;
  client_id?: string | null;
  phone_number?: string | null;
  email?: string;
  primary_email_canonical_type?: ContactEmailCanonicalType | null;
  primary_email_custom_type?: string | null;
  additional_email_addresses?: ContactEmailAddressInput[];
  role?: string | null;
  is_inactive?: boolean;
  notes?: string | null;
}

function buildPhoneNumbers(phoneNumber?: string | null): CreateContactInput['phone_numbers'] {
  if (!phoneNumber?.trim()) {
    return [];
  }

  return [{
    phone_number: phoneNumber.trim(),
    canonical_type: 'work',
    is_default: true,
    display_order: 0,
  }];
}

function buildAdditionalEmailAddresses(
  rows?: ContactEmailAddressInput[]
): CreateContactInput['additional_email_addresses'] {
  return (rows ?? []).map((row, index) => ({
    ...row,
    display_order: row.display_order ?? index,
  }));
}

/**
 * Generate random contact data
 */
export function generateContactData(options: CreateContactOptions = {}): Omit<CreateContactOptions, 'client_id'> {
  return {
    full_name: options.full_name || faker.person.fullName(),
    phone_number: options.phone_number !== undefined ? options.phone_number : faker.phone.number(),
    email: options.email || faker.internet.email().toLowerCase(),
    primary_email_canonical_type:
      options.primary_email_canonical_type ?? (options.primary_email_custom_type ? null : 'work'),
    primary_email_custom_type: options.primary_email_custom_type ?? null,
    additional_email_addresses: buildAdditionalEmailAddresses(options.additional_email_addresses),
    role: options.role !== undefined ? options.role : faker.person.jobTitle(),
    is_inactive: options.is_inactive ?? false,
    notes: options.notes !== undefined ? options.notes : faker.lorem.sentence()
  };
}

/**
 * Create a single contact in the database
 * @param db Knex database instance
 * @param tenant Tenant ID
 * @param options Contact creation options
 * @returns The created contact
 */
export async function createTestContact(
  db: Knex,
  tenant: string,
  options: CreateContactOptions = {}
): Promise<TestContact> {
  const contactData = generateContactData(options);

  return db.transaction((trx) => ContactModel.createContact({
    full_name: contactData.full_name || '',
    email: contactData.email || '',
    primary_email_canonical_type:
      contactData.primary_email_canonical_type ?? (contactData.primary_email_custom_type ? null : 'work'),
    primary_email_custom_type: contactData.primary_email_custom_type || undefined,
    additional_email_addresses: buildAdditionalEmailAddresses(contactData.additional_email_addresses),
    client_id: options.client_id !== undefined ? options.client_id || undefined : undefined,
    phone_numbers: buildPhoneNumbers(contactData.phone_number),
    role: contactData.role || undefined,
    notes: contactData.notes || undefined,
    is_inactive: contactData.is_inactive ?? false,
  }, tenant, trx));
}

/**
 * Create multiple contacts in the database
 * @param db Knex database instance
 * @param tenant Tenant ID
 * @param count Number of contacts to create
 * @param options Contact creation options (applied to all contacts)
 * @returns Array of created contacts
 */
export async function createTestContacts(
  db: Knex,
  tenant: string,
  count: number,
  options: CreateContactOptions = {}
): Promise<TestContact[]> {
  const contacts: TestContact[] = [];
  
  for (let i = 0; i < count; i++) {
    const contact = await createTestContact(db, tenant, options);
    contacts.push(contact);
  }
  
  return contacts;
}

/**
 * Create contacts with specific attributes for testing
 */
export async function createTestContactSet(
  db: Knex,
  tenant: string,
  clientId?: string
): Promise<{
  activeContacts: TestContact[];
  inactiveContacts: TestContact[];
  contactsWithClient: TestContact[];
  contactsWithoutClient: TestContact[];
  contactsWithRoles: TestContact[];
}> {
  // Create active contacts
  const activeContacts = await createTestContacts(db, tenant, 3, {
    is_inactive: false,
    client_id: clientId
  });

  // Create inactive contacts
  const inactiveContacts = await createTestContacts(db, tenant, 2, {
    is_inactive: true,
    client_id: clientId
  });

  // Create contacts with client
  const contactsWithClient = clientId ? 
    await createTestContacts(db, tenant, 2, { client_id: clientId }) : [];

  // Create contacts without client
  const contactsWithoutClient = await createTestContacts(db, tenant, 2, {
    client_id: null
  });

  // Create contacts with specific roles
  const contactsWithRoles = await Promise.all([
    createTestContact(db, tenant, { role: 'CEO', client_id: clientId }),
    createTestContact(db, tenant, { role: 'CTO', client_id: clientId }),
    createTestContact(db, tenant, { role: 'Manager', client_id: clientId })
  ]);

  return {
    activeContacts,
    inactiveContacts,
    contactsWithClient,
    contactsWithoutClient,
    contactsWithRoles
  };
}

/**
 * Create a contact with specific email for testing
 */
export async function createContactWithEmail(
  db: Knex,
  tenant: string,
  email: string,
  options: Omit<CreateContactOptions, 'email'> = {}
): Promise<TestContact> {
  return createTestContact(db, tenant, {
    ...options,
    email
  });
}

/**
 * Create a contact with specific phone number for testing
 */
export async function createContactWithPhone(
  db: Knex,
  tenant: string,
  phone_number: string,
  options: Omit<CreateContactOptions, 'phone_number'> = {}
): Promise<TestContact> {
  return createTestContact(db, tenant, {
    ...options,
    phone_number
  });
}

/**
 * Create contacts for pagination testing
 */
export async function createContactsForPagination(
  db: Knex,
  tenant: string,
  count: number = 30
): Promise<TestContact[]> {
  const contacts: TestContact[] = [];
  
  // Create contacts with predictable names for sorting tests
  for (let i = 0; i < count; i++) {
    const contact = await createTestContact(db, tenant, {
      full_name: `Test Contact ${String(i + 1).padStart(3, '0')}`,
      email: `contact${i + 1}@test.com`
    });
    contacts.push(contact);
  }
  
  return contacts;
}

/**
 * Clean up test contacts
 * @param db Knex database instance
 * @param tenant Tenant ID
 */
export async function cleanupTestContacts(db: Knex, tenant: string): Promise<void> {
  await db('contacts')
    .where('tenant', tenant)
    .delete();
}

/**
 * Clean up specific test contacts by IDs
 * @param db Knex database instance
 * @param tenant Tenant ID
 * @param contactIds Array of contact IDs to delete
 */
export async function cleanupTestContactsByIds(
  db: Knex,
  tenant: string,
  contactIds: string[]
): Promise<void> {
  if (contactIds.length === 0) return;
  
  await db('contacts')
    .where('tenant', tenant)
    .whereIn('contact_name_id', contactIds)
    .delete();
}

/**
 * Get contact by ID from database
 */
export async function getTestContactById(
  db: Knex,
  tenant: string,
  contactId: string
): Promise<TestContact | null> {
  return db.transaction((trx) => ContactModel.getContactById(contactId, tenant, trx));
}

/**
 * Update contact in database
 */
export async function updateTestContact(
  db: Knex,
  tenant: string,
  contactId: string,
  updates: Partial<CreateContactOptions>
): Promise<TestContact | null> {
  return db.transaction(async (trx) => {
    const updateInput: UpdateContactInput = {
      ...('full_name' in updates ? { full_name: updates.full_name } : {}),
      ...('client_id' in updates ? { client_id: updates.client_id || undefined } : {}),
      ...('phone_number' in updates ? { phone_numbers: buildPhoneNumbers(updates.phone_number) } : {}),
      ...('email' in updates ? { email: updates.email || undefined } : {}),
      ...('primary_email_canonical_type' in updates
        ? { primary_email_canonical_type: updates.primary_email_canonical_type ?? null }
        : {}),
      ...('primary_email_custom_type' in updates
        ? { primary_email_custom_type: updates.primary_email_custom_type || undefined }
        : {}),
      ...('additional_email_addresses' in updates
        ? { additional_email_addresses: buildAdditionalEmailAddresses(updates.additional_email_addresses) }
        : {}),
      ...('role' in updates ? { role: updates.role || undefined } : {}),
      ...('is_inactive' in updates ? { is_inactive: updates.is_inactive } : {}),
      ...('notes' in updates ? { notes: updates.notes || undefined } : {}),
    };

    return ContactModel.updateContact(contactId, updateInput, tenant, trx);
  });
}
