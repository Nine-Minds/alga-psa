'use server'

import { IContact, MappableField, ImportContactResult } from '@/interfaces/contact.interfaces';
import { ICompany } from '@/interfaces/company.interfaces';
import { ITag } from '@/interfaces/tag.interfaces';
import { createTenantKnex } from '@/lib/db';
import { unparseCSV } from '@/lib/utils/csvParser';

export async function getContactByContactNameId(contactNameId: string): Promise<IContact | null> {
  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('SYSTEM_ERROR: Tenant configuration not found');
  }

  try {
    // Validate input
    if (!contactNameId) {
      throw new Error('VALIDATION_ERROR: Contact ID is required');
    }

    // Fetch contact with company information
    const contact = await db('contacts')
      .select(
        'contacts.*',
        'companies.company_name'
      )
      .leftJoin('companies', function() {
        this.on('contacts.company_id', 'companies.company_id')
           .andOn('companies.tenant', db.raw('?', [tenant]))
      })
      .where({ 
        'contacts.contact_name_id': contactNameId, 
        'contacts.tenant': tenant 
      })
      .first();

    // Note: We don't throw an error if contact is not found
    // Instead return null as this is a lookup function
    return contact || null;
  } catch (err) {
    // Log the error for debugging
    console.error('Error getting contact by contact_name_id:', err);
    
    // Handle known error types
    if (err instanceof Error) {
      const message = err.message;
      
      // If it's already one of our formatted errors, rethrow it
      if (message.includes('VALIDATION_ERROR:') ||
          message.includes('SYSTEM_ERROR:')) {
        throw err;
      }
      
      // Handle database-specific errors
      if (message.includes('relation') && message.includes('does not exist')) {
        throw new Error('SYSTEM_ERROR: Database schema error - please contact support');
      }
    }
    
    // For unexpected errors, throw a generic system error
    throw new Error('SYSTEM_ERROR: An unexpected error occurred while retrieving contact information');
  }
}

export async function deleteContact(contactId: string) {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('SYSTEM_ERROR: Tenant configuration not found');
  }

  try {
    // Validate input
    if (!contactId) {
      throw new Error('VALIDATION_ERROR: Contact ID is required');
    }

    // Verify contact exists
    const contact = await db('contacts')
      .where({ contact_name_id: contactId, tenant })
      .first();

    if (!contact) {
      throw new Error('VALIDATION_ERROR: The contact you are trying to delete no longer exists');
    }

    // Check for dependencies
    const dependencies = [];
    const counts: Record<string, number> = {};

    // Check for tickets
    const ticketCount = await db('tickets')
      .where({ 
        contact_name_id: contactId, 
        is_closed: false,
        tenant 
      })
      .count('* as count')
      .first();
    if (ticketCount && Number(ticketCount.count) > 0) {
      dependencies.push('ticket');
      counts['ticket'] = Number(ticketCount.count);
    }

    // Check for interactions
    const interactionCount = await db('interactions')
      .where({ 
        contact_name_id: contactId,
        tenant 
      })
      .count('* as count')
      .first();
    if (interactionCount && Number(interactionCount.count) > 0) {
      dependencies.push('interaction');
      counts['interaction'] = Number(interactionCount.count);
    }

    // Check for document associations
    const documentCount = await db('document_associations')
      .where({ 
        entity_id: contactId,
        entity_type: 'contact',
        tenant 
      })
      .count('* as count')
      .first();
    if (documentCount && Number(documentCount.count) > 0) {
      dependencies.push('document');
      counts['document'] = Number(documentCount.count);
    }

    // Check for schedules
    const scheduleCount = await db('schedules')
      .where({ 
        contact_name_id: contactId,
        tenant 
      })
      .count('* as count')
      .first();
    if (scheduleCount && Number(scheduleCount.count) > 0) {
      dependencies.push('schedule');
      counts['schedule'] = Number(scheduleCount.count);
    }

    // If there are dependencies, throw a detailed error
    if (dependencies.length > 0) {
      const dependencyList = dependencies.map(dep => `${counts[dep]} ${dep}${counts[dep] > 1 ? 's' : ''}`).join(', ');
      throw new Error(`VALIDATION_ERROR: Cannot delete contact because it has associated records: ${dependencyList}. Please remove or reassign these records first.`);
    }

    // If no dependencies, proceed with deletion
    const result = await db.transaction(async (trx) => {
      try {
        // Delete associated tags first
        await trx('tags')
          .where({ tagged_id: contactId, tagged_type: 'contact' })
          .delete();

        // Delete the contact
        const deleted = await trx('contacts')
          .where({ contact_name_id: contactId, tenant })
          .delete();

        if (!deleted) {
          throw new Error('SYSTEM_ERROR: Failed to delete contact record');
        }

        return { success: true };
      } catch (err) {
        throw new Error('SYSTEM_ERROR: Failed to delete contact and its associated records');
      }
    });

    return result;
  } catch (err) {
    // Log the error for debugging
    console.error('Error deleting contact:', err);
    
    // Handle known error types
    if (err instanceof Error) {
      const message = err.message;
      
      // If it's already one of our formatted errors, rethrow it
      if (message.includes('VALIDATION_ERROR:') ||
          message.includes('SYSTEM_ERROR:')) {
        throw err;
      }
      
      // Handle database-specific errors
      if (message.includes('violates foreign key constraint')) {
        throw new Error('VALIDATION_ERROR: Cannot delete contact because it has associated records');
      }
    }
    
    // For unexpected errors, throw a generic system error
    throw new Error('SYSTEM_ERROR: An unexpected error occurred while deleting the contact');
  }
}

type ContactFilterStatus = 'active' | 'inactive' | 'all';

export async function getContactsByCompany(companyId: string, status: ContactFilterStatus = 'active'): Promise<IContact[]> {
  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('SYSTEM_ERROR: Tenant configuration not found');
  }

  try {
    // Validate input
    if (!companyId) {
      throw new Error('VALIDATION_ERROR: Company ID is required');
    }

    // Verify company exists
    const company = await db('companies')
      .where({ company_id: companyId, tenant })
      .first();

    if (!company) {
      throw new Error('VALIDATION_ERROR: The specified company does not exist');
    }

    // Fetch contacts with company information
    const contacts = await db('contacts')
      .select(
        'contacts.*',
        'companies.company_name'
      )
      .leftJoin('companies', function() {
        this.on('contacts.company_id', 'companies.company_id')
           .andOn('companies.tenant', db.raw('?', [tenant]))
      })
      .where('contacts.company_id', companyId)
      .andWhere('contacts.tenant', tenant)
      .modify(function (queryBuilder) {
        if (status !== 'all') {
          queryBuilder.where('contacts.is_inactive', status === 'inactive');
        }
      })
      .orderBy('contacts.full_name', 'asc'); // Add consistent ordering

    // Return empty array if no contacts found (don't throw error)
    return contacts;
  } catch (err) {
    // Log the error for debugging
    console.error('Error fetching contacts for company:', err);
    
    // Handle known error types
    if (err instanceof Error) {
      const message = err.message;
      
      // If it's already one of our formatted errors, rethrow it
      if (message.includes('VALIDATION_ERROR:') ||
          message.includes('SYSTEM_ERROR:')) {
        throw err;
      }
      
      // Handle database-specific errors
      if (message.includes('relation') && message.includes('does not exist')) {
        throw new Error('SYSTEM_ERROR: Database schema error - please contact support');
      }
    }
    
    // For unexpected errors, throw a generic system error
    throw new Error('SYSTEM_ERROR: An unexpected error occurred while retrieving company contacts');
  }
}

export async function getAllCompanies(): Promise<ICompany[]> {
  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('SYSTEM_ERROR: Tenant configuration not found');
  }

  try {
    // Fetch all companies with proper ordering
    const companies = await db('companies')
      .select(
        'companies.*'
      )
      .where('companies.tenant', tenant)
      .orderBy('companies.company_name', 'asc'); // Add consistent ordering

    // Return empty array if no companies found (don't throw error)
    return companies;
  } catch (err) {
    // Log the error for debugging
    console.error('Error fetching all companies:', err);
    
    // Handle known error types
    if (err instanceof Error) {
      const message = err.message;
      
      // If it's already one of our formatted errors, rethrow it
      if (message.includes('VALIDATION_ERROR:') ||
          message.includes('SYSTEM_ERROR:')) {
        throw err;
      }
      
      // Handle database-specific errors
      if (message.includes('relation') && message.includes('does not exist')) {
        throw new Error('SYSTEM_ERROR: Database schema error - please contact support');
      }
    }
    
    // For unexpected errors, throw a generic system error
    throw new Error('SYSTEM_ERROR: An unexpected error occurred while retrieving companies');
  }
}

export async function getAllContacts(status: ContactFilterStatus = 'active'): Promise<IContact[]> {
  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('SYSTEM_ERROR: Tenant configuration not found');
  }

  try {
    // Validate status parameter
    if (!['active', 'inactive', 'all'].includes(status)) {
      throw new Error('VALIDATION_ERROR: Invalid status filter provided');
    }

    // Fetch all contacts with company information
    const contacts = await db('contacts')
      .select(
        'contacts.*',
        'companies.company_name'
      )
      .leftJoin('companies', function() {
        this.on('contacts.company_id', 'companies.company_id')
           .andOn('companies.tenant', db.raw('?', [tenant]))
      })
      .where('contacts.tenant', tenant)
      .modify(function (queryBuilder) {
        if (status !== 'all') {
          queryBuilder.where('contacts.is_inactive', status === 'inactive');
        }
      })
      .orderBy('contacts.full_name', 'asc'); // Add consistent ordering

    // Return empty array if no contacts found (don't throw error)
    return contacts;
  } catch (err) {
    // Log the error for debugging
    console.error('Error fetching all contacts:', err);
    
    // Handle known error types
    if (err instanceof Error) {
      const message = err.message;
      
      // If it's already one of our formatted errors, rethrow it
      if (message.includes('VALIDATION_ERROR:') ||
          message.includes('SYSTEM_ERROR:')) {
        throw err;
      }
      
      // Handle database-specific errors
      if (message.includes('relation') && message.includes('does not exist')) {
        throw new Error('SYSTEM_ERROR: Database schema error - please contact support');
      }
    }
    
    // For unexpected errors, throw a generic system error
    throw new Error('SYSTEM_ERROR: An unexpected error occurred while retrieving contacts');
  }
}

export async function addContact(contactData: Partial<IContact>): Promise<IContact> {
  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('SYSTEM_ERROR: Tenant configuration not found');
  }


    // Validate required fields with specific messages
    if (!contactData.full_name?.trim() && !contactData.email?.trim()) {
      throw new Error('VALIDATION_ERROR: Full name and email address are required');
    }
    if (!contactData.full_name?.trim()) {
      throw new Error('VALIDATION_ERROR: Full name is required');
    }
    if (!contactData.email?.trim()) {
      throw new Error('VALIDATION_ERROR: Email address is required');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(contactData.email.trim())) {
      throw new Error('VALIDATION_ERROR: Please enter a valid email address');
    }


    // Check if email already exists
    const existingContact = await db('contacts')
      .where({ email: contactData.email.trim().toLowerCase(), tenant })
      .first();
  
    if (existingContact) {
      throw new Error('EMAIL_EXISTS: A contact with this email address already exists in the system');
    }

    // If company_id is provided, verify it exists
    if (contactData.company_id) {
      const company = await db('companies')
        .where({ company_id: contactData.company_id, tenant })
        .first();

      if (!company) {
        throw new Error('FOREIGN_KEY_ERROR: The selected company no longer exists');
      }
    }

    // Prepare contact data with proper sanitization
    const contactWithTenant = {
      ...contactData,
      full_name: contactData.full_name.trim(),
      email: contactData.email.trim().toLowerCase(),
      phone_number: contactData.phone_number?.trim() || null,
      role: contactData.role?.trim() || null,
      notes: contactData.notes?.trim() || null,
      tenant: tenant,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

  try {
    const [newContact] = await db('contacts').insert(contactWithTenant).returning('*');

    if (!newContact) {
      throw new Error('SYSTEM_ERROR: Failed to create contact record');
    }

    return newContact;
  } catch (err) {
    // Log the error for debugging
    console.error('Error creating contact:', err);
    
    // Handle known error types
    if (err instanceof Error) {
      const message = err.message;
      
      // If it's already one of our formatted errors, rethrow it
      if (message.includes('VALIDATION_ERROR:') ||
          message.includes('EMAIL_EXISTS:') ||
          message.includes('FOREIGN_KEY_ERROR:') ||
          message.includes('SYSTEM_ERROR:')) {
        throw err;
      }
      
      // Handle database-specific errors
      if (message.includes('duplicate key') && message.includes('contacts_email_tenant_unique')) {
        throw new Error('EMAIL_EXISTS: A contact with this email address already exists in the system');
      }
      
      if (message.includes('violates not-null constraint')) {
        const field = message.match(/column "([^"]+)"/)?.[1] || 'field';
        throw new Error(`VALIDATION_ERROR: The ${field} is required`);
      }
      
      if (message.includes('violates foreign key constraint') && message.includes('company_id')) {
        throw new Error('FOREIGN_KEY_ERROR: The selected company is no longer valid');
      }
    }
    
    // For unexpected errors, throw a generic system error
    throw new Error('SYSTEM_ERROR: An unexpected error occurred while creating the contact');
  }
}

export async function updateContact(contactData: Partial<IContact>): Promise<IContact> {
  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('SYSTEM_ERROR: Tenant configuration not found');
  }

  try {
    // Validate required fields
    if (!contactData.contact_name_id) {
      throw new Error('VALIDATION_ERROR: Contact ID is required for updates');
    }

    // If email is being updated, validate format
    if (contactData.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(contactData.email.trim())) {
        throw new Error('VALIDATION_ERROR: Please enter a valid email address');
      }

      // Check if new email already exists for another contact
      const existingContact = await db('contacts')
        .where({ 
          email: contactData.email.trim().toLowerCase(), 
          tenant 
        })
        .whereNot({ contact_name_id: contactData.contact_name_id })
        .first();

      if (existingContact) {
        throw new Error('EMAIL_EXISTS: A contact with this email address already exists in the system');
      }
    }

    // If company_id is being updated, verify it exists
    if (contactData.company_id) {
      const company = await db('companies')
        .where({ company_id: contactData.company_id, tenant })
        .first();

      if (!company) {
        throw new Error('FOREIGN_KEY_ERROR: The selected company no longer exists');
      }
    }

    // Define valid fields
    const validFields: (keyof IContact)[] = [
      'contact_name_id', 'full_name', 'company_id', 'phone_number',
      'email', 'date_of_birth', 'created_at', 'updated_at', 'is_inactive',
      'role', 'notes'
    ];

    // Filter and sanitize update data
    const updateData: Partial<IContact> = {};
    for (const key of validFields) {
      if (key in contactData && contactData[key] !== undefined) {
        let value = contactData[key];
        // Sanitize string values
        if (typeof value === 'string') {
          value = value.trim();
          if (key === 'email') {
            value = value.toLowerCase();
          }
        }
        (updateData as any)[key] = value;
      }
    }

    updateData.updated_at = new Date().toISOString();

    // Verify contact exists before update
    const existingContact = await db('contacts')
      .where({ contact_name_id: contactData.contact_name_id, tenant })
      .first();

    if (!existingContact) {
      throw new Error('VALIDATION_ERROR: The contact you are trying to update no longer exists');
    }

    const [updatedContact] = await db('contacts')
      .where({ contact_name_id: contactData.contact_name_id, tenant })
      .update(updateData)
      .returning('*');

    if (!updatedContact) {
      throw new Error('SYSTEM_ERROR: Failed to update contact record');
    }

    return updatedContact;
  } catch (err) {
    // Log the error for debugging
    console.error('Error updating contact:', err);
    
    // Handle known error types
    if (err instanceof Error) {
      const message = err.message;
      
      // If it's already one of our formatted errors, rethrow it
      if (message.includes('VALIDATION_ERROR:') ||
          message.includes('EMAIL_EXISTS:') ||
          message.includes('FOREIGN_KEY_ERROR:') ||
          message.includes('SYSTEM_ERROR:')) {
        throw err;
      }
      
      // Handle database-specific errors
      if (message.includes('duplicate key') && message.includes('contacts_email_tenant_unique')) {
        throw new Error('EMAIL_EXISTS: A contact with this email address already exists in the system');
      }
      
      if (message.includes('violates not-null constraint')) {
        const field = message.match(/column "([^"]+)"/)?.[1] || 'field';
        throw new Error(`VALIDATION_ERROR: The ${field} is required`);
      }
      
      if (message.includes('violates foreign key constraint') && message.includes('company_id')) {
        throw new Error('FOREIGN_KEY_ERROR: The selected company is no longer valid');
      }
    }
    
    // For unexpected errors, throw a generic system error
    throw new Error('SYSTEM_ERROR: An unexpected error occurred while updating the contact');
  }
}

export async function updateContactsForCompany(companyId: string, updateData: Partial<IContact>): Promise<void> {
  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('SYSTEM_ERROR: Tenant configuration not found');
  }

  try {
    // Validate input
    if (!companyId) {
      throw new Error('VALIDATION_ERROR: Company ID is required');
    }

    // Verify company exists
    const company = await db('companies')
      .where({ company_id: companyId, tenant })
      .first();

    if (!company) {
      throw new Error('VALIDATION_ERROR: The specified company does not exist');
    }

    // Validate update data
    if (Object.keys(updateData).length === 0) {
      throw new Error('VALIDATION_ERROR: No update data provided');
    }

    // If email is being updated, validate format
    if (updateData.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(updateData.email.trim())) {
        throw new Error('VALIDATION_ERROR: Please enter a valid email address');
      }
    }

    // Sanitize update data
    const sanitizedData = Object.entries(updateData).reduce<Partial<IContact>>((acc, [key, value]) => {
      const contactKey = key as keyof IContact;
      
      // Skip undefined values
      if (value === undefined) {
        return acc;
      }

      // Handle different value types based on field
      switch (contactKey) {
        case 'email':
        case 'full_name':
        case 'phone_number':
        case 'role':
          // These fields are required strings
          acc[contactKey] = typeof value === 'string' ? value.trim() : String(value);
          if (contactKey === 'email') {
            acc[contactKey] = acc[contactKey].toLowerCase();
          }
          break;
          
        case 'notes':
        case 'date_of_birth':
          // These fields are optional strings
          if (value === null) {
            acc[contactKey] = undefined;
          } else {
            acc[contactKey] = typeof value === 'string' ? value.trim() : String(value);
          }
          break;
          
        case 'company_id':
          // This field is string | null
          acc[contactKey] = value === null ? null : String(value);
          break;
          
        case 'is_inactive':
          // This field is boolean
          acc[contactKey] = Boolean(value);
          break;
          
        case 'created_at':
        case 'updated_at':
          // These fields are strings (ISO dates)
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

    // Perform the update within a transaction
    await db.transaction(async (trx) => {
      const updated = await trx('contacts')
        .where({ company_id: companyId, tenant })
        .update({
          ...sanitizedData,
          updated_at: new Date().toISOString()
        });

      if (!updated) {
        throw new Error('SYSTEM_ERROR: Failed to update company contacts');
      }
    });
  } catch (err) {
    // Log the error for debugging
    console.error('Error updating contacts for company:', err);
    
    // Handle known error types
    if (err instanceof Error) {
      const message = err.message;
      
      // If it's already one of our formatted errors, rethrow it
      if (message.includes('VALIDATION_ERROR:') ||
          message.includes('EMAIL_EXISTS:') ||
          message.includes('FOREIGN_KEY_ERROR:') ||
          message.includes('SYSTEM_ERROR:')) {
        throw err;
      }
      
      // Handle database-specific errors
      if (message.includes('duplicate key') && message.includes('contacts_email_tenant_unique')) {
        throw new Error('EMAIL_EXISTS: One or more contacts already have this email address');
      }
      
      if (message.includes('violates not-null constraint')) {
        const field = message.match(/column "([^"]+)"/)?.[1] || 'field';
        throw new Error(`VALIDATION_ERROR: The ${field} is required`);
      }
      
      if (message.includes('violates foreign key constraint')) {
        throw new Error('FOREIGN_KEY_ERROR: Invalid reference in update data');
      }
    }
    
    // For unexpected errors, throw a generic system error
    throw new Error('SYSTEM_ERROR: An unexpected error occurred while updating company contacts');
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
    const tags = contactTags[contact.contact_name_id] || [];
    const tagText = tags.map((tag: ITag) => tag.tag_text).join(', ');
    
    return {
      full_name: contact.full_name || '',
      email: contact.email || '',
      phone_number: contact.phone_number || '',
      company_name: company?.company_name || '',
      role: contact.role || '',
      notes: contact.notes || '',
      tags: tagText
    };
  });

  return unparseCSV(data, fields);
}

export async function importContactsFromCSV(
  contactsData: Array<Partial<IContact>>,
  updateExisting: boolean = false
): Promise<ImportContactResult[]> {
  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('SYSTEM_ERROR: Tenant configuration not found');
  }

  try {
    // Validate input
    if (!contactsData || contactsData.length === 0) {
      throw new Error('VALIDATION_ERROR: No contact data provided');
    }

    const results: ImportContactResult[] = [];

    // Start a transaction to ensure all operations succeed or fail together
    await db.transaction(async (trx) => {
      for (const contactData of contactsData) {
        try {
          // Validate required fields
          if (!contactData.full_name?.trim()) {
            throw new Error('VALIDATION_ERROR: Full name is required');
          }

          // Validate email if provided
          if (contactData.email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(contactData.email.trim())) {
              throw new Error(`VALIDATION_ERROR: Invalid email format for contact: ${contactData.full_name}`);
            }
          }

          // Verify company if provided
          if (contactData.company_id) {
            const company = await trx('companies')
              .where({ company_id: contactData.company_id, tenant })
              .first();

            if (!company) {
              throw new Error(`FOREIGN_KEY_ERROR: Company not found for contact: ${contactData.full_name}`);
            }
          }

          // Check for existing contact
          const existingContact = await trx('contacts')
            .where({ 
              full_name: contactData.full_name.trim(),
              tenant,
              company_id: contactData.company_id 
            })
            .first();

          if (existingContact && !updateExisting) {
            results.push({
              success: false,
              message: `VALIDATION_ERROR: Contact with name ${contactData.full_name} already exists`,
              originalData: contactData
            });
            continue;
          }

          let savedContact: IContact;

          if (existingContact && updateExisting) {
            // Prepare update data with proper sanitization
            const updateData = {
              ...contactData,
              full_name: contactData.full_name.trim(),
              email: contactData.email?.trim().toLowerCase() || existingContact.email,
              phone_number: contactData.phone_number?.trim() || existingContact.phone_number,
              role: contactData.role?.trim() || existingContact.role,
              notes: contactData.notes?.trim() || existingContact.notes,
              tenant: existingContact.tenant,
              updated_at: new Date().toISOString()
            };

            [savedContact] = await trx('contacts')
              .where({ contact_name_id: existingContact.contact_name_id })
              .update(updateData)
              .returning('*');

            results.push({
              success: true,
              message: 'Contact updated successfully',
              contact: savedContact,
              originalData: contactData
            });
          } else {
            // Prepare new contact data with proper sanitization
            const contactToCreate = {
              full_name: contactData.full_name.trim(),
              email: contactData.email?.trim().toLowerCase() || '',
              phone_number: contactData.phone_number?.trim() || '',
              company_id: contactData.company_id,
              is_inactive: contactData.is_inactive || false,
              date_of_birth: contactData.date_of_birth,
              role: contactData.role?.trim() || '',
              notes: contactData.notes?.trim() || '',
              tenant: tenant,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };

            [savedContact] = await trx('contacts')
              .insert(contactToCreate)
              .returning('*');

            results.push({
              success: true,
              message: 'Contact created successfully',
              contact: savedContact,
              originalData: contactData
            });
          }
        } catch (err) {
          // Log the error for debugging
          console.error('Error processing contact:', contactData, err);
          
          // Handle known error types
          if (err instanceof Error) {
            const message = err.message;
            
            // If it's already one of our formatted errors, use it
            if (message.includes('VALIDATION_ERROR:') ||
                message.includes('EMAIL_EXISTS:') ||
                message.includes('FOREIGN_KEY_ERROR:') ||
                message.includes('SYSTEM_ERROR:')) {
              results.push({
                success: false,
                message: message,
                originalData: contactData
              });
              continue;
            }
            
            // Handle database-specific errors
            if (message.includes('duplicate key') && message.includes('contacts_email_tenant_unique')) {
              results.push({
                success: false,
                message: `EMAIL_EXISTS: A contact with this email address already exists: ${contactData.email}`,
                originalData: contactData
              });
              continue;
            }
            
            if (message.includes('violates not-null constraint')) {
              const field = message.match(/column "([^"]+)"/)?.[1] || 'field';
              results.push({
                success: false,
                message: `VALIDATION_ERROR: The ${field} is required`,
                originalData: contactData
              });
              continue;
            }
          }
          
          // For unexpected errors
          results.push({
            success: false,
            message: 'SYSTEM_ERROR: An unexpected error occurred while processing the contact',
            originalData: contactData
          });
        }
      }
    });

    return results;
  } catch (err) {
    // Log the error for debugging
    console.error('Error importing contacts:', err);
    
    // Handle known error types
    if (err instanceof Error) {
      const message = err.message;
      
      // If it's already one of our formatted errors, rethrow it
      if (message.includes('VALIDATION_ERROR:') ||
          message.includes('SYSTEM_ERROR:')) {
        throw err;
      }
      
      // Handle database-specific errors
      if (message.includes('relation') && message.includes('does not exist')) {
        throw new Error('SYSTEM_ERROR: Database schema error - please contact support');
      }
    }
    
    // For unexpected errors, throw a generic system error
    throw new Error('SYSTEM_ERROR: An unexpected error occurred while importing contacts');
  }
}

export async function checkExistingEmails(
  emails: string[]
): Promise<string[]> {
  const {knex: db, tenant} = await createTenantKnex();
  if (!tenant) {
    throw new Error('SYSTEM_ERROR: Tenant configuration not found');
  }

  try {
    // Validate input
    if (!emails || emails.length === 0) {
      throw new Error('VALIDATION_ERROR: No email addresses provided');
    }

    // Sanitize and validate email format
    const sanitizedEmails = emails.map(email => {
      const trimmedEmail = email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        throw new Error(`VALIDATION_ERROR: Invalid email format: ${email}`);
      }
      return trimmedEmail;
    });

    // Check for existing emails
    const existingContacts = await db('contacts')
      .select('email')
      .whereIn('email', sanitizedEmails)
      .andWhere('tenant', tenant);

    // Return sanitized existing emails
    return existingContacts.map((contact: { email: string }): string => contact.email);
  } catch (err) {
    // Log the error for debugging
    console.error('Error checking existing emails:', err);
    
    // Handle known error types
    if (err instanceof Error) {
      const message = err.message;
      
      // If it's already one of our formatted errors, rethrow it
      if (message.includes('VALIDATION_ERROR:') ||
          message.includes('SYSTEM_ERROR:')) {
        throw err;
      }
      
      // Handle database-specific errors
      if (message.includes('relation') && message.includes('does not exist')) {
        throw new Error('SYSTEM_ERROR: Database schema error - please contact support');
      }
    }
    
    // For unexpected errors, throw a generic system error
    throw new Error('SYSTEM_ERROR: An unexpected error occurred while checking existing emails');
  }
}
