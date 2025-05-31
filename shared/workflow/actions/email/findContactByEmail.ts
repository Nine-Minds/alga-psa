/**
 * Find contact by email address
 * This action searches for existing contacts with the specified email address
 */

import { WorkflowAction } from '../../core/workflowContext';

export interface FindContactByEmailInput {
  email: string;
}

export interface FindContactByEmailOutput {
  contact_id: string;
  name: string;
  email: string;
  company_id: string;
  company_name: string;
  phone?: string;
  title?: string;
}

export const findContactByEmail: WorkflowAction<FindContactByEmailInput, FindContactByEmailOutput | null> = {
  name: 'find_contact_by_email',
  description: 'Find existing contact by email address with company information',
  
  async execute(input: FindContactByEmailInput, context: any): Promise<FindContactByEmailOutput | null> {
    const { logger } = context;
    
    try {
      logger.info(`Searching for contact with email: ${input.email}`);
      
      // TODO: Implement actual database query
      // This would search the contacts table for the email address
      
      console.log(`[MOCK] Searching for contact with email: ${input.email}`);
      
      // Mock query structure would be:
      // SELECT c.id as contact_id, c.name, c.email, c.phone, c.title,
      //        co.id as company_id, co.name as company_name
      // FROM contacts c
      // LEFT JOIN companies co ON c.company_id = co.id
      // WHERE c.tenant = ? AND LOWER(c.email) = LOWER(?)
      
      // For demonstration, return a mock result for known emails
      if (input.email === 'demo@example.com') {
        return {
          contact_id: 'contact-123-456',
          name: 'Demo Contact',
          email: input.email,
          company_id: 'company-789-012',
          company_name: 'Demo Company Inc.',
          phone: '+1-555-0123',
          title: 'Technical Support'
        };
      }
      
      // Return null if no contact found
      return null;
      
    } catch (error: any) {
      logger.error(`Error finding contact by email: ${error.message}`);
      return null; // Don't throw - just return null if we can't find a match
    }
  }
};