// server/migrations/20250707201500_register_email_processing_workflow.cjs
const { v4: uuidv4 } = require('uuid');

// Define the specific registration ID for the Email Processing workflow
const EMAIL_PROCESSING_WORKFLOW_ID = '550e8400-e29b-41d4-a716-446655440001'; // Static UUID for this system workflow

// Email Processing Workflow Definition
const emailProcessingWorkflowDefinition = {
  metadata: {
    name: 'System Email Processing',
    description: 'Processes inbound emails and creates tickets with email threading support',
    version: '1.0.0',
    author: 'System',
    tags: ['email', 'ticket', 'system'],
  },
  executeFn: `
    async function execute(context) {
      const { actions, data, logger, setState } = context;
      const triggerEvent = context.input?.triggerEvent;
      
      // Extract email data from the INBOUND_EMAIL_RECEIVED event payload
      const emailData = triggerEvent?.payload?.emailData;
      const providerId = triggerEvent?.payload?.providerId;
      const tenant = triggerEvent?.payload?.tenant;
      
      if (!emailData || !providerId || !tenant) {
        logger.error('Missing required email data in trigger event');
        setState('ERROR_MISSING_DATA');
        return;
      }
      
      setState('PROCESSING_INBOUND_EMAIL');
      logger.info('Processing inbound email: ' + emailData.subject + ' from ' + emailData.from.email);
      
      // Store relevant data in workflow context
      data.set('emailData', emailData);
      data.set('providerId', providerId);
      data.set('tenant', tenant);
      data.set('processedAt', new Date().toISOString());
      
      try {
        // Step 1: Check if this is a threaded email (reply to existing ticket)
        setState('CHECKING_EMAIL_THREADING');
        logger.info('Checking if email is part of existing conversation thread');
        
        const existingTicket = await actions.find_ticket_by_email_thread({
          threadId: emailData.threadId,
          inReplyTo: emailData.inReplyTo,
          references: emailData.references,
          originalMessageId: emailData.inReplyTo
        });
        
        if (existingTicket && existingTicket.success && existingTicket.ticket) {
          // This is a reply to an existing ticket - add as comment
          logger.info('Email is part of existing ticket: ' + existingTicket.ticket.ticketId);
          
          await actions.create_comment_from_email({
            ticket_id: existingTicket.ticket.ticketId,
            content: emailData.body.html || emailData.body.text,
            format: emailData.body.html ? 'html' : 'text',
            source: 'email',
            author_type: 'contact',
            metadata: {
              emailSource: true,
              emailId: emailData.id,
              fromEmail: emailData.from.email,
              fromName: emailData.from.name,
              emailSubject: emailData.subject,
              emailReceivedAt: emailData.receivedAt,
              isReply: true,
              replyToMessageId: emailData.inReplyTo
            }
          });
          
          setState('EMAIL_PROCESSED');
          logger.info('Email reply processed successfully');
          data.set('ticketId', existingTicket.ticket.ticketId);
          return;
        }
        
        // Step 2: This is a new email - find or match client
        setState('MATCHING_EMAIL_CLIENT');
        logger.info('Attempting to match email sender to existing client');
        
        const matchedClient = await actions.find_contact_by_email({
          email: emailData.from.email
        });
        
        let clientInfo = null;
        if (matchedClient && matchedClient.success && matchedClient.contact) {
          logger.info('Found exact email match: ' + matchedClient.contact.company_name);
          clientInfo = {
            companyId: matchedClient.contact.company_id,
            contactId: matchedClient.contact.contact_id
          };
        } else {
          logger.info('No exact email match found, creating ticket without client association');
        }
        
        // Step 3: Create new ticket from email
        setState('CREATING_TICKET');
        logger.info('Creating new ticket from email');
        
        // Get default IDs (simplified for migration)
        const defaultChannelId = await actions.find_channel_by_name({
          name: 'Email'
        });
        const defaultStatusId = await actions.find_status_by_name({
          name: 'New',
          item_type: 'ticket'
        });
        const defaultPriorityId = await actions.find_priority_by_name({
          name: 'Medium'
        });
        
        const ticketResult = await actions.create_ticket_from_email({
          title: emailData.subject,
          description: emailData.body.text,
          company_id: clientInfo?.companyId,
          contact_id: clientInfo?.contactId,
          source: 'email',
          channel_id: defaultChannelId?.success ? defaultChannelId.channel.id : null,
          status_id: defaultStatusId?.success ? defaultStatusId.status.id : null,
          priority_id: defaultPriorityId?.success ? defaultPriorityId.priority.id : null,
          email_metadata: {
            messageId: emailData.id,
            threadId: emailData.threadId,
            from: emailData.from,
            inReplyTo: emailData.inReplyTo,
            references: emailData.references,
            providerId: providerId
          }
        });
        
        logger.info('Ticket created with ID: ' + ticketResult.ticket_id);
        data.set('ticketId', ticketResult.ticket_id);
        
        // Step 4: Create initial comment with original email content
        await actions.create_comment_from_email({
          ticket_id: ticketResult.ticket_id,
          content: emailData.body.html || emailData.body.text,
          format: emailData.body.html ? 'html' : 'text',
          source: 'email',
          author_type: 'system',
          metadata: {
            emailSource: true,
            originalEmailId: emailData.id,
            fromEmail: emailData.from.email,
            fromName: emailData.from.name,
            emailSubject: emailData.subject,
            emailReceivedAt: emailData.receivedAt
          }
        });
        
        setState('EMAIL_PROCESSED');
        logger.info('Email processing completed successfully');
        
      } catch (error) {
        logger.error('Error processing inbound email: ' + error.message);
        setState('ERROR_PROCESSING_EMAIL');
      }
    }
  `,
};

exports.up = async function(knex) {
  console.log('Registering System Email Processing Workflow...');

  // Check if the registration already exists
  const existingReg = await knex('system_workflow_registrations')
    .where({ registration_id: EMAIL_PROCESSING_WORKFLOW_ID })
    .first();

  if (!existingReg) {
    // Insert System Workflow Registration
    await knex('system_workflow_registrations').insert([
      {
        registration_id: EMAIL_PROCESSING_WORKFLOW_ID,
        name: emailProcessingWorkflowDefinition.metadata.name,
        description: emailProcessingWorkflowDefinition.metadata.description,
        category: 'system',
        tags: emailProcessingWorkflowDefinition.metadata.tags,
        version: emailProcessingWorkflowDefinition.metadata.version,
        status: 'active',
        created_by: null, // System user
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    // Insert System Workflow Version
    await knex('system_workflow_registration_versions').insert([
      {
        version_id: uuidv4(),
        registration_id: EMAIL_PROCESSING_WORKFLOW_ID,
        version: emailProcessingWorkflowDefinition.metadata.version,
        is_current: true,
        code: emailProcessingWorkflowDefinition.executeFn,
        created_by: null,
        created_at: new Date().toISOString(),
      },
    ]);

    console.log('✅ Inserted System Email Processing Workflow registration.');
  } else {
    console.log('ℹ️ System Email Processing Workflow already exists, skipping registration.');
  }

  // Get the INBOUND_EMAIL_RECEIVED event ID from system catalog
  const inboundEmailEvent = await knex('system_event_catalog')
    .where({ event_type: 'INBOUND_EMAIL_RECEIVED' })
    .first();

  if (!inboundEmailEvent) {
    throw new Error('INBOUND_EMAIL_RECEIVED event not found in system_event_catalog');
  }

  // Check if INBOUND_EMAIL_RECEIVED event attachment already exists
  const existingAttachment = await knex('system_workflow_event_attachments')
    .where({ 
      workflow_id: EMAIL_PROCESSING_WORKFLOW_ID,
      event_id: inboundEmailEvent.event_id
    })
    .first();

  if (!existingAttachment) {
    // Create event attachment for INBOUND_EMAIL_RECEIVED events in system table
    await knex('system_workflow_event_attachments').insert([
      {
        attachment_id: uuidv4(),
        workflow_id: EMAIL_PROCESSING_WORKFLOW_ID,
        event_id: inboundEmailEvent.event_id,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    console.log('✅ Created INBOUND_EMAIL_RECEIVED event attachment for Email Processing Workflow.');
  } else {
    console.log('ℹ️ INBOUND_EMAIL_RECEIVED event attachment already exists.');
  }
};

exports.down = async function(knex) {
  console.log('Removing System Email Processing Workflow...');

  // Remove event attachments first (to avoid foreign key issues)
  const deletedAttachments = await knex('system_workflow_event_attachments')
    .where({ 
      workflow_id: EMAIL_PROCESSING_WORKFLOW_ID
    })
    .del();

  // Remove workflow version
  const deletedVersions = await knex('system_workflow_registration_versions')
    .where({ registration_id: EMAIL_PROCESSING_WORKFLOW_ID })
    .del();

  // Remove workflow registration
  const deletedRegistrations = await knex('system_workflow_registrations')
    .where({ registration_id: EMAIL_PROCESSING_WORKFLOW_ID })
    .del();

  console.log(`🗑️ Removed Email Processing Workflow: ${deletedRegistrations} registrations, ${deletedVersions} versions, ${deletedAttachments} attachments.`);
};