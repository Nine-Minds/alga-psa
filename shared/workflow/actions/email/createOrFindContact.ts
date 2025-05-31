/**
 * Create or find contact by email and company
 * This action creates a new contact or returns an existing one
 */

import { WorkflowAction } from '../../core/workflowContext';

export interface CreateOrFindContactInput {
  email: string;
  name?: string;
  company_id: string;
  phone?: string;
  title?: string;
}

export interface CreateOrFindContactOutput {
  id: string;
  name: string;
  email: string;
  company_id: string;
  phone?: string;
  title?: string;
  created_at: string;
  is_new: boolean;
}

export const createOrFindContact: WorkflowAction<CreateOrFindContactInput, CreateOrFindContactOutput> = {
  name: 'create_or_find_contact',
  description: 'Create a new contact or return existing contact by email and company',
  
  async execute(input: CreateOrFindContactInput, context: any): Promise<CreateOrFindContactOutput> {
    const { logger } = context;
    
    try {
      logger.info(`Creating or finding contact: ${input.email} for company ${input.company_id}`);
      
      // First, try to find existing contact
      const existingContact = await findExistingContact(input.email, input.company_id);
      
      if (existingContact) {
        logger.info(`Found existing contact: ${existingContact.id}`);
        return {
          ...existingContact,
          is_new: false
        };
      }
      
      // Create new contact if not found
      logger.info(`Creating new contact for email: ${input.email}`);
      
      // TODO: Implement actual database insertion
      console.log(`[MOCK] Creating contact:`, {
        email: input.email,
        name: input.name,
        company_id: input.company_id,
        phone: input.phone,
        title: input.title
      });
      
      // Mock query structure would be:
      // INSERT INTO contacts (id, tenant, name, email, phone, title, company_id, created_at, updated_at)
      // VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, ?, NOW(), NOW())
      // RETURNING id, name, email, phone, title, company_id, created_at
      
      const mockContactId = `contact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const createdAt = new Date().toISOString();
      
      const result: CreateOrFindContactOutput = {
        id: mockContactId,
        name: input.name || extractNameFromEmail(input.email),
        email: input.email,
        company_id: input.company_id,
        phone: input.phone,
        title: input.title,
        created_at: createdAt,
        is_new: true
      };
      
      logger.info(`Contact created successfully: ${result.id}`);
      return result;
      
    } catch (error: any) {
      logger.error(`Failed to create or find contact: ${error.message}`);
      throw new Error(`Contact creation/lookup failed: ${error.message}`);
    }
  }
};

/**
 * Find existing contact by email and company
 */
async function findExistingContact(email: string, companyId: string): Promise<Omit<CreateOrFindContactOutput, 'is_new'> | null> {
  try {
    // TODO: Implement actual database query
    console.log(`[MOCK] Searching for existing contact: ${email} in company ${companyId}`);
    
    // Mock query structure would be:
    // SELECT id, name, email, phone, title, company_id, created_at
    // FROM contacts
    // WHERE tenant = ? AND LOWER(email) = LOWER(?) AND company_id = ?
    
    // For demonstration, return null (no existing contact found)
    return null;
    
  } catch (error) {
    console.error('Error finding existing contact:', error);
    return null;
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