const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Static registration ID for System Email Processing Workflow
const EMAIL_PROCESSING_REGISTRATION_ID = '550e8400-e29b-41d4-a716-446655440001';

/**
 * Reads the TypeScript workflow file and converts it to database-compatible code
 */
function loadWorkflowCodeFromSource() {
  // Enhanced workflow using shared actions with TicketModel, events, and analytics
  // This now uses the consolidated business logic from Phase 1-3 of the consolidation plan
  const dbWorkflowCode = `async function execute(context) {
  const { actions, data, setState } = context;
  
  // Debug: Log the context structure
  console.log('Context input:', JSON.stringify(context.input));
  
  const triggerEvent = context.input?.triggerEvent;
  
  if (!triggerEvent) {
    console.error('No triggerEvent found in context.input');
    throw new Error('Missing trigger event');
  }
  
  if (!triggerEvent.payload) {
    console.error('No payload in triggerEvent:', JSON.stringify(triggerEvent));
    throw new Error('Missing payload in trigger event');
  }
  
  // Extract email data from the INBOUND_EMAIL_RECEIVED event payload
  const emailData = triggerEvent.payload.emailData;
  const providerId = triggerEvent.payload.providerId;
  const tenant = triggerEvent.tenant; // tenant is at the root level of triggerEvent, not in payload
  
  if (!emailData) {
    console.error('No emailData in payload:', JSON.stringify(triggerEvent.payload));
    throw new Error('Missing email data in trigger event payload');
  }
  
  if (!providerId) {
    console.error('No providerId in payload:', JSON.stringify(triggerEvent.payload));
    throw new Error('Missing provider ID in trigger event payload');
  }
  
  if (!tenant) {
    console.error('No tenant in triggerEvent:', JSON.stringify(triggerEvent));
    throw new Error('Missing tenant in trigger event');
  }
  
  setState('PROCESSING_INBOUND_EMAIL');
  console.log('Processing inbound email: ' + emailData.subject + ' from ' + emailData.from.email);
  
  // Store relevant data in workflow context
  data.set('emailData', emailData);
  data.set('providerId', providerId);
  data.set('tenant', tenant);
  data.set('processedAt', new Date().toISOString());
  
  try {
    // Step 1: Check if this is a threaded email (reply to existing ticket)
    setState('CHECKING_EMAIL_THREADING');
    console.log('Checking if email is part of existing conversation thread');
    
    const existingTicket = await actions.find_ticket_by_email_thread({
      threadId: emailData.threadId,
      inReplyTo: emailData.inReplyTo,
      references: emailData.references,
      originalMessageId: emailData.inReplyTo
    }, tenant);
    
    if (existingTicket && existingTicket.success && existingTicket.ticket) {
      // This is a reply to an existing ticket - add as comment
      console.log('Email is part of existing ticket: ' + existingTicket.ticket.ticketId);
      
      setState('ADDING_REPLY_COMMENT');
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
      }, tenant);
      
      setState('EMAIL_PROCESSED');
      console.log('Email reply processed successfully');
      return; // Exit workflow after handling reply
    }
    
    // Step 2: This is a new email - create new ticket
    setState('CREATING_TICKET');
    console.log('Creating new ticket from email');
    
    // Resolve ticket defaults from email provider configuration
    const ticketDefaults = await actions.resolve_email_provider_defaults({
      providerId: providerId,
      tenant: tenant
    });
    console.log('Retrieved ticket defaults:', JSON.stringify(ticketDefaults));
    
    const ticketResult = await actions.create_ticket_from_email({
      title: emailData.subject || 'Email ticket',
      description: emailData.body.text || 'Email content',
      source: 'email',
      // Apply defaults from provider configuration
      channel_id: ticketDefaults?.channel_id,
      status_id: ticketDefaults?.status_id,
      priority_id: ticketDefaults?.priority_id,
      company_id: ticketDefaults?.company_id,
      category_id: ticketDefaults?.category_id,
      subcategory_id: ticketDefaults?.subcategory_id,
      location_id: ticketDefaults?.location_id,
      entered_by: ticketDefaults?.entered_by,
      email_metadata: {
        messageId: emailData.id,
        threadId: emailData.threadId,
        from: emailData.from,
        inReplyTo: emailData.inReplyTo,
        references: emailData.references,
        providerId: providerId
      }
    }, tenant);
    
    console.log('Ticket created with ID: ' + ticketResult.ticket_id);
    data.set('ticketId', ticketResult.ticket_id);
    
    // Step 3: Create initial comment with original email content
    setState('CREATING_INITIAL_COMMENT');
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
    }, tenant);
    
    setState('EMAIL_PROCESSED');
    console.log('Email processing completed successfully');
    
  } catch (error) {
    console.error('Error processing inbound email: ' + error.message);
    setState('ERROR_PROCESSING_EMAIL');
    throw error;
  }
}`;
  
  return dbWorkflowCode;
}

exports.seed = async function(knex) {
  console.log('Setting up System Email Processing Workflow from source code...');
  
  try {
    // Load the workflow code from the TypeScript source
    const workflowCode = loadWorkflowCodeFromSource();
    
    // Check if the system email processing workflow already exists
    const existingReg = await knex('system_workflow_registrations')
      .where({ registration_id: EMAIL_PROCESSING_REGISTRATION_ID })
      .first();
    
    if (!existingReg) {
      console.log('System Email Processing Workflow not found, creating from source...');
      
      // Insert System Workflow Registration
      await knex('system_workflow_registrations').insert({
        registration_id: EMAIL_PROCESSING_REGISTRATION_ID,
        name: 'System Email Processing',
        description: 'Processes inbound emails and creates tickets with email threading support',
        category: 'system',
        tags: JSON.stringify(['email', 'system', 'inbound']),
        version: '1.0.0',
        status: 'active',
        created_by: 'system',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      
      console.log('✅ Created System Email Processing Workflow registration');
    } else {
      console.log('System Email Processing Workflow registration already exists');
    }
    
    // Always update the workflow code to ensure it's current
    const existingVersion = await knex('system_workflow_registration_versions')
      .where({ 
        registration_id: EMAIL_PROCESSING_REGISTRATION_ID,
        is_current: true 
      })
      .first();
    
    if (existingVersion) {
      // Update existing version with fresh code from source
      const updatedRows = await knex('system_workflow_registration_versions')
        .where({ 
          registration_id: EMAIL_PROCESSING_REGISTRATION_ID,
          is_current: true 
        })
        .update({
          code: workflowCode,
          updated_at: new Date().toISOString()
        });
      
      console.log(`✅ Updated ${updatedRows} workflow version(s) with code from source file`);
    } else {
      // Create new version
      await knex('system_workflow_registration_versions').insert({
        version_id: uuidv4(),
        registration_id: EMAIL_PROCESSING_REGISTRATION_ID,
        version: '1.0.0',
        is_current: true,
        code: workflowCode,
        created_by: 'system',
        created_at: new Date().toISOString(),
      });
      
      console.log('✅ Created new workflow version with code from source file');
    }
    
    // Ensure the workflow is attached to the INBOUND_EMAIL_RECEIVED event
    const inboundEmailEvent = await knex('system_event_catalog')
      .where('event_type', 'INBOUND_EMAIL_RECEIVED')
      .first();
    
    if (inboundEmailEvent) {
      const existingAttachment = await knex('system_workflow_event_attachments')
        .where({
          workflow_id: EMAIL_PROCESSING_REGISTRATION_ID,
          event_id: inboundEmailEvent.event_id
        })
        .first();
      
      if (!existingAttachment) {
        await knex('system_workflow_event_attachments').insert({
          attachment_id: uuidv4(),
          workflow_id: EMAIL_PROCESSING_REGISTRATION_ID,
          event_id: inboundEmailEvent.event_id,
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        
        console.log('✅ Attached workflow to INBOUND_EMAIL_RECEIVED event');
      } else {
        console.log('Workflow already attached to INBOUND_EMAIL_RECEIVED event');
      }
    } else {
      console.log('⚠️ INBOUND_EMAIL_RECEIVED event not found in system_event_catalog');
    }
    
    console.log('✅ System Email Processing Workflow setup completed from source');
    
  } catch (error) {
    console.error('❌ Error setting up System Email Processing Workflow:', error);
    throw error;
  }
};