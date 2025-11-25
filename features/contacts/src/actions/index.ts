/**
 * Contact server actions
 *
 * These are Next.js server actions for contact operations.
 * They handle validation, authorization, and delegate to the repository.
 */

'use server';

import { createContactRepository } from '../repositories/index.js';
import {
  createContactSchema,
  updateContactSchema,
  type Contact,
  type ContactFilters,
  type ContactListResponse,
  type CreateContactInput,
  type UpdateContactInput,
} from '../types/index.js';

// Note: In the real implementation, these would import from @alga-psa/database
// For now, we define the types that will be injected
type Knex = import('knex').Knex;

/**
 * Server action context provided by the app shell
 */
interface ActionContext {
  tenantId: string;
  userId: string;
  knex: Knex;
}

/**
 * Get a list of contacts for the current tenant
 */
export async function getContacts(
  context: ActionContext,
  filters: ContactFilters = {}
): Promise<ContactListResponse> {
  const repo = createContactRepository(context.knex);
  return repo.findMany(context.tenantId, filters);
}

/**
 * Get a single contact by ID
 */
export async function getContact(
  context: ActionContext,
  contactId: string
): Promise<Contact | null> {
  const repo = createContactRepository(context.knex);
  return repo.findById(context.tenantId, contactId);
}

/**
 * Create a new contact
 */
export async function createContact(
  context: ActionContext,
  input: CreateContactInput
): Promise<{ success: true; contact: Contact } | { success: false; error: string }> {
  // Validate input
  const validation = createContactSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createContactRepository(context.knex);
    const contact = await repo.create(context.tenantId, validation.data);
    return { success: true, contact };
  } catch (error) {
    console.error('[contacts/actions] Failed to create contact:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create contact',
    };
  }
}

/**
 * Update an existing contact
 */
export async function updateContact(
  context: ActionContext,
  input: UpdateContactInput
): Promise<{ success: true; contact: Contact } | { success: false; error: string }> {
  // Validate input
  const validation = updateContactSchema.safeParse(input);
  if (!validation.success) {
    return {
      success: false,
      error: validation.error.errors.map((e) => e.message).join(', '),
    };
  }

  try {
    const repo = createContactRepository(context.knex);
    const contact = await repo.update(context.tenantId, validation.data);

    if (!contact) {
      return { success: false, error: 'Contact not found' };
    }

    return { success: true, contact };
  } catch (error) {
    console.error('[contacts/actions] Failed to update contact:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update contact',
    };
  }
}

/**
 * Delete a contact (soft delete)
 */
export async function deleteContact(
  context: ActionContext,
  contactId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const repo = createContactRepository(context.knex);
    const deleted = await repo.delete(context.tenantId, contactId);

    if (!deleted) {
      return { success: false, error: 'Contact not found' };
    }

    return { success: true };
  } catch (error) {
    console.error('[contacts/actions] Failed to delete contact:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to delete contact',
    };
  }
}
