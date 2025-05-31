/**
 * Create ticket comment
 * This action adds a comment to an existing ticket
 */

import { WorkflowAction } from '../../core/workflowContext';

export interface CreateTicketCommentInput {
  ticket_id: string;
  content: string;
  format?: 'text' | 'html' | 'markdown';
  source?: string;
  author_type?: 'user' | 'contact' | 'system';
  author_id?: string; // user_id or contact_id depending on author_type
  is_internal?: boolean;
  metadata?: Record<string, any>;
}

export interface CreateTicketCommentOutput {
  id: string;
  ticket_id: string;
  content: string;
  format: string;
  source?: string;
  author_type: string;
  author_id?: string;
  is_internal: boolean;
  created_at: string;
  updated_at: string;
}

export const createTicketComment: WorkflowAction<CreateTicketCommentInput, CreateTicketCommentOutput> = {
  name: 'create_ticket_comment',
  description: 'Add a comment to an existing ticket',
  
  async execute(input: CreateTicketCommentInput, context: any): Promise<CreateTicketCommentOutput> {
    const { logger } = context;
    
    try {
      logger.info(`Adding comment to ticket: ${input.ticket_id}`);
      
      // TODO: Implement actual database insertion
      console.log(`[MOCK] Creating ticket comment:`, {
        ticket_id: input.ticket_id,
        content: input.content.substring(0, 100) + (input.content.length > 100 ? '...' : ''),
        format: input.format || 'text',
        source: input.source,
        author_type: input.author_type || 'system',
        author_id: input.author_id,
        is_internal: input.is_internal || false,
        metadata: input.metadata
      });
      
      // Mock query structure would be:
      // INSERT INTO comments (
      //   id, tenant, ticket_id, content, format, source, 
      //   author_type, author_id, is_internal, metadata, 
      //   created_at, updated_at
      // ) VALUES (
      //   gen_random_uuid(), ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW()
      // )
      // RETURNING id, ticket_id, content, format, source, author_type, 
      //          author_id, is_internal, created_at, updated_at
      
      const mockCommentId = `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const timestamp = new Date().toISOString();
      
      const result: CreateTicketCommentOutput = {
        id: mockCommentId,
        ticket_id: input.ticket_id,
        content: input.content,
        format: input.format || 'text',
        source: input.source,
        author_type: input.author_type || 'system',
        author_id: input.author_id,
        is_internal: input.is_internal || false,
        created_at: timestamp,
        updated_at: timestamp
      };
      
      logger.info(`Comment created successfully: ${result.id}`);
      return result;
      
    } catch (error: any) {
      logger.error(`Failed to create ticket comment: ${error.message}`);
      throw new Error(`Comment creation failed: ${error.message}`);
    }
  }
};