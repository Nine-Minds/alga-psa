'use server'

import { IContact, MappableField, ImportContactResult } from 'server/src/interfaces/contact.interfaces';
import { ICompany } from 'server/src/interfaces/company.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { unparseCSV } from 'server/src/lib/utils/csvParser';
import { getContactAvatarUrl } from 'server/src/lib/utils/avatarUtils';
import { createTag } from 'server/src/lib/actions/tagActions';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';

export async function getContactByContactNameId(contactNameId: string): Promise<IContact | null> {
  // Revert to using createTenantKnex for now
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('SYSTEM_ERROR: Tenant configuration not found');
  }
  try {
    // Validate input
    if (!contactNameId) {
      throw new Error('VALIDATION_ERROR: Contact ID is required');
    }

    // Fetch contact with company information
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .select(
          'contacts.*',
          'companies.company_name'
        )
        .leftJoin('companies', function (this: Knex.JoinClause) { // Add type for 'this'
          this.on('contacts.company_id', 'companies.company_id')
            .andOn('companies.tenant', 'contacts.tenant')
        })
        .where({
          'contacts.contact_name_id': contactNameId,
          'contacts.tenant': tenant
        })
        .first();
    });

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
  // Remove closing bracket for runWithTenant
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
    const contact = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({ contact_name_id: contactId, tenant })
        .first();
    });

    if (!contact) {
      throw new Error('VALIDATION_ERROR: The contact you are trying to delete no longer exists');
    }

    // Check for dependencies
    const dependencies: string[] = [];
    const counts: Record<string, number> = {};

    // Check for dependencies
    await withTransaction(db, async (trx: Knex.Transaction) => {
      // Check for tickets
      const ticketCount = await trx('tickets')
        .where({
          contact_name_id: contactId,
          tenant
        })
        .count('* as count')
        .first();
      if (ticketCount && Number(ticketCount.count) > 0) {
        dependencies.push('ticket');
        counts['ticket'] = Number(ticketCount.count);
      }

      // Check for interactions
      const interactionCount = await trx('interactions')
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
      const documentCount = await trx('document_associations')
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

      // Check for projects
      const projectCount = await trx('projects')
        .where({
          contact_name_id: contactId,
          tenant
        })
        .count('* as count')
        .first();
      if (projectCount && Number(projectCount.count) > 0) {
        dependencies.push('project');
        counts['project'] = Number(projectCount.count);
      }

      // Check for channels
      const channelCount = await trx('channels')
        .where({
          contact_name_id: contactId,
          tenant
        })
        .count('* as count')
        .first();
      if (channelCount && Number(channelCount.count) > 0) {
        dependencies.push('channel');
        counts['channel'] = Number(channelCount.count);
      }

      // Check for comments
      const commentCount = await trx('comments')
        .where({
          contact_name_id: contactId,
          tenant
        })
        .count('* as count')
        .first();
      if (commentCount && Number(commentCount.count) > 0) {
        dependencies.push('comment');
        counts['comment'] = Number(commentCount.count);
      }
    });

    // If there are dependencies, throw a detailed error
    if (dependencies.length > 0) {
      const dependencyList = dependencies.map(dep => `${counts[dep]} ${dep}${counts[dep] > 1 ? 's' : ''}`).join(', ');
      throw new Error(`VALIDATION_ERROR: Cannot delete contact because it has associated records: ${dependencyList}. Please remove or reassign these records first.`);
    }

    // If no dependencies, proceed with deletion
    const result = await withTransaction(db, async (trx: Knex.Transaction) => {
      try {
        // Delete associated tag mappings first
        // First get the tag_ids for this contact
        const tagMappings = await trx('tag_mappings')
          .where({
            tagged_id: contactId,
            tagged_type: 'contact',
            tenant
          })
          .select('tag_id');
        
        // Delete the tag mappings
        await trx('tag_mappings')
          .where({
            tagged_id: contactId,
            tagged_type: 'contact',
            tenant
          })
          .delete();
        
        // Check if any of these tags are now orphaned (not used by anything else)
        for (const mapping of tagMappings) {
          const remainingMappings = await trx('tag_mappings')
            .where({
              tag_id: mapping.tag_id,
              tenant
            })
            .count('* as count')
            .first();
          
          // If no other mappings exist for this tag, delete the tag definition
          if (remainingMappings && Number(remainingMappings.count) === 0) {
            await trx('tag_definitions')
              .where({
                tag_id: mapping.tag_id,
                tenant
              })
              .delete();
          }
        }

        // Delete the contact
        const deleted = await trx('contacts')
          .where({ contact_name_id: contactId, tenant })
          .delete();

        if (!deleted) {
          throw new Error('SYSTEM_ERROR: Failed to delete contact record');
        }

        return { success: true };
      } catch (err) {
        console.error('Error during contact deletion transaction:', err);
        // Re-throw the error with more context
        if (err instanceof Error) {
          throw new Error(`SYSTEM_ERROR: Failed to delete contact - ${err.message}`);
        }
        throw new Error('SYSTEM_ERROR: An unexpected error occurred while deleting the contact');
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
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('SYSTEM_ERROR: Tenant configuration not found');
  }

  try {
    // Validate input
    if (!companyId) {
      throw new Error('VALIDATION_ERROR: Company ID is required');
    }

    // Verify company exists
    const company = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('companies')
        .where({ company_id: companyId, tenant })
        .first();
    });

    if (!company) {
      throw new Error('VALIDATION_ERROR: The specified company does not exist');
    }

    // Fetch contacts with company information
    const contacts = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .select(
          'contacts.*',
          'companies.company_name'
        )
        .leftJoin('companies', function (this: Knex.JoinClause) { // Add type for 'this'
          this.on('contacts.company_id', 'companies.company_id')
            .andOn('companies.tenant', 'contacts.tenant')
        })
        .where('contacts.company_id', companyId)
        .andWhere('contacts.tenant', tenant)
        .modify(function (queryBuilder: Knex.QueryBuilder) { // Add type for 'queryBuilder'
          if (status !== 'all') {
            queryBuilder.where('contacts.is_inactive', status === 'inactive');
          }
        })
        .orderBy('contacts.full_name', 'asc'); // Add consistent ordering
    });

    // Fetch avatar URLs for each contact
    const contactsWithAvatars = await Promise.all(contacts.map(async (contact: IContact) => {
      const avatarUrl = await getContactAvatarUrl(contact.contact_name_id, tenant);
      return {
        ...contact,
        avatarUrl: avatarUrl || null,
      };
    }));

    // Return contacts with avatar URLs
    return contactsWithAvatars;
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
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('SYSTEM_ERROR: Tenant configuration not found');
  }

  try {
    // Fetch all companies with proper ordering
    const companies = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('companies')
        .select(
          'companies.*'
        )
        .where('companies.tenant', tenant)
        .orderBy('companies.company_name', 'asc'); // Add consistent ordering
    });

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
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('SYSTEM_ERROR: Tenant configuration not found');
  }

  try {
    // Validate status parameter
    if (!['active', 'inactive', 'all'].includes(status)) {
      throw new Error('VALIDATION_ERROR: Invalid status filter provided');
    }

    // Fetch all contacts with company information
    const contacts = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .select(
          'contacts.*',
          'companies.company_name'
        )
        .leftJoin('companies', function (this: Knex.JoinClause) { // Add type for 'this'
          this.on('contacts.company_id', 'companies.company_id')
            .andOn('companies.tenant', 'contacts.tenant')
        })
        .where('contacts.tenant', tenant)
        .modify(function (queryBuilder: Knex.QueryBuilder) { // Add type for 'queryBuilder'
          if (status !== 'all') {
            queryBuilder.where('contacts.is_inactive', status === 'inactive');
          }
        })
        .orderBy('contacts.full_name', 'asc'); // Add consistent ordering
    });

    // Fetch avatar URLs for each contact
    const contactsWithAvatars = await Promise.all(contacts.map(async (contact: IContact) => {
      const avatarUrl = await getContactAvatarUrl(contact.contact_name_id, tenant);
      return {
        ...contact,
        avatarUrl: avatarUrl || null,
      };
    }));

    return contactsWithAvatars;
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
  const { knex: db, tenant } = await createTenantKnex();
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
  const { knex: db, tenant } = await createTenantKnex();
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
      'email', 'created_at', 'updated_at', 'is_inactive',
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

    // Verify contact exists and perform update in transaction
    const updatedContact = await withTransaction(db, async (trx: Knex.Transaction) => {
      const existingContact = await trx('contacts')
        .where({ contact_name_id: contactData.contact_name_id, tenant })
        .first();

      if (!existingContact) {
        throw new Error('VALIDATION_ERROR: The contact you are trying to update no longer exists');
      }

      const [updated] = await trx('contacts')
        .where({ contact_name_id: contactData.contact_name_id, tenant })
        .update(updateData)
        .returning('*');

      return updated;
    });

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
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('SYSTEM_ERROR: Tenant configuration not found');
  }

  try {
    // Validate input
    if (!companyId) {
      throw new Error('VALIDATION_ERROR: Company ID is required');
    }

    // Verify company exists
    const company = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('companies')
        .where({ company_id: companyId, tenant })
        .first();
    });

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
    await withTransaction(db, async (trx: Knex.Transaction) => {
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
  const fields = ['full_name', 'email', 'phone_number', 'company', 'role', 'notes', 'tags'];

  const data = contacts.map((contact): Record<string, string> => {
    const company = companies.find(c => c.company_id === contact.company_id);
    const tags = contactTags[contact.contact_name_id] || [];
    const tagText = tags.map((tag: ITag) => tag.tag_text).join(', ');

    return {
      full_name: contact.full_name || '',
      email: contact.email || '',
      phone_number: contact.phone_number || '',
      company: company?.company_name || '',
      role: contact.role || '',
      notes: contact.notes || '',
      tags: tagText
    };
  });

  return unparseCSV(data, fields);
}

export async function generateContactCSVTemplate(): Promise<string> {
  // Create template with Alice in Wonderland themed sample data
  const templateData = [
    {
      full_name: 'Alice Liddell',
      email: 'alice@wonderland.com',
      phone_number: '+1-555-CURIOUS',
      company: 'Mad Hatter Tea Company',
      role: 'Chief Explorer',
      notes: 'Fell down a rabbit hole and discovered a whole new world',
      tags: 'Curious, Adventurous, Brave'
    },
    {
      full_name: 'Mad Hatter',
      email: 'hatter@teaparty.wonderland',
      phone_number: '+1-555-TEA-TIME',
      company: 'Mad Hatter Tea Company',
      role: 'Chief Tea Ceremony Expert',
      notes: 'Knows why a raven is like a writing desk',
      tags: 'Creative, Eccentric, Tea Expert'
    }
  ];

  const fields = ['full_name', 'email', 'phone_number', 'company', 'role', 'notes', 'tags'];

  return unparseCSV(templateData, fields);
}

type ContactImportData = Partial<IContact> & { tags?: string };

export async function importContactsFromCSV(
  contactsData: Array<ContactImportData>,
  updateExisting: boolean = false
): Promise<ImportContactResult[]> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('SYSTEM_ERROR: Tenant configuration not found');
  }

  try {
    // Validate input
    if (!contactsData || contactsData.length === 0) {
      throw new Error('VALIDATION_ERROR: No contact data provided');
    }

    // Get current user for tag creation
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('SYSTEM_ERROR: User authentication required');
    }

    const results: ImportContactResult[] = [];

    // Start a transaction to ensure all operations succeed or fail together
    await withTransaction(db, async (trx: Knex.Transaction) => {
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

            // Handle tags if provided (for updates, we'll replace existing tags)
            if (contactData.tags !== undefined) {
              try {
                // First, delete existing tag mappings
                await trx('tag_mappings')
                  .where({
                    tagged_id: savedContact.contact_name_id,
                    tagged_type: 'contact',
                    tenant
                  })
                  .delete();

                // Then create new tags if any
                if (contactData.tags) {
                  const tagTexts = contactData.tags.split(',').map((tag: string) => tag.trim()).filter((tag: string) => tag);
                  for (const tagText of tagTexts) {
                    await createTag({
                      tag_text: tagText,
                      tagged_id: savedContact.contact_name_id,
                      tagged_type: 'contact',
                      created_by: currentUser.user_id
                    });
                  }
                }
              } catch (tagError) {
                console.error('Failed to update tags during CSV import:', tagError);
                // Don't fail the contact import if tag update fails
              }
            }

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
              role: contactData.role?.trim() || '',
              notes: contactData.notes?.trim() || '',
              tenant: tenant,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };

            [savedContact] = await trx('contacts')
              .insert(contactToCreate)
              .returning('*');

            // Handle tags if provided
            if (contactData.tags) {
              try {
                const tagTexts = contactData.tags.split(',').map((tag: string) => tag.trim()).filter((tag: string) => tag);
                for (const tagText of tagTexts) {
                  await createTag({
                    tag_text: tagText,
                    tagged_id: savedContact.contact_name_id,
                    tagged_type: 'contact',
                    created_by: currentUser.user_id
                  });
                }
              } catch (tagError) {
                console.error('Failed to create tags during CSV import:', tagError);
                // Don't fail the contact import if tag creation fails
              }
            }

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
  const { knex: db, tenant } = await createTenantKnex();
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

export async function getContactByEmail(email: string, companyId: string) {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const contact = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({
          email,
          company_id: companyId,
          tenant
        })
        .first();
    });

    return contact;
  } catch (error) {
    console.error('Error getting contact by email:', error);
    throw error;
  }
}

/**
 * Create a new contact for a company
 * @deprecated Use createOrFindContactByEmail instead for better duplicate handling
 */
export async function createCompanyContact({
  companyId,
  fullName,
  email,
  phone = '',
  jobTitle = ''
}: {
  companyId: string;
  fullName: string;
  email: string;
  phone?: string;
  jobTitle?: string;
}) {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Check if email already exists across the tenant
    const existingContact = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({ 
          email: email.trim().toLowerCase(), 
          tenant 
        })
        .first();
    });

    if (existingContact) {
      throw new Error('EMAIL_EXISTS: A contact with this email address already exists in the system');
    }

    const contact = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const [inserted] = await trx('contacts')
        .insert({
          tenant,
          company_id: companyId,
          full_name: fullName,
          email: email.trim().toLowerCase(),
          phone_number: phone,
          role: jobTitle,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .returning('*');
      
      return inserted;
    });

    return contact;
  } catch (error) {
    console.error('Error creating company contact:', error);
    throw error;
  }
}

/**
 * Find contact by email address (without requiring company_id)
 * Used for email processing workflows
 */
export async function findContactByEmailAddress(email: string): Promise<IContact | null> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const contact = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .select(
          'contacts.*',
          'companies.company_name'
        )
        .leftJoin('companies', function (this: Knex.JoinClause) {
          this.on('contacts.company_id', 'companies.company_id')
            .andOn('companies.tenant', 'contacts.tenant')
        })
        .where({
          'contacts.email': email.toLowerCase(),
          'contacts.tenant': tenant
        })
        .first();
    });

    return contact || null;
  } catch (error) {
    console.error('Error finding contact by email address:', error);
    throw error;
  }
}

/**
 * Create or find contact - if contact exists, return it; otherwise create new one
 */
export async function createOrFindContactByEmail({
  email,
  name,
  companyId,
  phone,
  title
}: {
  email: string;
  name?: string;
  companyId: string;
  phone?: string;
  title?: string;
}): Promise<{ contact: IContact & { company_name: string }; isNew: boolean }> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      // First, check if contact exists anywhere in the tenant
      const existingContactInTenant = await trx('contacts')
        .select(
          'contacts.*',
          'companies.company_name'
        )
        .leftJoin('companies', function (this: Knex.JoinClause) {
          this.on('contacts.company_id', 'companies.company_id')
            .andOn('companies.tenant', 'contacts.tenant')
        })
        .where({
          'contacts.email': email.toLowerCase(),
          'contacts.tenant': tenant
        })
        .first();

      if (existingContactInTenant) {
        // If the contact exists but is in a different company, throw an error
        if (existingContactInTenant.company_id !== companyId) {
          // If contact has no company, still throw error - don't auto-assign
          if (!existingContactInTenant.company_id) {
            throw new Error('EMAIL_EXISTS: A contact with this email address already exists in the system without a company assignment');
          }
          // If they already belong to a different company, throw error with company name
          throw new Error(`EMAIL_EXISTS: This email is already associated with ${existingContactInTenant.company_name || 'another company'}`);
        }
        // Contact exists in the same company - return it
        const contactWithCompanyName = {
          ...existingContactInTenant,
          company_name: existingContactInTenant.company_name || ''
        };
        return { contact: contactWithCompanyName, isNew: false };
      }

      // Create new contact if not found
      const contactName = name || extractNameFromEmail(email);
      const now = new Date();

      const [newContact] = await trx('contacts')
        .insert({
          tenant,
          company_id: companyId,
          full_name: contactName,
          email: email.toLowerCase(),
          phone_number: phone,
          role: title,
          is_inactive: false,
          created_at: now,
          updated_at: now
        })
        .returning('*');

      // Add company name for consistency
      const company = await trx('companies')
        .select('company_name')
        .where({ company_id: companyId, tenant })
        .first();

      const contactWithCompany = {
        ...newContact,
        company_name: company?.company_name || ''
      };

      return { contact: contactWithCompany, isNew: true };
    });
  } catch (error) {
    console.error('Error creating or finding contact:', error);
    throw error;
  }
}

/**
 * Extract a reasonable name from email address if no name provided
 */
function extractNameFromEmail(email: string): string {
  const localPart = email.split('@')[0];
  
  // Replace common separators with spaces and capitalize words
  return localPart
    .replace(/[._-]/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Update contact's portal admin status
 */
export async function updateContactPortalAdminStatus(
  contactId: string,
  isPortalAdmin: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('Unauthorized');
    }

    // Check permissions
    const hasUpdatePermission = await hasPermission(currentUser, 'client', 'update');
    if (!hasUpdatePermission) {
      throw new Error('You do not have permission to update client settings');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      const updated = await trx('contacts')
        .where({ 
          contact_name_id: contactId,
          tenant
        })
        .update({
          is_client_admin: isPortalAdmin,
          updated_at: new Date().toISOString()
        });

      if (updated === 0) {
        throw new Error('Contact not found');
      }
    });

    return { success: true };
  } catch (error) {
    console.error('[contactActions.updateContactPortalAdminStatus]', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to update contact' 
    };
  }
}

/**
 * Get user associated with a contact
 */
export async function getUserByContactId(
  contactId: string
): Promise<{ user: any | null; error?: string }> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('Unauthorized');
    }

    // Check permissions
    const hasReadPermission = await hasPermission(currentUser, 'client', 'read');
    if (!hasReadPermission) {
      throw new Error('You do not have permission to view client information');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // First get the user
    const user = await knex('users')
      .where({ 
        contact_id: contactId,
        tenant: tenant,
        user_type: 'client'
      })
      .first();

    if (!user) {
      return { user: null, error: undefined };
    }

    // Then get the roles separately
    const roles = await knex('user_roles')
      .select('roles.role_id', 'roles.role_name')
      .join('roles', function(this: Knex.JoinClause) {
        this.on('user_roles.role_id', 'roles.role_id')
          .andOn('roles.tenant', knex.raw('?', [tenant]));
      })
      .where({
        'user_roles.user_id': user.user_id,
        'user_roles.tenant': tenant
      });

    // Attach roles to user object
    const userWithRoles = {
      ...user,
      roles: roles || []
    };

    return { user: userWithRoles, error: undefined };
  } catch (error) {
    console.error('[contactActions.getUserByContactId]', error);
    return { 
      user: null,
      error: error instanceof Error ? error.message : 'Failed to get user' 
    };
  }
}
