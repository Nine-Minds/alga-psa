import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { faker } from '@faker-js/faker';

/**
 * Contact interface matching database schema
 */
export interface TestContact {
  contact_name_id: string;
  full_name: string;
  company_id: string | null;
  phone_number: string | null;
  email: string;
  role: string | null;
  created_at: string;
  updated_at: string;
  is_inactive: boolean;
  notes: string | null;
  tenant: string;
}

/**
 * Contact creation options
 */
export interface CreateContactOptions {
  full_name?: string;
  company_id?: string | null;
  phone_number?: string | null;
  email?: string;
  role?: string | null;
  is_inactive?: boolean;
  notes?: string | null;
}

/**
 * Generate random contact data
 */
export function generateContactData(options: CreateContactOptions = {}): Omit<CreateContactOptions, 'company_id'> {
  return {
    full_name: options.full_name || faker.person.fullName(),
    phone_number: options.phone_number !== undefined ? options.phone_number : faker.phone.number(),
    email: options.email || faker.internet.email().toLowerCase(),
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
  const contactId = uuidv4();
  const now = new Date().toISOString();
  
  const contactData = generateContactData(options);
  
  const contact: TestContact = {
    contact_name_id: contactId,
    full_name: contactData.full_name!,
    company_id: options.company_id !== undefined ? options.company_id : null,
    phone_number: contactData.phone_number!,
    email: contactData.email!,
    role: contactData.role!,
    created_at: now,
    updated_at: now,
    is_inactive: contactData.is_inactive!,
    notes: contactData.notes!,
    tenant
  };

  await db('contact_name').insert(contact);
  
  return contact;
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
  companyId?: string
): Promise<{
  activeContacts: TestContact[];
  inactiveContacts: TestContact[];
  contactsWithCompany: TestContact[];
  contactsWithoutCompany: TestContact[];
  contactsWithRoles: TestContact[];
}> {
  // Create active contacts
  const activeContacts = await createTestContacts(db, tenant, 3, {
    is_inactive: false,
    company_id: companyId
  });

  // Create inactive contacts
  const inactiveContacts = await createTestContacts(db, tenant, 2, {
    is_inactive: true,
    company_id: companyId
  });

  // Create contacts with company
  const contactsWithCompany = companyId ? 
    await createTestContacts(db, tenant, 2, { company_id: companyId }) : [];

  // Create contacts without company
  const contactsWithoutCompany = await createTestContacts(db, tenant, 2, {
    company_id: null
  });

  // Create contacts with specific roles
  const contactsWithRoles = await Promise.all([
    createTestContact(db, tenant, { role: 'CEO', company_id: companyId }),
    createTestContact(db, tenant, { role: 'CTO', company_id: companyId }),
    createTestContact(db, tenant, { role: 'Manager', company_id: companyId })
  ]);

  return {
    activeContacts,
    inactiveContacts,
    contactsWithCompany,
    contactsWithoutCompany,
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
  await db('contact_name')
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
  
  await db('contact_name')
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
  const contact = await db('contact_name')
    .where('tenant', tenant)
    .where('contact_name_id', contactId)
    .first();
    
  return contact || null;
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
  const updated = await db('contact_name')
    .where('tenant', tenant)
    .where('contact_name_id', contactId)
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .returning('*');
    
  return updated[0] || null;
}