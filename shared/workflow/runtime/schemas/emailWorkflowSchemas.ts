import { z } from 'zod';

/**
 * Schema for email sender/recipient address
 */
const emailAddressSchema = z.object({
  email: z.string().email().describe('Email address'),
  name: z.string().optional().describe('Display name')
}).describe('Email address with optional display name');

/**
 * Schema for email body content
 */
const emailBodySchema = z.object({
  text: z.string().optional().describe('Plain text content'),
  html: z.string().optional().describe('HTML content')
}).describe('Email body in text and/or HTML format');

/**
 * Schema for email attachment metadata
 */
const emailAttachmentSchema = z.object({
  id: z.string().describe('Attachment ID'),
  name: z.string().describe('Filename'),
  contentType: z.string().describe('MIME content type'),
  size: z.number().int().positive().describe('Size in bytes'),
  contentId: z.string().optional().describe('Content-ID for inline attachments')
}).describe('Email attachment metadata');

/**
 * Schema for inbound email data - the core email information
 */
const emailDataSchema = z.object({
  id: z.string().describe('Email message ID'),
  mailhogId: z.string().optional().describe('Mailhog ID (for testing)'),
  threadId: z.string().optional().describe('Email thread ID'),
  from: emailAddressSchema.describe('Sender address'),
  to: z.array(emailAddressSchema).optional().describe('Recipients'),
  cc: z.array(emailAddressSchema).optional().describe('CC recipients'),
  bcc: z.array(emailAddressSchema).optional().describe('BCC recipients'),
  subject: z.string().describe('Email subject line'),
  body: emailBodySchema.describe('Email body content'),
  inReplyTo: z.string().optional().describe('In-Reply-To header (for threading)'),
  references: z.array(z.string()).optional().describe('References header values'),
  attachments: z.array(emailAttachmentSchema).optional().describe('Email attachments'),
  receivedAt: z.string().optional().describe('When the email was received (ISO 8601)'),
  tenant: z.string().optional().describe('Tenant ID'),
  providerId: z.string().optional().describe('Email provider ID')
}).describe('Inbound email data from the email provider');

/**
 * Schema for parsed email reply result
 */
const parsedEmailSchema = z.object({
  sanitizedText: z.string().describe('Cleaned text without quoted content'),
  sanitizedHtml: z.string().optional().describe('Cleaned HTML content'),
  confidence: z.enum(['high', 'medium', 'low']).describe('Parser confidence'),
  metadata: z.object({
    parser: z.object({
      confidence: z.enum(['high', 'medium', 'low']).optional(),
      strategy: z.string().optional().describe('Parsing strategy used'),
      heuristics: z.array(z.string()).optional().describe('Applied heuristics'),
      warnings: z.array(z.string()).optional().describe('Parser warnings'),
      tokens: z.object({
        conversationToken: z.string().optional().describe('Reply token')
      }).optional()
    }).optional()
  }).optional().describe('Parser metadata')
}).describe('Parsed email content with quoted text removed');

/**
 * Schema for existing ticket match
 */
const existingTicketSchema = z.object({
  ticketId: z.string().describe('Ticket ID'),
  ticketNumber: z.string().optional().describe('Ticket number'),
  subject: z.string().optional().describe('Ticket subject'),
  status: z.string().optional().describe('Current status')
}).describe('Existing ticket matched via threading');

/**
 * Schema for matched client/contact
 */
const matchedClientSchema = z.object({
  clientId: z.string().optional().describe('Client ID'),
  clientName: z.string().optional().describe('Client name'),
  contactId: z.string().optional().describe('Contact ID'),
  contactName: z.string().optional().describe('Contact name')
}).describe('Client/contact matched from email address');

/**
 * Schema for ticket defaults
 */
const ticketDefaultsSchema = z.object({
  board_id: z.string().optional().describe('Default board ID'),
  status_id: z.string().optional().describe('Default status ID'),
  priority_id: z.string().optional().describe('Default priority ID'),
  client_id: z.string().optional().describe('Default client ID'),
  entered_by: z.string().optional().describe('Default entered_by user'),
  category_id: z.string().optional().describe('Default category ID'),
  subcategory_id: z.string().optional().describe('Default subcategory ID'),
  location_id: z.string().optional().describe('Default location ID')
}).describe('Default values for ticket creation');

/**
 * Main email workflow payload schema
 * This represents ONLY the trigger input - data available from the start.
 * Step outputs (parsedEmail, matchedClient, ticketDefaults, etc.) should be
 * accessed via step output references, not the payload.
 */
export const emailWorkflowPayloadSchema = z.object({
  emailData: emailDataSchema.describe('The inbound email data from the trigger event'),
  providerId: z.string().describe('Email provider ID'),
  tenantId: z.string().describe('Tenant ID')
});

export type EmailWorkflowPayload = z.infer<typeof emailWorkflowPayloadSchema>;

// =============================================================================
// STEP OUTPUT SCHEMAS - for use with action outputSchema definitions
// =============================================================================

/** Output schema for parse_email_reply action */
export { parsedEmailSchema };

/** Output schema for find_ticket_by_email_thread action */
export { existingTicketSchema };

/** Output schema for find_contact_by_email / client matching */
export { matchedClientSchema };

/** Output schema for resolve_inbound_ticket_defaults action */
export { ticketDefaultsSchema };
