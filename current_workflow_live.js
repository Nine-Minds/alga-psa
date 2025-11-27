 async function execute(context) {                                                                                          +
     const { actions, data, logger, setState } = context;                                                                   +
     const triggerEvent = context.input?.triggerEvent;                                                                      +
                                                                                                                            +
     // Extract email data and required identifiers                                                                         +
     const emailData = triggerEvent?.payload?.emailData;                                                                    +
     const providerId = triggerEvent?.payload?.providerId;                                                                  +
     const tenant = triggerEvent?.payload?.tenant || triggerEvent?.tenant || triggerEvent?.payload?.tenantId;               +
                                                                                                                            +
     if (!emailData || !providerId || !tenant) {                                                                            +
       logger.error('Missing required email data in trigger event');                                                        +
       setState('ERROR_MISSING_DATA');                                                                                      +
       return;                                                                                                              +
     }                                                                                                                      +
                                                                                                                            +
     setState('PROCESSING_INBOUND_EMAIL');                                                                                  +
     logger.info('Processing inbound email: ' + emailData.subject + ' from ' + emailData.from.email);                       +
                                                                                                                            +
     // Store relevant data in workflow context                                                                             +
     data.set('emailData', emailData);                                                                                      +
     data.set('providerId', providerId);                                                                                    +
     data.set('tenant', tenant);                                                                                            +
     data.set('processedAt', new Date().toISOString());                                                                     +
                                                                                                                            +
     try {                                                                                                                  +
       // Step 1: Check if this is a threaded email (reply to existing ticket)                                              +
       setState('CHECKING_EMAIL_THREADING');                                                                                +
       logger.info('Checking if email is part of existing conversation thread');                                            +
                                                                                                                            +
       const existingTicket = await actions.find_ticket_by_email_thread({                                                   +
         threadId: emailData.threadId,                                                                                      +
         inReplyTo: emailData.inReplyTo,                                                                                    +
         references: emailData.references,                                                                                  +
         originalMessageId: emailData.inReplyTo                                                                             +
       });                                                                                                                  +
                                                                                                                            +
       if (existingTicket && existingTicket.success && existingTicket.ticket) {                                             +
         // This is a reply to an existing ticket - add as comment                                                          +
         logger.info('Email is part of existing ticket: ' + existingTicket.ticket.ticketId);                                +
                                                                                                                            +
         await actions.create_comment_from_email({                                                                          +
           ticket_id: existingTicket.ticket.ticketId,                                                                       +
           content: emailData.body.html || emailData.body.text,                                                             +
           format: emailData.body.html ? 'html' : 'text',                                                                   +
           source: 'email',                                                                                                 +
           author_type: 'contact',                                                                                          +
           metadata: {                                                                                                      +
             emailSource: true,                                                                                             +
             emailId: emailData.id,                                                                                         +
             fromEmail: emailData.from.email,                                                                               +
             fromName: emailData.from.name,                                                                                 +
             emailSubject: emailData.subject,                                                                               +
             emailReceivedAt: emailData.receivedAt,                                                                         +
             isReply: true,                                                                                                 +
             replyToMessageId: emailData.inReplyTo                                                                          +
           }                                                                                                                +
         });                                                                                                                +
                                                                                                                            +
         setState('EMAIL_PROCESSED');                                                                                       +
         logger.info('Email reply processed successfully');                                                                 +
         data.set('ticketId', existingTicket.ticket.ticketId);                                                              +
         return;                                                                                                            +
       }                                                                                                                    +
                                                                                                                            +
       // Step 2: Resolve provider-specific inbound ticket defaults (required)                                              +
       setState('RESOLVING_TICKET_DEFAULTS');                                                                               +
       logger.info('Resolving inbound ticket defaults for tenant: ' + tenant + ', provider: ' + providerId);                +
                                                                                                                            +
       const ticketDefaults = await actions.resolve_inbound_ticket_defaults({                                               +
         tenant: tenant,                                                                                                    +
         providerId: providerId                                                                                             +
       });                                                                                                                  +
                                                                                                                            +
       if (!ticketDefaults) {                                                                                               +
         logger.error('No inbound ticket defaults configured for tenant ' + tenant + '. Email processing cannot continue.');+
         setState('ERROR_NO_TICKET_DEFAULTS');                                                                              +
         return; // Exit early without attempting ticket creation                                                           +
       }                                                                                                                    +
                                                                                                                            +
       data.set('ticketDefaults', ticketDefaults);                                                                          +
                                                                                                                            +
       // Step 3: Attempt to match contact by email (optional)                                                              +
       setState('MATCHING_EMAIL_CLIENT');                                                                                   +
       logger.info('Attempting to match email sender to existing client');                                                  +
                                                                                                                            +
       const matchedClient = await actions.find_contact_by_email({                                                          +
         email: emailData.from.email                                                                                        +
       });                                                                                                                  +
                                                                                                                            +
       let clientId = null;                                                                                                 +
       let contactId = null;                                                                                                +
       if (matchedClient && matchedClient.success && matchedClient.contact) {                                               +
         clientId = matchedClient.contact.client_id;                                                                        +
         contactId = matchedClient.contact.contact_id;                                                                      +
         logger.info('Found exact email match, clientId=' + clientId);                                                      +
       } else {                                                                                                             +
         logger.info('No exact email match found; creating ticket using defaults (no client association)');                 +
       }                                                                                                                    +
                                                                                                                            +
       // Step 4: Create new ticket from email using resolved defaults                                                      +
       setState('CREATING_TICKET');                                                                                         +
       logger.info('Creating new ticket from email with resolved defaults');                                                +
                                                                                                                            +
       const ticketResult = await actions.create_ticket_from_email({                                                        +
         title: emailData.subject,                                                                                          +
         description: (emailData.body && emailData.body.text) ? emailData.body.text : '',                                   +
         client_id: clientId || ticketDefaults.client_id || null,                                                           +
         contact_id: contactId || null,                                                                                     +
         source: 'email',                                                                                                   +
         board_id: ticketDefaults.board_id,                                                                                 +
         status_id: ticketDefaults.status_id,                                                                               +
         priority_id: ticketDefaults.priority_id,                                                                           +
         category_id: ticketDefaults.category_id,                                                                           +
         subcategory_id: ticketDefaults.subcategory_id,                                                                     +
         location_id: ticketDefaults.location_id,                                                                           +
         entered_by: ticketDefaults.entered_by,                                                                             +
         email_metadata: {                                                                                                  +
           messageId: emailData.id,                                                                                         +
           threadId: emailData.threadId,                                                                                    +
           from: emailData.from,                                                                                            +
           inReplyTo: emailData.inReplyTo,                                                                                  +
           references: emailData.references,                                                                                +
           providerId: providerId                                                                                           +
         }                                                                                                                  +
       });                                                                                                                  +
                                                                                                                            +
       logger.info('Ticket created with ID: ' + ticketResult.ticket_id);                                                    +
       data.set('ticketId', ticketResult.ticket_id);                                                                        +
                                                                                                                            +
       // Step 5: Create initial comment with original email content                                                        +
       await actions.create_comment_from_email({                                                                            +
         ticket_id: ticketResult.ticket_id,                                                                                 +
         content: emailData.body.html || emailData.body.text,                                                               +
         format: emailData.body.html ? 'html' : 'text',                                                                     +
         source: 'email',                                                                                                   +
         author_type: 'system',                                                                                             +
         metadata: {                                                                                                        +
           emailSource: true,                                                                                               +
           originalEmailId: emailData.id,                                                                                   +
           fromEmail: emailData.from.email,                                                                                 +
           fromName: emailData.from.name,                                                                                   +
           emailSubject: emailData.subject,                                                                                 +
           emailReceivedAt: emailData.receivedAt                                                                            +
         }                                                                                                                  +
       });                                                                                                                  +
                                                                                                                            +
       setState('EMAIL_PROCESSED');                                                                                         +
       logger.info('Email processing completed successfully');                                                              +
                                                                                                                            +
     } catch (error) {                                                                                                      +
       logger.error('Error processing inbound email: ' + (error && error.message ? error.message : String(error)));         +
       setState('ERROR_PROCESSING_EMAIL');                                                                                  +
     }                                                                                                                      +
   }

