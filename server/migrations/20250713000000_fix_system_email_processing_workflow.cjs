// server/migrations/20250713000000_fix_system_email_processing_workflow.cjs

// Fixed workflow definition without dynamic imports
const fixedEmailProcessingWorkflowCode = `
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
`;

exports.up = async function(knex) {
  console.log('Fixing System Email Processing Workflow code...');

  // Find the system email processing workflow registration
  const emailProcessingRegistration = await knex('system_workflow_registrations')
    .where({ name: 'System Email Processing' })
    .first();

  if (emailProcessingRegistration) {
    console.log('Found System Email Processing Workflow registration:', emailProcessingRegistration.registration_id);
    
    // Update the code in the current version
    const updatedRows = await knex('system_workflow_registration_versions')
      .where({ 
        registration_id: emailProcessingRegistration.registration_id,
        is_current: true 
      })
      .update({ 
        code: fixedEmailProcessingWorkflowCode.trim(),
        updated_at: new Date().toISOString()
      });

    console.log(`✅ Updated ${updatedRows} workflow version(s) with fixed code.`);
  } else {
    console.log('ℹ️ System Email Processing Workflow not found, skipping fix.');
  }
};

exports.down = async function(knex) {
  console.log('Reverting System Email Processing Workflow code fix...');
  
  // Original problematic code with dynamic import
  const originalCode = `
    async function execute(context) {
      // This is a placeholder - the actual execution happens in
      // /shared/workflow/workflows/system-email-processing-workflow.ts
      const { systemEmailProcessingWorkflow } = await import('/shared/workflow/workflows/system-email-processing-workflow.ts');
      return await systemEmailProcessingWorkflow(context);
    }
  `;

  // Find the system email processing workflow registration
  const emailProcessingRegistration = await knex('system_workflow_registrations')
    .where({ name: 'System Email Processing' })
    .first();

  if (emailProcessingRegistration) {
    // Revert to the original problematic code
    const updatedRows = await knex('system_workflow_registration_versions')
      .where({ 
        registration_id: emailProcessingRegistration.registration_id,
        is_current: true 
      })
      .update({ 
        code: originalCode.trim(),
        updated_at: new Date().toISOString()
      });

    console.log(`🔄 Reverted ${updatedRows} workflow version(s) to original code.`);
  } else {
    console.log('ℹ️ System Email Processing Workflow not found, skipping revert.');
  }
};