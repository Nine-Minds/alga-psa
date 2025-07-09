/**
 * Email action registrations for the workflow worker
 * These are registered separately from the shared library to avoid 
 * server dependencies in the shared package
 */

import { ActionRegistry, ActionExecutionContext } from '@shared/workflow/core/index.js';
import logger from '@shared/core/logger.js';

/**
 * Register email workflow actions with the action registry
 * @param actionRegistry The action registry to register with
 */
export function registerEmailActions(actionRegistry: ActionRegistry): void {
  logger.info('[EmailActions] Starting registration of email workflow actions...');

  // Find contact by email action
  actionRegistry.registerSimpleAction(
    'find_contact_by_email',
    'Find a contact by their email address',
    [
      { name: 'email', type: 'string', required: true }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        logger.info(`[ACTION] find_contact_by_email called for email: ${params.email}, tenant: ${context.tenant}`);
        console.log(`[TENANT-DEBUG] find_contact_by_email action: tenant=${context.tenant}, email=${params.email}`);
        
        // Use shared database utilities directly
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const knex = await getAdminConnection();
        
        const contact = await knex('contacts')
          .where('contacts.tenant', context.tenant)
          .whereRaw('LOWER(contacts.email) = LOWER(?)', [params.email])
          .leftJoin('companies', 'contacts.company_id', 'companies.company_id')
          .select(
            'contacts.contact_name_id as contact_id',
            'contacts.full_name as name',
            'contacts.email',
            'contacts.company_id',
            'companies.company_name',
            'contacts.phone_number as phone',
            'contacts.role as title'
          )
          .first();
        
        if (contact) {
          logger.info(`[ACTION] find_contact_by_email: Found contact for ${params.email}`);
          console.log(`[TENANT-DEBUG] find_contact_by_email found contact: tenant=${context.tenant}, contactId=${contact.contact_id}, email=${params.email}`);
          return {
            success: true,
            contact: contact
          };
        } else {
          logger.info(`[ACTION] find_contact_by_email: No contact found for ${params.email}`);
          console.log(`[TENANT-DEBUG] find_contact_by_email NO contact found: tenant=${context.tenant}, email=${params.email}`);
          return {
            success: true,
            contact: null
          };
        }
      } catch (error: any) {
        logger.error(`[ACTION] find_contact_by_email: Error finding contact by email ${params.email}`, error);
        return {
          success: false,
          message: error.message,
          error: error
        };
      }
    }
  );

  // Create ticket from email action
  actionRegistry.registerSimpleAction(
    'create_ticket_from_email',
    'Create a ticket from email data',
    [
      { name: 'title', type: 'string', required: true },
      { name: 'description', type: 'string', required: true },
      { name: 'company_id', type: 'string', required: false },
      { name: 'contact_id', type: 'string', required: false },
      { name: 'source', type: 'string', required: false },
      { name: 'channel_id', type: 'string', required: false },
      { name: 'status_id', type: 'string', required: false },
      { name: 'priority_id', type: 'string', required: false },
      { name: 'email_metadata', type: 'object', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        logger.info(`[ACTION] create_ticket_from_email called for title: ${params.title}, tenant: ${context.tenant}`);
        console.log(`[TENANT-DEBUG] create_ticket_from_email action: tenant=${context.tenant}, title=${params.title}, companyId=${params.company_id}, contactId=${params.contact_id}`);
        
        // Use shared database utilities directly
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const { withTransaction } = await import('@shared/db/index.js');
        const { v4: uuidv4 } = await import('uuid');
        const knex = await getAdminConnection();
        
        const result = await withTransaction(knex, async (trx) => {
          // Generate simple ticket number without next_numbers table
          const timestamp = Date.now();
          const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
          const ticketNumber = `TKT-${timestamp}-${randomSuffix}`;
          
          // Create ticket
          console.log(`[TENANT-DEBUG] create_ticket_from_email about to insert ticket: tenant=${context.tenant}, ticketNumber=${ticketNumber}`);
          
          const [ticket] = await trx('tickets')
            .insert({
              tenant: context.tenant,
              title: params.title,
              url: params.description, // tickets table has url field instead of description
              company_id: params.company_id || null,
              contact_name_id: params.contact_id || null, // Fixed from contact_id
              channel_id: params.channel_id || null,
              status_id: params.status_id || null,
              priority_id: params.priority_id || null,
              ticket_number: ticketNumber,
              // email_metadata column doesn't exist in tickets table
              entered_at: new Date(), // Use entered_at instead of created_at
              updated_at: new Date()
            })
            .returning(['ticket_id', 'ticket_number']);
            
          console.log(`[TENANT-DEBUG] create_ticket_from_email created ticket: tenant=${context.tenant}, ticketId=${ticket.ticket_id}, ticketNumber=${ticket.ticket_number}`);

          return { ticket_id: ticket.ticket_id, ticket_number: ticket.ticket_number };
        });
        
        logger.info(`[ACTION] create_ticket_from_email: Created ticket with ID: ${result.ticket_id}`);
        console.log(`[TENANT-DEBUG] create_ticket_from_email completed: tenant=${context.tenant}, ticketId=${result.ticket_id}, ticketNumber=${result.ticket_number}`);
        return {
          success: true,
          ticket_id: result.ticket_id,
          ticket: result
        };
      } catch (error: any) {
        logger.error(`[ACTION] create_ticket_from_email: Error creating ticket from email`, error);
        console.log(`[TENANT-DEBUG] create_ticket_from_email ERROR: tenant=${context.tenant}, error=${error.message}`);
        return {
          success: false,
          message: error.message,
          error: error
        };
      }
    }
  );

  // Create comment from email action
  actionRegistry.registerSimpleAction(
    'create_comment_from_email',
    'Create a comment from email data',
    [
      { name: 'ticket_id', type: 'string', required: true },
      { name: 'content', type: 'string', required: true },
      { name: 'format', type: 'string', required: false },
      { name: 'source', type: 'string', required: false },
      { name: 'author_type', type: 'string', required: false },
      { name: 'author_id', type: 'string', required: false },
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        logger.info(`[ACTION] create_comment_from_email called for ticket: ${params.ticket_id}, tenant: ${context.tenant}`);
        
        // Use shared database utilities directly
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const { withTransaction } = await import('@shared/db/index.js');
        const knex = await getAdminConnection();
        
        const comment_id = await withTransaction(knex, async (trx) => {
          const [comment] = await trx('comments')
            .insert({
              tenant: context.tenant,
              ticket_id: params.ticket_id,
              note: params.content,
              is_internal: false,
              is_resolution: false,
              author_type: params.author_type || 'internal',
              markdown_content: params.content, // Add markdown content column
              created_at: new Date(),
              updated_at: new Date()
            })
            .returning('comment_id');

          return comment.comment_id;
        });
        
        logger.info(`[ACTION] create_comment_from_email: Created comment with ID: ${comment_id}`);
        return {
          success: true,
          comment_id: comment_id,
          comment: comment_id
        };
      } catch (error: any) {
        logger.error(`[ACTION] create_comment_from_email: Error creating comment from email`, error);
        return {
          success: false,
          message: error.message,
          error: error
        };
      }
    }
  );

  // Process email attachment action
  actionRegistry.registerSimpleAction(
    'process_email_attachment',
    'Process an email attachment',
    [
      { name: 'emailId', type: 'string', required: true },
      { name: 'attachmentId', type: 'string', required: true },
      { name: 'ticketId', type: 'string', required: true },
      { name: 'providerId', type: 'string', required: true },
      { name: 'attachmentData', type: 'object', required: true }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        logger.info(`[ACTION] process_email_attachment called for attachment: ${params.attachmentId}, tenant: ${context.tenant}`);
        
        // Use shared database utilities directly
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const { withTransaction } = await import('@shared/db/index.js');
        const { v4: uuidv4 } = await import('uuid');
        const knex = await getAdminConnection();
        
        const result = await withTransaction(knex, async (trx) => {
          const documentId = uuidv4();
          const now = new Date();

          // Create document record for the attachment
          await trx('documents').insert({
            document_id: documentId,
            tenant: context.tenant,
            name: params.attachmentData.name,
            file_size: params.attachmentData.size,
            content_type: params.attachmentData.contentType,
            source: 'email_attachment',
            metadata: {
              emailId: params.emailId,
              attachmentId: params.attachmentId,
              providerId: params.providerId,
              contentId: params.attachmentData.contentId
            },
            created_at: now,
            updated_at: now
          });

          // Associate document with ticket
          await trx('document_associations').insert({
            document_id: documentId,
            entity_type: 'ticket',
            entity_id: params.ticketId,
            tenant: context.tenant,
            created_at: now
          });

          return {
            documentId: documentId,
            fileName: params.attachmentData.name,
            fileSize: params.attachmentData.size,
            contentType: params.attachmentData.contentType,
            success: true
          };
        });
        
        logger.info(`[ACTION] process_email_attachment: Processed attachment ${params.attachmentId}`);
        return {
          success: true,
          document_id: result.documentId,
          file_name: result.fileName,
          file_size: result.fileSize,
          content_type: result.contentType
        };
      } catch (error: any) {
        logger.error(`[ACTION] process_email_attachment: Error processing attachment ${params.attachmentId}`, error);
        return {
          success: false,
          message: error.message,
          error: error
        };
      }
    }
  );

  // Find ticket by email thread action
  actionRegistry.registerSimpleAction(
    'find_ticket_by_email_thread',
    'Find a ticket by email thread ID',
    [
      { name: 'threadId', type: 'string', required: false },
      { name: 'inReplyTo', type: 'string', required: false },
      { name: 'references', type: 'array', required: false },
      { name: 'originalMessageId', type: 'string', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        logger.info(`[ACTION] find_ticket_by_email_thread called with threadId: ${params.threadId}, tenant: ${context.tenant}`);
        
        // Use shared database utilities directly
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const knex = await getAdminConnection();
        
        // Search for ticket by various email thread identifiers
        let ticket = null;
        
        // Strategy 1: Search by thread ID if available
        if (params.threadId) {
          ticket = await knex('tickets as t')
            .leftJoin('statuses as s', 't.status_id', 's.status_id')
            .select(
              't.ticket_id as ticketId',
              't.ticket_number as ticketNumber',
              't.title as subject',
              's.name as status',
              't.email_metadata'
            )
            .where('t.tenant', context.tenant)
            .whereRaw("t.email_metadata->>'threadId' = ?", [params.threadId])
            .first();
        }
        
        // Strategy 2: Search by In-Reply-To header if no ticket found yet
        if (!ticket && params.inReplyTo) {
          ticket = await knex('tickets as t')
            .leftJoin('statuses as s', 't.status_id', 's.status_id')
            .select(
              't.ticket_id as ticketId',
              't.ticket_number as ticketNumber', 
              't.title as subject',
              's.name as status',
              't.email_metadata'
            )
            .where('t.tenant', context.tenant)
            .whereRaw("t.email_metadata->>'originalMessageId' = ?", [params.inReplyTo])
            .first();
        }
        
        if (ticket) {
          logger.info(`[ACTION] find_ticket_by_email_thread: Found ticket ${ticket.ticketId}`);
          return {
            success: true,
            ticket: ticket
          };
        } else {
          logger.info(`[ACTION] find_ticket_by_email_thread: No ticket found for thread ${params.threadId}`);
          return {
            success: true,
            ticket: null
          };
        }
      } catch (error: any) {
        logger.error(`[ACTION] find_ticket_by_email_thread: Error finding ticket by thread ${params.threadId}`, error);
        return {
          success: false,
          message: error.message,
          error: error
        };
      }
    }
  );

  // Create or find contact action
  actionRegistry.registerSimpleAction(
    'create_or_find_contact',
    'Create a new contact or find existing one by email',
    [
      { name: 'email', type: 'string', required: true },
      { name: 'name', type: 'string', required: false },
      { name: 'company_id', type: 'string', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        logger.info(`[ACTION] create_or_find_contact called for email: ${params.email}, tenant: ${context.tenant}`);
        console.log(`[TENANT-DEBUG] create_or_find_contact action: tenant=${context.tenant}, email=${params.email}, name=${params.name}`);
        
        // Use shared database utilities directly
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const { withTransaction } = await import('@shared/db/index.js');
        const { v4: uuidv4 } = await import('uuid');
        const knex = await getAdminConnection();
        
        const contact = await withTransaction(knex, async (trx) => {
          // First try to find existing contact
          const existing = await trx('contacts')
            .where('tenant', context.tenant)
            .whereRaw('LOWER(email) = LOWER(?)', [params.email])
            .first();
          
          if (existing) {
            console.log(`[TENANT-DEBUG] create_or_find_contact found existing contact: tenant=${context.tenant}, contactId=${existing.contact_name_id}, email=${params.email}`);
            return {
              id: existing.contact_name_id,
              name: existing.full_name,
              email: existing.email,
              company_id: existing.company_id || '',
              phone: existing.phone_number,
              title: existing.role,
              created_at: existing.created_at,
              is_new: false
            };
          }
          
          // Create new contact
          const contactId = uuidv4();
          const now = new Date();
          
          console.log(`[TENANT-DEBUG] create_or_find_contact creating new contact: tenant=${context.tenant}, contactId=${contactId}, email=${params.email}`);
          
          await trx('contacts').insert({
            contact_name_id: contactId,
            tenant: context.tenant,
            full_name: params.name || 'Unknown',
            email: params.email,
            company_id: params.company_id,
            created_at: now,
            updated_at: now
          });
          
          console.log(`[TENANT-DEBUG] create_or_find_contact created new contact: tenant=${context.tenant}, contactId=${contactId}, email=${params.email}`);
          
          return {
            id: contactId,
            name: params.name || 'Unknown',
            email: params.email,
            company_id: params.company_id || '',
            phone: null,
            title: null,
            created_at: now.toISOString(),
            is_new: true
          };
        });
        
        logger.info(`[ACTION] create_or_find_contact: Contact ID: ${contact.id}`);
        console.log(`[TENANT-DEBUG] create_or_find_contact completed: tenant=${context.tenant}, contactId=${contact.id}, isNew=${contact.is_new}`);
        return {
          success: true,
          contact_id: contact.id,
          contact: contact,
          created: contact.is_new
        };
      } catch (error: any) {
        logger.error(`[ACTION] create_or_find_contact: Error creating/finding contact for ${params.email}`, error);
        console.log(`[TENANT-DEBUG] create_or_find_contact ERROR: tenant=${context.tenant}, email=${params.email}, error=${error.message}`);
        return {
          success: false,
          message: error.message,
          error: error
        };
      }
    }
  );

  // Save email client association action
  actionRegistry.registerSimpleAction(
    'save_email_client_association',
    'Save association between email and client',
    [
      { name: 'email', type: 'string', required: true },
      { name: 'contact_id', type: 'string', required: true },
      { name: 'company_id', type: 'string', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        logger.info(`[ACTION] save_email_client_association called for email: ${params.email}, tenant: ${context.tenant}`);
        
        // Use shared database utilities directly
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const { withTransaction } = await import('@shared/db/index.js');
        const { v4: uuidv4 } = await import('uuid');
        const knex = await getAdminConnection();
        
        const association = await withTransaction(knex, async (trx) => {
          const associationId = uuidv4();
          const now = new Date();

          // Check if association already exists
          const existing = await trx('email_client_associations')
            .where('tenant', context.tenant)
            .whereRaw('LOWER(email) = LOWER(?)', [params.email])
            .where('company_id', params.company_id)
            .first();

          if (existing) {
            // Update existing association
            await trx('email_client_associations')
              .where('id', existing.id)
              .update({
                contact_name_id: params.contact_id,
                updated_at: now
              });

            return {
              associationId: existing.id,
              email: params.email,
              company_id: params.company_id
            };
          } else {
            // Create new association
            await trx('email_client_associations').insert({
              id: associationId,
              tenant: context.tenant,
              email: params.email,
              contact_name_id: params.contact_id,
              company_id: params.company_id,
              created_at: now,
              updated_at: now
            });

            return {
              associationId: associationId,
              email: params.email,
              company_id: params.company_id
            };
          }
        });
        
        logger.info(`[ACTION] save_email_client_association: Association saved with ID: ${association.associationId}`);
        return {
          success: true,
          association_id: association.associationId,
          association: association
        };
      } catch (error: any) {
        logger.error(`[ACTION] save_email_client_association: Error saving association for ${params.email}`, error);
        return {
          success: false,
          message: error.message,
          error: error
        };
      }
    }
  );

  // Create company from email action
  actionRegistry.registerSimpleAction(
    'create_company_from_email',
    'Create a company based on email domain',
    [
      { name: 'company_name', type: 'string', required: true },
      { name: 'email', type: 'string', required: false },
      { name: 'source', type: 'string', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        logger.info(`[ACTION] create_company_from_email called for company: ${params.company_name}, tenant: ${context.tenant}`);
        
        // Use shared database utilities directly
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const { withTransaction } = await import('@shared/db/index.js');
        const { v4: uuidv4 } = await import('uuid');
        const knex = await getAdminConnection();
        
        const company = await withTransaction(knex, async (trx) => {
          const companyId = uuidv4();
          const [newCompany] = await trx('companies')
            .insert({
              company_id: companyId,
              tenant: context.tenant,
              company_name: params.company_name,
              email: params.email,
              source: params.source || 'email',
              created_at: new Date(),
              updated_at: new Date()
            })
            .returning(['company_id', 'company_name']);

          return {
            company_id: newCompany.company_id,
            company_name: newCompany.company_name
          };
        });
        
        logger.info(`[ACTION] create_company_from_email: Created company with ID: ${company.company_id}`);
        return {
          success: true,
          company_id: company.company_id,
          company: company
        };
      } catch (error: any) {
        logger.error(`[ACTION] create_company_from_email: Error creating company from email`, error);
        return {
          success: false,
          message: error.message,
          error: error
        };
      }
    }
  );

  // Get company by ID for email action
  actionRegistry.registerSimpleAction(
    'get_company_by_id_for_email',
    'Get company details by ID for email processing',
    [
      { name: 'company_id', type: 'string', required: true }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        logger.info(`[ACTION] get_company_by_id_for_email called for company: ${params.company_id}, tenant: ${context.tenant}`);
        
        // Use shared database utilities directly
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const knex = await getAdminConnection();
        
        const company = await knex('companies')
          .select('company_id', 'company_name')
          .where({ company_id: params.company_id, tenant: context.tenant })
          .first();
        
        if (company) {
          logger.info(`[ACTION] get_company_by_id_for_email: Found company ${company.company_name}`);
          return {
            success: true,
            company: company
          };
        } else {
          logger.info(`[ACTION] get_company_by_id_for_email: Company not found ${params.company_id}`);
          return {
            success: false,
            message: 'Company not found'
          };
        }
      } catch (error: any) {
        logger.error(`[ACTION] get_company_by_id_for_email: Error getting company ${params.company_id}`, error);
        return {
          success: false,
          message: error.message,
          error: error
        };
      }
    }
  );

  // Create channel from email action
  actionRegistry.registerSimpleAction(
    'create_channel_from_email',
    'Create a channel based on email processing',
    [
      { name: 'channel_name', type: 'string', required: true },
      { name: 'description', type: 'string', required: false },
      { name: 'is_default', type: 'boolean', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        logger.info(`[ACTION] create_channel_from_email called for channel: ${params.channel_name}, tenant: ${context.tenant}`);
        
        // Use shared database utilities directly
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const { withTransaction } = await import('@shared/db/index.js');
        const { v4: uuidv4 } = await import('uuid');
        const knex = await getAdminConnection();
        
        const channel = await withTransaction(knex, async (trx) => {
          const channelId = uuidv4();
          const [newChannel] = await trx('channels')
            .insert({
              channel_id: channelId,
              tenant: context.tenant,
              channel_name: params.channel_name,
              description: params.description || '',
              is_default: params.is_default || false,
              is_active: true,
              created_at: new Date(),
              updated_at: new Date()
            })
            .returning(['channel_id', 'channel_name']);

          return {
            channel_id: newChannel.channel_id,
            channel_name: newChannel.channel_name
          };
        });
        
        logger.info(`[ACTION] create_channel_from_email: Created channel with ID: ${channel.channel_id}`);
        return {
          success: true,
          channel_id: channel.channel_id,
          channel: channel
        };
      } catch (error: any) {
        logger.error(`[ACTION] create_channel_from_email: Error creating channel from email`, error);
        return {
          success: false,
          message: error.message,
          error: error
        };
      }
    }
  );

  // Find channel by name action
  actionRegistry.registerSimpleAction(
    'find_channel_by_name',
    'Find a channel by its name',
    [
      { name: 'name', type: 'string', required: true }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        logger.info(`[ACTION] find_channel_by_name called for channel: ${params.name}, tenant: ${context.tenant}`);
        
        // Use shared database utilities directly
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const knex = await getAdminConnection();
        
        const channel = await knex('channels')
          .where('tenant', context.tenant)
          .where('channel_name', params.name)
          .select(
            'channel_id',
            'channel_name',
            'description',
            'is_inactive',
            'is_default',
            'display_order'
          )
          .first();
        
        if (channel) {
          logger.info(`[ACTION] find_channel_by_name: Found channel ${params.name}`);
          return {
            success: true,
            channel,
            exists: true
          };
        } else {
          logger.info(`[ACTION] find_channel_by_name: Channel ${params.name} not found`);
          return {
            success: true,
            channel: null,
            exists: false
          };
        }
      } catch (error) {
        logger.error(`[ACTION] find_channel_by_name error for channel ${params.name}:`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          channel: null,
          exists: false
        };
      }
    }
  );

  // Create channel from email action
  actionRegistry.registerSimpleAction(
    'create_channel_from_email',
    'Create a new channel for email processing',
    [
      { name: 'channel_name', type: 'string', required: true },
      { name: 'description', type: 'string', required: false },
      { name: 'is_default', type: 'boolean', required: false }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        logger.info(`[ACTION] create_channel_from_email called for channel: ${params.channel_name}, tenant: ${context.tenant}`);
        
        // Use shared database utilities directly
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const knex = await getAdminConnection();
        const { v4: uuidv4 } = await import('uuid');
        
        const channelId = uuidv4();
        const channelData = {
          channel_id: channelId,
          tenant: context.tenant,
          channel_name: params.channel_name,
          description: params.description || 'Auto-created channel for email processing',
          is_inactive: false,
          is_default: params.is_default || false,
          display_order: 999 // Put at end
        };
        
        await knex('channels').insert(channelData);
        
        logger.info(`[ACTION] create_channel_from_email: Created channel ${params.channel_name} with ID ${channelId}`);
        return {
          success: true,
          channel: channelData
        };
      } catch (error) {
        logger.error(`[ACTION] create_channel_from_email error for channel ${params.channel_name}:`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          channel: null
        };
      }
    }
  );

  // Find status by name action
  actionRegistry.registerSimpleAction(
    'find_status_by_name',
    'Find a ticket status by its name',
    [
      { name: 'name', type: 'string', required: true }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        logger.info(`[ACTION] find_status_by_name called for status: ${params.name}, tenant: ${context.tenant}`);
        
        // Use shared database utilities directly
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const knex = await getAdminConnection();
        
        const status = await knex('statuses')
          .where('tenant', context.tenant)
          .where('name', params.name)
          .select(
            'status_id',
            'name',
            'status_type',
            'order_number',
            'is_closed',
            'is_default'
          )
          .first();
        
        if (status) {
          logger.info(`[ACTION] find_status_by_name: Found status ${params.name}`);
          return {
            success: true,
            status,
            exists: true
          };
        } else {
          logger.info(`[ACTION] find_status_by_name: Status ${params.name} not found`);
          return {
            success: true,
            status: null,
            exists: false
          };
        }
      } catch (error) {
        logger.error(`[ACTION] find_status_by_name error for status ${params.name}:`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          status: null,
          exists: false
        };
      }
    }
  );

  // Find priority by name action
  actionRegistry.registerSimpleAction(
    'find_priority_by_name',
    'Find a ticket priority by its name',
    [
      { name: 'name', type: 'string', required: true }
    ],
    async (params: Record<string, any>, context: ActionExecutionContext) => {
      try {
        logger.info(`[ACTION] find_priority_by_name called for priority: ${params.name}, tenant: ${context.tenant}`);
        
        // Use shared database utilities directly
        const { getAdminConnection } = await import('@shared/db/admin.js');
        const knex = await getAdminConnection();
        
        const priority = await knex('priorities')
          .where('tenant', context.tenant)
          .where('priority_name', params.name)
          .select(
            'priority_id',
            'priority_name',
            'order_number',
            'color',
            'item_type'
          )
          .first();
        
        if (priority) {
          logger.info(`[ACTION] find_priority_by_name: Found priority ${params.name}`);
          return {
            success: true,
            priority,
            exists: true
          };
        } else {
          logger.info(`[ACTION] find_priority_by_name: Priority ${params.name} not found`);
          return {
            success: true,
            priority: null,
            exists: false
          };
        }
      } catch (error) {
        logger.error(`[ACTION] find_priority_by_name error for priority ${params.name}:`, error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          priority: null,
          exists: false
        };
      }
    }
  );

  logger.info('[EmailActions] Email workflow actions registration complete.');
}