/**
 * System-Managed Email Processing Workflow
 * This workflow processes inbound emails and creates tickets with email threading support
 * MVP Features:
 * - Exact email matching only (no fuzzy matching)
 * - Email threading for conversations using In-Reply-To/References headers
 * - Inline forms for human tasks
 * - Hardcoded retry policies and error handling
 */

import { WorkflowContext } from '../core/workflowContext';

export async function systemEmailProcessingWorkflow(context: WorkflowContext): Promise<void> {
  const { actions, data, logger, setState, executionId } = context;
  const { triggerEvent } = context.input;
  
  // Extract email data from the INBOUND_EMAIL_RECEIVED event payload
  const emailData = triggerEvent.payload.emailData;
  const providerId = triggerEvent.payload.providerId;
  const tenant = triggerEvent.payload.tenant;
  
  setState('PROCESSING_INBOUND_EMAIL');
  logger.info(`Processing inbound email: ${emailData.subject} from ${emailData.from.email}`);
  
  // Store relevant data in workflow context
  data.set('emailData', emailData);
  data.set('providerId', providerId);
  data.set('tenant', tenant);
  data.set('processedAt', new Date().toISOString());
  
  try {
    // Step 1: Check if this is a threaded email (reply to existing ticket)
    setState('CHECKING_EMAIL_THREADING');
    logger.info('Checking if email is part of existing conversation thread');
    
    const existingTicket = await checkEmailThreading(context, emailData);
    
    if (existingTicket) {
      // This is a reply to an existing ticket - add as comment
      logger.info(`Email is part of existing ticket: ${existingTicket.ticketId}`);
      await handleEmailReply(context, emailData, existingTicket);
      return; // Exit workflow after handling reply
    }
    
    // Step 2: This is a new email - find or match client
    setState('MATCHING_EMAIL_CLIENT');
    logger.info('Attempting to match email sender to existing client');
    
    let matchedClient = await findExactEmailMatch(context, emailData.from.email);
    
    if (!matchedClient) {
      // No exact match found - create human task for manual matching
      logger.info('No exact email match found, creating human task for manual client selection');
      
      const taskResult = await actions.createTaskAndWaitForResult({
        taskType: 'match_email_to_client',
        title: `Match Email to Client: ${emailData.subject}`,
        description: `Please match this email from ${emailData.from.email} (${emailData.from.name || 'No name'}) to a client.`,
        contextData: {
          emailData: {
            from: emailData.from,
            subject: emailData.subject,
            receivedAt: emailData.receivedAt,
            snippet: emailData.body.text.substring(0, 200) + '...'
          }
        },
        // Inline form definition for client matching
        formSchema: {
          type: 'object',
          properties: {
            selectedCompanyId: {
              type: 'string',
              format: 'uuid',
              title: 'Select Existing Company',
              description: 'Choose an existing company for this email'
            },
            createNewCompany: {
              type: 'boolean',
              title: 'Create New Company',
              description: 'Check this to create a new company instead'
            },
            newCompanyName: {
              type: 'string',
              title: 'New Company Name',
              description: 'Enter company name (required if creating new company)'
            },
            contactName: {
              type: 'string',
              title: 'Contact Name',
              description: 'Name of the contact person'
            },
            saveEmailAssociation: {
              type: 'boolean',
              title: 'Remember this email association',
              description: 'Save this email-to-client mapping for future emails',
              default: true
            }
          },
          required: ['selectedCompanyId'],
          // Conditional requirements based on createNewCompany
          if: {
            properties: { createNewCompany: { const: true } }
          },
          then: {
            required: ['newCompanyName']
          }
        }
      });
      
      if (taskResult.success && taskResult.resolutionData) {
        matchedClient = await processClientMatchingResult(context, taskResult.resolutionData, emailData);
        data.set('matchedClient', matchedClient);
      } else {
        logger.warn('Manual client matching was not completed successfully');
        // Continue without client match - ticket will be created without company association
      }
    } else {
      logger.info(`Found exact email match: ${matchedClient.companyName}`);
      data.set('matchedClient', matchedClient);
    }
    
    // Step 3: Create new ticket from email
    setState('CREATING_TICKET');
    logger.info('Creating new ticket from email');
    
    const ticketResult = await actions.create_ticket({
      title: emailData.subject,
      description: emailData.body.text,
      company_id: matchedClient?.companyId,
      contact_id: matchedClient?.contactId,
      source: 'email',
      channel_id: await getEmailChannelId(context), // Get or create email channel
      status_id: await getNewTicketStatusId(context), // Get default new ticket status
      priority_id: await getDefaultPriorityId(context), // Get default priority
      // Store email metadata for future threading
      email_metadata: {
        messageId: emailData.id,
        threadId: emailData.threadId,
        from: emailData.from,
        inReplyTo: emailData.inReplyTo,
        references: emailData.references,
        providerId: providerId
      }
    });
    
    logger.info(`Ticket created with ID: ${ticketResult.id}`);
    data.set('ticketId', ticketResult.id);
    
    // Step 4: Handle attachments if present
    if (emailData.attachments && emailData.attachments.length > 0) {
      setState('PROCESSING_ATTACHMENTS');
      logger.info(`Processing ${emailData.attachments.length} email attachments`);
      
      for (const attachment of emailData.attachments) {
        try {
          await actions.process_email_attachment({
            emailId: emailData.id,
            attachmentId: attachment.id,
            ticketId: ticketResult.id,
            tenant: tenant,
            providerId: providerId,
            attachmentData: attachment
          });
        } catch (attachmentError: any) {
          logger.warn(`Failed to process attachment ${attachment.name}: ${attachmentError.message}`);
          // Continue processing other attachments
        }
      }
      
      logger.info(`Processed ${emailData.attachments.length} attachments`);
    }
    
    // Step 5: Create initial comment with original email content
    await actions.create_ticket_comment({
      ticket_id: ticketResult.id,
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
    
    // Step 6: Optional notification (if we have a matched client)
    if (matchedClient?.companyId) {
      try {
        await actions.send_ticket_created_notification({
          ticketId: ticketResult.id,
          notificationType: 'email_acknowledgment',
          recipientEmail: emailData.from.email
        });
        logger.info('Sent ticket creation acknowledgment email');
      } catch (notificationError: any) {
        logger.warn(`Failed to send notification: ${notificationError.message}`);
        // Don't fail the workflow for notification errors
      }
    }
    
  } catch (error: any) {
    logger.error(`Error processing inbound email: ${error.message}`);
    setState('ERROR_PROCESSING_EMAIL');
    
    // Create human task for error handling
    await actions.createHumanTask({
      taskType: 'email_processing_error',
      title: 'Error Processing Inbound Email',
      description: `Failed to process email: ${emailData.subject}`,
      contextData: {
        error: error.message,
        emailData: {
          id: emailData.id,
          from: emailData.from,
          subject: emailData.subject,
          receivedAt: emailData.receivedAt
        },
        workflowInstanceId: executionId
      },
      // Inline form for error resolution
      formSchema: {
        type: 'object',
        properties: {
          retryProcessing: {
            type: 'boolean',
            title: 'Retry Email Processing',
            description: 'Attempt to process this email again'
          },
          skipEmail: {
            type: 'boolean', 
            title: 'Skip This Email',
            description: 'Mark this email as processed without creating a ticket'
          },
          manualTicketId: {
            type: 'string',
            format: 'uuid',
            title: 'Link to Existing Ticket',
            description: 'If you manually created a ticket, provide its ID to link this email'
          },
          notes: {
            type: 'string',
            title: 'Resolution Notes',
            description: 'Add any notes about how this error was resolved'
          }
        }
      }
    });
    
    // Don't re-throw the error - let the human task handle resolution
    setState('AWAITING_MANUAL_RESOLUTION');
  }
}

/**
 * Check if email is part of existing conversation thread
 */
async function checkEmailThreading(context: WorkflowContext, emailData: any): Promise<any | null> {
  const { actions, logger } = context;
  
  // Check for threading headers
  if (!emailData.inReplyTo && (!emailData.references || emailData.references.length === 0)) {
    logger.info('No threading headers found - this is a new conversation');
    return null;
  }
  
  // Look for existing ticket with matching email metadata
  try {
    // This would query the tickets table for email_metadata containing the thread information
    const existingTicket = await actions.find_ticket_by_email_thread({
      threadId: emailData.threadId,
      inReplyTo: emailData.inReplyTo,
      references: emailData.references,
      originalMessageId: emailData.inReplyTo // Look for ticket created from the original message
    });
    
    return existingTicket;
  } catch (error: any) {
    logger.warn(`Error checking email threading: ${error.message}`);
    return null;
  }
}

/**
 * Handle email reply to existing ticket
 */
async function handleEmailReply(context: WorkflowContext, emailData: any, existingTicket: any): Promise<void> {
  const { actions, logger, setState } = context;
  
  setState('ADDING_EMAIL_REPLY_COMMENT');
  logger.info(`Adding email reply as comment to ticket ${existingTicket.ticketId}`);
  
  // Add email as comment to existing ticket
  await actions.create_ticket_comment({
    ticket_id: existingTicket.ticketId,
    content: emailData.body.html || emailData.body.text,
    format: emailData.body.html ? 'html' : 'text',
    source: 'email',
    author_type: 'contact', // This is a reply from the client
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
  
  // Handle attachments for reply
  if (emailData.attachments && emailData.attachments.length > 0) {
    for (const attachment of emailData.attachments) {
      try {
        await actions.process_email_attachment({
          emailId: emailData.id,
          attachmentId: attachment.id,
          ticketId: existingTicket.ticketId,
          tenant: context.data.get('tenant'),
          providerId: context.data.get('providerId'),
          attachmentData: attachment
        });
      } catch (attachmentError: any) {
        logger.warn(`Failed to process reply attachment ${attachment.name}: ${attachmentError.message}`);
      }
    }
  }
  
  setState('EMAIL_REPLY_PROCESSED');
  logger.info('Email reply processed successfully');
}

/**
 * Find exact email match in contacts
 */
async function findExactEmailMatch(context: WorkflowContext, emailAddress: string): Promise<any | null> {
  const { actions, logger } = context;
  
  try {
    const contact = await actions.find_contact_by_email({
      email: emailAddress
    });
    
    if (contact) {
      logger.info(`Found exact email match: ${contact.name} (${contact.company_name})`);
      return {
        contactId: contact.contact_id,
        contactName: contact.name,
        companyId: contact.company_id,
        companyName: contact.company_name
      };
    }
    
    return null;
  } catch (error: any) {
    logger.warn(`Error finding email match: ${error.message}`);
    return null;
  }
}

/**
 * Process the result of manual client matching
 */
async function processClientMatchingResult(
  context: WorkflowContext, 
  matchingResult: any, 
  emailData: any
): Promise<any> {
  const { actions, logger } = context;
  
  let companyId = matchingResult.selectedCompanyId;
  let companyName = '';
  let contactId = null;
  
  // Create new company if requested
  if (matchingResult.createNewCompany && matchingResult.newCompanyName) {
    logger.info(`Creating new company: ${matchingResult.newCompanyName}`);
    
    const newCompany = await actions.create_company({
      name: matchingResult.newCompanyName,
      email: emailData.from.email,
      source: 'email'
    });
    
    companyId = newCompany.id;
    companyName = newCompany.name;
  } else {
    // Get existing company details
    const company = await actions.get_company({ company_id: companyId });
    companyName = company.name;
  }
  
  // Create or find contact
  if (matchingResult.contactName || emailData.from.name) {
    const contactResult = await actions.create_or_find_contact({
      email: emailData.from.email,
      name: matchingResult.contactName || emailData.from.name,
      company_id: companyId
    });
    
    contactId = contactResult.id;
  }
  
  // Save email association if requested
  if (matchingResult.saveEmailAssociation) {
    await actions.save_email_client_association({
      email: emailData.from.email,
      company_id: companyId,
      contact_id: contactId
    });
    
    logger.info(`Saved email association: ${emailData.from.email} -> ${companyName}`);
  }
  
  return {
    companyId,
    companyName,
    contactId,
    contactName: matchingResult.contactName || emailData.from.name
  };
}

/**
 * Get or create email channel ID
 */
async function getEmailChannelId(context: WorkflowContext): Promise<string> {
  const { actions } = context;
  
  // Try to find existing email channel
  const emailChannel = await actions.find_channel_by_name({ name: 'Email' });
  
  if (emailChannel) {
    return emailChannel.id;
  }
  
  // Create email channel if it doesn't exist
  const newChannel = await actions.create_channel({
    name: 'Email',
    description: 'Tickets created from inbound emails',
    is_default: false
  });
  
  return newChannel.id;
}

/**
 * Get default status ID for new tickets
 */
async function getNewTicketStatusId(context: WorkflowContext): Promise<string> {
  const { actions } = context;
  
  const newStatus = await actions.find_status_by_name({ 
    name: 'New',
    item_type: 'ticket'
  });
  
  return newStatus.id;
}

/**
 * Get default priority ID
 */
async function getDefaultPriorityId(context: WorkflowContext): Promise<string> {
  const { actions } = context;
  
  const defaultPriority = await actions.find_priority_by_name({ 
    name: 'Medium' 
  });
  
  return defaultPriority.id;
}