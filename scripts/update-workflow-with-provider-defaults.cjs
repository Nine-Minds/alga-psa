#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Updated workflow code that uses provider defaults
const dbWorkflowCode = `
async function execute(context) {
  const { actions, data, logger, setState } = context;
  const triggerEvent = context.input?.triggerEvent;
  
  // Extract email data from the INBOUND_EMAIL_RECEIVED event payload
  const emailData = triggerEvent?.payload?.emailData;
  const providerId = triggerEvent?.payload?.providerId;
  const tenant = triggerEvent?.payload?.tenantId || triggerEvent?.payload?.tenant;
  
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
    // Step 1: Get provider-specific inbound ticket defaults
    setState('RESOLVING_TICKET_DEFAULTS');
    logger.info('Resolving ticket defaults for provider: ' + providerId);
    
    const ticketDefaults = await actions.resolve_email_provider_defaults({
      providerId: providerId,
      tenant: tenant
    });
    
    logger.info('Retrieved ticket defaults: ' + JSON.stringify(ticketDefaults));
    
    let defaultChannelId = null;
    let defaultStatusId = null;
    let defaultPriorityId = null;
    let defaultCompanyId = null;
    let defaultEnteredBy = null;
    let defaultCategoryId = null;
    let defaultSubcategoryId = null;
    let defaultLocationId = null;
    
    if (ticketDefaults) {
      // Use provider-specific defaults
      defaultChannelId = ticketDefaults.channel_id;
      defaultStatusId = ticketDefaults.status_id;
      defaultPriorityId = ticketDefaults.priority_id;
      defaultCompanyId = ticketDefaults.company_id;
      defaultEnteredBy = ticketDefaults.entered_by;
      defaultCategoryId = ticketDefaults.category_id;
      defaultSubcategoryId = ticketDefaults.subcategory_id;
      defaultLocationId = ticketDefaults.location_id;
    } else {
      logger.warn('No ticket defaults configured for provider, using system defaults');
      // Fall back to system defaults
      const channelResult = await actions.find_channel_by_name({ name: 'Email' });
      const statusResult = await actions.find_status_by_name({ name: 'New', item_type: 'ticket' });
      const priorityResult = await actions.find_priority_by_name({ name: 'Medium' });
      
      defaultChannelId = channelResult?.success ? channelResult.channel.id : null;
      defaultStatusId = statusResult?.success ? statusResult.status.id : null;
      defaultPriorityId = priorityResult?.success ? priorityResult.priority.id : null;
    }
    
    data.set('ticketDefaults', {
      channel_id: defaultChannelId,
      status_id: defaultStatusId,
      priority_id: defaultPriorityId,
      company_id: defaultCompanyId,
      entered_by: defaultEnteredBy,
      category_id: defaultCategoryId,
      subcategory_id: defaultSubcategoryId,
      location_id: defaultLocationId
    });
    
    // Step 2: Check if this is a threaded email (reply to existing ticket)
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
    
    // Step 3: This is a new email - find or match client
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
    
    // Step 4: Create new ticket from email using provider defaults
    setState('CREATING_TICKET');
    logger.info('Creating new ticket from email with provider defaults');
    
    // Override defaults with matched client info if available
    const finalCompanyId = clientInfo?.companyId || defaultCompanyId;
    const finalContactId = clientInfo?.contactId || null;
    
    const ticketResult = await actions.create_ticket_from_email({
      title: emailData.subject,
      description: emailData.body.text,
      company_id: finalCompanyId,
      contact_id: finalContactId,
      source: 'email',
      channel_id: defaultChannelId,
      status_id: defaultStatusId,
      priority_id: defaultPriorityId,
      category_id: defaultCategoryId,
      subcategory_id: defaultSubcategoryId,
      location_id: defaultLocationId,
      entered_by: defaultEnteredBy,
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
    
    // Step 5: Handle attachments if present
    if (emailData.attachments && emailData.attachments.length > 0) {
      setState('PROCESSING_ATTACHMENTS');
      logger.info('Processing ' + emailData.attachments.length + ' email attachments');
      
      for (const attachment of emailData.attachments) {
        try {
          await actions.process_email_attachment({
            emailId: emailData.id,
            attachmentId: attachment.id,
            ticketId: ticketResult.ticket_id,
            tenant: tenant,
            providerId: providerId,
            attachmentData: attachment
          });
        } catch (attachmentError) {
          logger.warn('Failed to process attachment ' + attachment.name + ': ' + attachmentError.message);
          // Continue processing other attachments
        }
      }
      
      logger.info('Processed attachments successfully');
    }
    
    // Step 6: Create initial comment with original email content
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
`.trim();

// Read password from secret file
let dbPassword = process.env.DB_PASSWORD_ADMIN;
if (!dbPassword) {
  try {
    dbPassword = fs.readFileSync(path.join(__dirname, '../secrets/postgres_password'), 'utf8').trim();
  } catch (e) {
    console.error('Could not read postgres password from secrets file');
    dbPassword = 'postgres'; // fallback
  }
}

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5433,
  database: process.env.DB_NAME_SERVER || 'server_test',
  user: process.env.DB_USER_ADMIN || 'postgres',
  password: dbPassword
};

async function updateWorkflow() {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('Connected to database');
    
    // First, let's find the System Email Processing workflow
    const findResult = await client.query(`
      SELECT registration_id 
      FROM system_workflow_registrations 
      WHERE name = 'System Email Processing'
    `);
    
    if (findResult.rowCount === 0) {
      console.error('❌ System Email Processing workflow not found');
      process.exit(1);
    }
    
    const registrationId = findResult.rows[0].registration_id;
    console.log(`Found System Email Processing workflow with ID: ${registrationId}`);
    
    // Update ALL versions of the System Email Processing workflow
    const result = await client.query(`
      UPDATE system_workflow_registration_versions
      SET code = $1, updated_at = NOW()
      WHERE registration_id = $2
      RETURNING version_id, is_current
    `, [dbWorkflowCode, registrationId]);
    
    if (result.rowCount > 0) {
      console.log(`✅ Successfully updated ${result.rowCount} workflow version(s):`);
      result.rows.forEach(row => {
        console.log(`   - Version ID: ${row.version_id} (current: ${row.is_current})`);
      });
      console.log('Workflow code updated to use provider defaults');
    } else {
      console.error('❌ No workflow versions found to update');
    }
    
  } catch (error) {
    console.error('Error updating workflow:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run the update
updateWorkflow();