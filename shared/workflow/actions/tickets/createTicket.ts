/**
 * Create new ticket
 * This action creates a new ticket in the system
 */

import { WorkflowAction } from '../../types/workflowActionTypes';

export interface CreateTicketInput {
  title: string;
  description: string;
  company_id?: string;
  contact_id?: string;
  source?: string;
  channel_id?: string;
  status_id?: string;
  priority_id?: string;
  category_id?: string;
  severity_id?: string;
  urgency_id?: string;
  impact_id?: string;
  assigned_to?: string;
  email_metadata?: any;
  custom_fields?: Record<string, any>;
}

export interface CreateTicketOutput {
  id: string;
  ticket_number: string;
  title: string;
  description: string;
  company_id?: string;
  contact_id?: string;
  status_id: string;
  priority_id: string;
  created_at: string;
  updated_at: string;
}

export const createTicket: WorkflowAction<CreateTicketInput, CreateTicketOutput> = {
  name: 'create_ticket',
  description: 'Create a new ticket in the system',
  
  async execute(input: CreateTicketInput, context: any): Promise<CreateTicketOutput> {
    const { logger } = context;
    
    try {
      logger.info(`Creating new ticket: ${input.title}`);
      
      // TODO: Implement actual database insertion
      console.log(`[MOCK] Creating ticket:`, {
        title: input.title,
        description: input.description,
        company_id: input.company_id,
        contact_id: input.contact_id,
        source: input.source,
        channel_id: input.channel_id,
        status_id: input.status_id,
        priority_id: input.priority_id,
        email_metadata: input.email_metadata
      });
      
      // Generate mock ticket number
      const ticketNumber = `TKT-${Date.now().toString().slice(-6)}`;
      
      // Mock query structure would be:
      // INSERT INTO tickets (
      //   id, tenant, ticket_number, title, description, 
      //   company_id, contact_id, source, channel_id, status_id, priority_id,
      //   category_id, severity_id, urgency_id, impact_id, assigned_to,
      //   email_metadata, custom_fields, created_at, updated_at
      // ) VALUES (
      //   gen_random_uuid(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
      // )
      // RETURNING id, ticket_number, title, description, company_id, contact_id, 
      //          status_id, priority_id, created_at, updated_at
      
      const mockTicketId = `ticket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const timestamp = new Date().toISOString();
      
      const result: CreateTicketOutput = {
        id: mockTicketId,
        ticket_number: ticketNumber,
        title: input.title,
        description: input.description,
        company_id: input.company_id,
        contact_id: input.contact_id,
        status_id: input.status_id || 'status-new-123', // Default to 'New' status
        priority_id: input.priority_id || 'priority-medium-123', // Default to 'Medium' priority
        created_at: timestamp,
        updated_at: timestamp
      };
      
      logger.info(`Ticket created successfully: ${result.ticket_number} (${result.id})`);
      return result;
      
    } catch (error: any) {
      logger.error(`Failed to create ticket: ${error.message}`);
      throw new Error(`Ticket creation failed: ${error.message}`);
    }
  }
};