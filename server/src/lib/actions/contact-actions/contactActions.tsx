'use server'

import { IContact, MappableField, ImportContactResult } from '@/interfaces/contact.interfaces';
import { ICompany } from '@/interfaces/company.interfaces';
import { ITag } from '@/interfaces/tag.interfaces';
import { createTenantKnex } from '@/lib/db';
import { unparseCSV } from '@/lib/utils/csvParser';

export async function getContactByContactNameId(contactNameId: string): Promise<IContact | null> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    const contact = await db('contacts')
      .select('*')
      .where({ contact_name_id: contactNameId, tenant: tenant })
      .first();
    return contact || null;
  } catch (error) {
    console.error('Error getting contact by contact_name_id:', error);
    throw new Error("Failed to get the contact");
  }
}

export async function deleteContact(contactId: string) {
  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  try {
    // Check for dependencies
    const dependencies = [];
    const counts: Record<string, number> = {};

    // Check for tickets
    const ticketCount = await db('tickets')
      .where({ contact_name_id: contactId, is_closed: false })
      .count('* as count')
      .first();
    if (ticketCount && Number(ticketCount.count) > 0) {
      dependencies.push('ticket');
      counts['ticket'] = Number(ticketCount.count);
    }

    // Check for interactions
    const interactionCount = await db('interactions')
      .where({ contact_name_id: contactId })
      .count('* as count')
      .first();
    if (interactionCount && Number(interactionCount.count) > 0) {
      dependencies.push('interaction');
      counts['interaction'] = Number(interactionCount.count);
    }

    // Check for documents
    const documentCount = await db('documents')
      .where({ contact_name_id: contactId })
      .count('* as count')
      .first();
    if (documentCount && Number(documentCount.count) > 0) {
      dependencies.push('document');
      counts['document'] = Number(documentCount.count);
    }

    // Check for schedules
    const scheduleCount = await db('schedules')
      .where({ contact_name_id: contactId })
      .count('* as count')
      .first();
    if (scheduleCount && Number(scheduleCount.count) > 0) {
      dependencies.push('schedule');
      counts['schedule'] = Number(scheduleCount.count);
    }

    // If there are dependencies, return error
    if (dependencies.length > 0) {
      return {
        success: false,
        code: 'CONTACT_HAS_DEPENDENCIES',
        message: 'Contact has associated records and cannot be deleted',
        dependencies,
        counts
      };
    }

    // If no dependencies, proceed with deletion
    const result = await db.transaction(async (trx) => {
      // Delete associated tags first
      await trx('tags')
        .where({ tagged_id: contactId, tagged_type: 'contact' })
        .delete();

      // Delete the contact
      const deleted = await trx('contacts')
        .where({ contact_name_id: contactId, tenant })
        .delete();

      if (!deleted) {
        throw new Error('Contact not found');
      }

      return { success: true };
    });

    return result;
  } catch (error) {
    console.error('Error deleting contact:', error);
    throw new Error('Failed to delete contact');
  }
}

type ContactFilterStatus = 'active' | 'inactive' | 'all';

export async function getContactsByCompany(companyId: string, status: ContactFilterStatus = 'active'): Promise<IContact[]> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    const contacts = await db('contacts')
      .select(
        'contacts.*',
        'companies.company_name'
      )
      .leftJoin('companies', 'contacts.company_id', 'companies.company_id')
      .where('contacts.company_id', companyId)
      .andWhere('contacts.tenant', tenant)
      .modify(function(queryBuilder) {
        if (status !== 'all') {
          queryBuilder.where('contacts.is_inactive', status === 'inactive');
        }
      });
    return contacts;
  } catch (error) {
    console.error('Error fetching contacts for company:', error);
    throw new Error('Failed to fetch contacts for company');
  }
}

export async function getAllCompanies(): Promise<ICompany[]> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    const companies = await db('companies')
      .select('*')
      .where('tenant', tenant);
    return companies;
  } catch (error) {
    console.error('Error fetching all companies:', error);
    throw new Error('Failed to fetch all companies');
  }
}

export async function getAllContacts(status: ContactFilterStatus = 'active'): Promise<IContact[]> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    const contacts = await db('contacts')
      .select(
        'contacts.*',
        'companies.company_name'
      )
      .leftJoin('companies', 'contacts.company_id', 'companies.company_id')
      .where('contacts.tenant', tenant)
      .modify(function(queryBuilder) {
        if (status !== 'all') {
          queryBuilder.where('contacts.is_inactive', status === 'inactive');
        }
      });
    return contacts;
  } catch (error) {
    console.error('Error fetching all contacts:', error);
    throw new Error('Failed to fetch all contacts');
  }
}

export async function addContact(contactData: Partial<IContact>): Promise<IContact> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const contactWithTenant = {
      ...contactData,
      tenant: tenant,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const [newContact] = await db('contacts').insert(contactWithTenant).returning('*');

    if (!newContact) {
      throw new Error('Failed to add new contact');
    }

    return newContact;
  } catch (error) {
    console.error('Error adding new contact:', error);
    throw new Error('Failed to add new contact');
  }
}

export async function updateContact(contactData: Partial<IContact>): Promise<IContact> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    if (!contactData.contact_name_id) {
      throw new Error('Contact ID is required for updating');
    }

    // Define valid fields
    const validFields: (keyof IContact)[] = [
      'contact_name_id', 'full_name', 'company_id', 'phone_number', 
      'email', 'date_of_birth', 'created_at', 'updated_at', 'is_inactive',
      'role', 'notes'
    ];

    // Filter and create updateData
    const updateData: Partial<IContact> = {};
    for (const key of validFields) {
      if (key in contactData && contactData[key] !== undefined) {
        (updateData as any)[key] = contactData[key];
      }
    }

    updateData.updated_at = new Date().toISOString();

    console.log('Updating contact with data:', updateData);

    const [updatedContact] = await db('contacts')
      .where('contact_name_id', contactData.contact_name_id)
      .andWhere('tenant', tenant)
      .update(updateData)
      .returning('*');
    
    if (!updatedContact) {
      throw new Error(`Contact with ID ${contactData.contact_name_id} not found`);
    }
    
    return updatedContact;
  } catch (error) {
    console.error('Error updating contact:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.stack);
      throw new Error(`Failed to update contact: ${error.message}`);
    } else {
      console.error('Unknown error:', error);
      throw new Error('Failed to update contact: Unknown error');
    }
  }
}

export async function updateContactsForCompany(companyId: string, updateData: Partial<IContact>): Promise<void> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    await db('contacts')
      .where({ company_id: companyId, tenant: tenant })
      .update(updateData);
  } catch (error) {
    console.error('Error updating contacts for company:', error);
    throw new Error('Failed to update contacts for company');
  }
}

export async function exportContactsToCSV(
  contacts: IContact[],
  companies: ICompany[],
  contactTags: Record<string, ITag[]>
): Promise<string> {
  const fields = ['full_name', 'email', 'phone_number', 'company_name', 'role', 'notes', 'tags'];
  
  const data = contacts.map((contact): Record<string, string> => {
    const company = companies.find(c => c.company_id === contact.company_id);
    return {
      full_name: contact.full_name,
      email: contact.email,
      phone_number: contact.phone_number,
      company_name: company ? company.company_name : '',
      role: contact.role || '',
      notes: contact.notes || '',
      tags: (contactTags[contact.contact_name_id] || [])
        .map((tag: ITag): string => tag.tag_text)
        .join(', ')
    };
  });

  return unparseCSV(data, fields);
}

export async function importContactsFromCSV(
  contactsData: Array<Partial<IContact>>,
  updateExisting: boolean = false
): Promise<ImportContactResult[]> {
  const results: ImportContactResult[] = [];
  const {knex: db, tenant} = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Start a transaction to ensure all operations succeed or fail together
  await db.transaction(async (trx) => {
    for (const contactData of contactsData) {
      try {
        if (!contactData.full_name) {
          throw new Error('Contact name is required');
        }

        const existingContact = await trx('contacts')
          .where({ 
            full_name: contactData.full_name,
            tenant,
            company_id: contactData.company_id 
          })
          .first();

        if (existingContact && !updateExisting) {
          results.push({
            success: false,
            message: `Contact with name ${contactData.full_name} already exists`,
            originalData: contactData
          });
          continue;
        }

        let savedContact: IContact;

        if (existingContact && updateExisting) {
          // Keep the existing tenant when updating
          const updateData = {
            ...contactData,
            tenant: existingContact.tenant,
            updated_at: new Date().toISOString(),
            date_of_birth: contactData.date_of_birth || undefined,
            role: contactData.role || existingContact.role,
            notes: contactData.notes || existingContact.notes
          };

          [savedContact] = await trx('contacts')
            .where({ contact_name_id: existingContact.contact_name_id })
            .update(updateData)
            .returning('*');

          results.push({
            success: true,
            message: 'Contact updated',
            contact: savedContact,
            originalData: contactData
          });
        } else {
          // Create new contact
          const contactToCreate = {
            full_name: contactData.full_name,
            email: contactData.email || '',
            phone_number: contactData.phone_number || '',
            company_id: contactData.company_id,
            is_inactive: contactData.is_inactive || false,
            date_of_birth: contactData.date_of_birth,
            role: contactData.role || '',
            notes: contactData.notes || '',
            tenant: tenant,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          };

          [savedContact] = await trx('contacts')
            .insert(contactToCreate)
            .returning('*');

          results.push({
            success: true,
            message: 'Contact created',
            contact: savedContact,
            originalData: contactData
          });
        }
      } catch (error) {
        console.error('Error processing contact:', contactData, error);
        results.push({
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error occurred',
          originalData: contactData
        });
      }
    }
  });

  return results;
}

export async function checkExistingEmails(
  emails: string[]
): Promise<string[]> {
  const {knex: db, tenant} = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const existingContacts = await db('contacts')
    .select('email')
    .whereIn('email', emails)
    .andWhere('tenant', tenant);

  return existingContacts.map((contact: { email: string }): string => contact.email);
}
