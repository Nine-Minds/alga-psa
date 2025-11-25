/**
 * Contact repository - data access layer for contacts
 *
 * This repository provides database operations for contacts.
 * It uses the @alga-psa/database package for connection management.
 */

import type { Knex } from 'knex';
import type {
  Contact,
  CreateContactInput,
  UpdateContactInput,
  ContactFilters,
  ContactListResponse,
} from '../types/index.js';

const TABLE_NAME = 'contact_names';

/**
 * Create the contact repository with database connection
 */
export function createContactRepository(knex: Knex) {
  return {
    /**
     * Find a contact by ID
     */
    async findById(
      tenantId: string,
      contactId: string
    ): Promise<Contact | null> {
      const result = await knex(TABLE_NAME)
        .where({ tenant: tenantId, contact_name_id: contactId })
        .first();
      return result || null;
    },

    /**
     * Find contacts matching filters
     */
    async findMany(
      tenantId: string,
      filters: ContactFilters = {}
    ): Promise<ContactListResponse> {
      const {
        search,
        company_id,
        is_inactive,
        tags,
        limit = 50,
        offset = 0,
        orderBy = 'full_name',
        orderDirection = 'asc',
      } = filters;

      let query = knex(TABLE_NAME).where({ tenant: tenantId });

      // Apply search filter
      if (search) {
        query = query.where((builder) => {
          builder
            .whereILike('full_name', `%${search}%`)
            .orWhereILike('email', `%${search}%`);
        });
      }

      // Apply company filter
      if (company_id) {
        query = query.where({ company_id });
      }

      // Apply inactive filter
      if (is_inactive !== undefined) {
        query = query.where({ is_inactive });
      }

      // Apply tag filter
      if (tags && tags.length > 0) {
        query = query
          .join('contact_tags', 'contact_names.contact_name_id', 'contact_tags.contact_id')
          .whereIn('contact_tags.tag_id', tags);
      }

      // Get total count
      const countResult = await query.clone().count('* as count').first();
      const total = Number(countResult?.count || 0);

      // Apply ordering and pagination
      const contacts = await query
        .select('contact_names.*')
        .orderBy(orderBy, orderDirection)
        .limit(limit)
        .offset(offset);

      return { contacts, total, limit, offset };
    },

    /**
     * Create a new contact
     */
    async create(
      tenantId: string,
      input: CreateContactInput
    ): Promise<Contact> {
      const { tags, ...contactData } = input;

      const [contact] = await knex(TABLE_NAME)
        .insert({
          ...contactData,
          tenant: tenantId,
          is_inactive: false,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('*');

      // Associate tags if provided
      if (tags && tags.length > 0) {
        await knex('contact_tags').insert(
          tags.map((tagId) => ({
            contact_id: contact.contact_name_id,
            tag_id: tagId,
            tenant: tenantId,
          }))
        );
      }

      return contact;
    },

    /**
     * Update an existing contact
     */
    async update(
      tenantId: string,
      input: UpdateContactInput
    ): Promise<Contact | null> {
      const { contact_name_id, tags, ...updateData } = input;

      const [contact] = await knex(TABLE_NAME)
        .where({ tenant: tenantId, contact_name_id })
        .update({
          ...updateData,
          updated_at: new Date(),
        })
        .returning('*');

      if (!contact) {
        return null;
      }

      // Update tags if provided
      if (tags !== undefined) {
        // Remove existing tags
        await knex('contact_tags')
          .where({ contact_id: contact_name_id, tenant: tenantId })
          .delete();

        // Add new tags
        if (tags.length > 0) {
          await knex('contact_tags').insert(
            tags.map((tagId) => ({
              contact_id: contact_name_id,
              tag_id: tagId,
              tenant: tenantId,
            }))
          );
        }
      }

      return contact;
    },

    /**
     * Delete a contact (soft delete by setting is_inactive)
     */
    async delete(tenantId: string, contactId: string): Promise<boolean> {
      const result = await knex(TABLE_NAME)
        .where({ tenant: tenantId, contact_name_id: contactId })
        .update({ is_inactive: true, updated_at: new Date() });

      return result > 0;
    },

    /**
     * Hard delete a contact (permanent)
     */
    async hardDelete(tenantId: string, contactId: string): Promise<boolean> {
      // Delete tags first
      await knex('contact_tags')
        .where({ contact_id: contactId, tenant: tenantId })
        .delete();

      const result = await knex(TABLE_NAME)
        .where({ tenant: tenantId, contact_name_id: contactId })
        .delete();

      return result > 0;
    },
  };
}

// Default export for convenience when used with dependency injection
export const contactRepository = {
  create: createContactRepository,
};
