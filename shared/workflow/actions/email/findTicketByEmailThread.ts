/**
 * Find existing ticket by email thread information
 * This action searches for tickets that were created from emails in the same conversation thread
 */

import { WorkflowAction } from '../../types/workflowActionTypes';

export interface FindTicketByEmailThreadInput {
  threadId?: string;
  inReplyTo?: string;
  references?: string[];
  originalMessageId?: string;
}

export interface FindTicketByEmailThreadOutput {
  ticketId: string;
  ticketNumber: string;
  subject: string;
  status: string;
  originalEmailId: string;
  threadInfo: {
    threadId?: string;
    originalMessageId?: string;
  };
}

export const findTicketByEmailThread: WorkflowAction<FindTicketByEmailThreadInput, FindTicketByEmailThreadOutput | null> = {
  name: 'find_ticket_by_email_thread',
  description: 'Find existing ticket by email threading headers (In-Reply-To, References, Thread-ID)',
  
  async execute(input: FindTicketByEmailThreadInput, context: any): Promise<FindTicketByEmailThreadOutput | null> {
    const { logger } = context;
    
    try {
      logger.info('Searching for existing ticket by email thread information');
      
      // Strategy 1: Search by thread ID if available
      if (input.threadId) {
        const ticket = await findTicketByThreadId(input.threadId);
        if (ticket) {
          logger.info(`Found ticket by thread ID: ${ticket.ticketId}`);
          return ticket;
        }
      }
      
      // Strategy 2: Search by In-Reply-To header (most reliable)
      if (input.inReplyTo) {
        const ticket = await findTicketByOriginalMessageId(input.inReplyTo);
        if (ticket) {
          logger.info(`Found ticket by In-Reply-To header: ${ticket.ticketId}`);
          return ticket;
        }
      }
      
      // Strategy 3: Search by References headers
      if (input.references && input.references.length > 0) {
        for (const messageId of input.references) {
          const ticket = await findTicketByOriginalMessageId(messageId);
          if (ticket) {
            logger.info(`Found ticket by References header: ${ticket.ticketId}`);
            return ticket;
          }
        }
      }
      
      // Strategy 4: Search by original message ID directly
      if (input.originalMessageId) {
        const ticket = await findTicketByOriginalMessageId(input.originalMessageId);
        if (ticket) {
          logger.info(`Found ticket by original message ID: ${ticket.ticketId}`);
          return ticket;
        }
      }
      
      logger.info('No existing ticket found for email thread');
      return null;
      
    } catch (error: any) {
      logger.error(`Error searching for ticket by email thread: ${error.message}`);
      return null; // Don't throw - just return null if we can't find a match
    }
  }
};

/**
 * Find ticket by thread ID
 */
async function findTicketByThreadId(threadId: string): Promise<FindTicketByEmailThreadOutput | null> {
  try {
    // TODO: Implement actual database query
    // This would search the tickets table for email_metadata containing the thread ID
    
    console.log(`[MOCK] Searching for ticket with thread ID: ${threadId}`);
    
    // Mock query structure would be:
    // SELECT t.id, t.ticket_number, t.subject, s.name as status, t.email_metadata
    // FROM tickets t
    // LEFT JOIN statuses s ON t.status_id = s.id
    // WHERE t.email_metadata->>'threadId' = ?
    // OR t.email_metadata->'threadInfo'->>'threadId' = ?
    
    // Return null for now (no match found)
    return null;
    
  } catch (error) {
    console.error('Error finding ticket by thread ID:', error);
    return null;
  }
}

/**
 * Find ticket by original message ID from email metadata
 */
async function findTicketByOriginalMessageId(messageId: string): Promise<FindTicketByEmailThreadOutput | null> {
  try {
    // TODO: Implement actual database query  
    // This would search for tickets where the email_metadata contains the original message ID
    
    console.log(`[MOCK] Searching for ticket with original message ID: ${messageId}`);
    
    // Mock query structure would be:
    // SELECT t.id, t.ticket_number, t.subject, s.name as status, t.email_metadata
    // FROM tickets t
    // LEFT JOIN statuses s ON t.status_id = s.id  
    // WHERE t.email_metadata->>'messageId' = ?
    // OR t.email_metadata->'references' ? ?
    // OR t.email_metadata->>'inReplyTo' = ?
    
    // For demonstration, return a mock result if we find a "known" message ID
    if (messageId === 'demo-original-email-id') {
      return {
        ticketId: 'ticket-123-456',
        ticketNumber: 'TKT-001234',
        subject: 'Original email subject',
        status: 'Open',
        originalEmailId: 'demo-original-email-id',
        threadInfo: {
          threadId: 'demo-thread-id',
          originalMessageId: messageId
        }
      };
    }
    
    // Return null for now (no match found)
    return null;
    
  } catch (error) {
    console.error('Error finding ticket by message ID:', error);
    return null;
  }
}

/**
 * Helper function to extract message IDs from email headers
 */
export function extractMessageIdsFromHeaders(headers: Record<string, string>): {
  inReplyTo?: string;
  references: string[];
  messageId?: string;
} {
  const result: { inReplyTo?: string; references: string[]; messageId?: string; } = {
    references: []
  };
  
  // Extract In-Reply-To
  if (headers['In-Reply-To']) {
    result.inReplyTo = headers['In-Reply-To'].trim();
  }
  
  // Extract References (space-separated list)
  if (headers['References']) {
    result.references = headers['References']
      .split(/\s+/)
      .map(ref => ref.trim())
      .filter(ref => ref.length > 0);
  }
  
  // Extract Message-ID  
  if (headers['Message-ID']) {
    result.messageId = headers['Message-ID'].trim();
  }
  
  return result;
}