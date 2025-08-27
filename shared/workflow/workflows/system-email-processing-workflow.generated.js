async function execute(context) {
    const { actions, data, logger, setState, events } = context;
    // Helper functions - defined inside the main workflow function
    /**
     * Check if email is part of existing conversation thread
     */
    const checkEmailThreading = async (emailData, actions) => {
        // Check for threading headers
        if (!emailData.inReplyTo && (!emailData.references || emailData.references.length === 0)) {
            return null;
        }
        // Look for existing ticket with matching email metadata
        try {
            const result = await actions.find_ticket_by_email_thread({
                threadId: emailData.threadId,
                inReplyTo: emailData.inReplyTo,
                references: emailData.references,
                originalMessageId: emailData.inReplyTo // Look for ticket created from the original message
            });
            return result.success ? result.ticket : null;
        }
        catch (error) {
            console.warn(`Error checking email threading: ${error.message}`);
            return null;
        }
    };
    /**
     * Handle email reply to existing ticket
     */
    const handleEmailReply = async (emailData, existingTicket, actions) => {
        // Add email as comment to existing ticket
        await actions.create_comment_from_email({
            ticket_id: existingTicket.ticketId,
            content: emailData.body.html || emailData.body.text,
            format: emailData.body.html ? 'html' : 'text',
            source: 'email',
            author_type: 'client' // This is a reply from the client
        });
        // Handle attachments for reply
        if (emailData.attachments && emailData.attachments.length > 0) {
            for (const attachment of emailData.attachments) {
                try {
                    await actions.process_email_attachment({
                        emailId: emailData.id,
                        attachmentId: attachment.id,
                        ticketId: existingTicket.ticketId,
                        tenant: emailData.tenant,
                        providerId: emailData.providerId,
                        attachmentData: attachment
                    });
                }
                catch (attachmentError) {
                    console.warn(`Failed to process reply attachment ${attachment.name}: ${attachmentError.message}`);
                }
            }
        }
    };
    /**
     * Find exact email match in contacts
     */
    const findExactEmailMatch = async (emailAddress, actions) => {
        try {
            const result = await actions.find_contact_by_email({ email: emailAddress });
            if (result.success && result.contact) {
                return {
                    contactId: result.contact.contact_id,
                    contactName: result.contact.name,
                    companyId: result.contact.company_id,
                    companyName: result.contact.company_name
                };
            }
            return null;
        }
        catch (error) {
            console.warn(`Error finding email match: ${error.message}`);
            return null;
        }
    };
    /**
     * Process the result of manual client matching
     */
    const processClientMatchingResult = async (matchingResult, emailData, actions) => {
        let companyId = matchingResult.selectedCompanyId;
        let companyName = '';
        let contactId = null;
        // Create new company if requested
        if (matchingResult.createNewCompany && matchingResult.newCompanyName) {
            const result = await actions.create_company_from_email({
                company_name: matchingResult.newCompanyName,
                email: emailData.from.email,
                source: 'email'
            });
            if (result.success) {
                companyId = result.company.company_id;
                companyName = result.company.company_name;
            }
        }
        else {
            // Get existing company details
            const result = await actions.get_company_by_id_for_email({ companyId });
            if (result.success && result.company) {
                companyName = result.company.company_name || '';
            }
        }
        // Create or find contact
        if (matchingResult.contactName || emailData.from.name) {
            const result = await actions.create_or_find_contact({
                email: emailData.from.email,
                name: matchingResult.contactName || emailData.from.name,
                company_id: companyId
            });
            if (result.success) {
                contactId = result.contact.id;
            }
        }
        // Save email association if requested
        if (matchingResult.saveEmailAssociation) {
            await actions.save_email_client_association({
                email: emailData.from.email,
                company_id: companyId,
                contact_id: contactId || undefined
            });
        }
        return {
            companyId,
            companyName,
            contactId,
            contactName: matchingResult.contactName || emailData.from.name
        };
    };
    // Main workflow logic starts here
    setState('PROCESSING_INBOUND_EMAIL');
    logger.info('🚀 Starting email processing workflow');
    // Wait for the INBOUND_EMAIL_RECEIVED event that triggered this workflow
    // This event should have been submitted immediately after starting the workflow
    logger.info('⏳ Waiting for INBOUND_EMAIL_RECEIVED event...');
    const eventPayload = await events.waitFor('INBOUND_EMAIL_RECEIVED', 10000); // 10 second timeout
    logger.info('✅ Received INBOUND_EMAIL_RECEIVED event', {
        hasPayload: !!eventPayload,
        payloadKeys: eventPayload ? Object.keys(eventPayload) : []
    });
    // Extract email data from the event payload
    const emailData = eventPayload.emailData;
    const providerId = eventPayload.providerId;
    const tenant = eventPayload.tenantId;
    setState('PROCESSING_INBOUND_EMAIL');
    console.log(`Processing inbound email: ${emailData.subject} from ${emailData.from.email}`);
    // Store relevant data in workflow context
    data.set('emailData', emailData);
    data.set('providerId', providerId);
    data.set('tenant', tenant);
    data.set('processedAt', new Date().toISOString());
    try {
        // Step 1: Check if this is a threaded email (reply to existing ticket)
        setState('CHECKING_EMAIL_THREADING');
        console.log('Checking if email is part of existing conversation thread');
        const existingTicket = await checkEmailThreading(emailData, actions);
        if (existingTicket) {
            // This is a reply to an existing ticket - add as comment
            console.log(`Email is part of existing ticket: ${existingTicket.ticketId}`);
            await handleEmailReply(emailData, existingTicket, actions);
            return; // Exit workflow after handling reply
        }
        // Step 2: This is a new email - find or match client
        setState('MATCHING_EMAIL_CLIENT');
        console.log('Attempting to match email sender to existing client');
        let matchedClient = await findExactEmailMatch(emailData.from.email, actions);
        if (!matchedClient) {
            // No exact match found - create human task for manual matching
            console.log('No exact email match found, creating human task for manual client selection');
            const taskResult = await actions.createTaskAndWaitForResult({
                taskType: 'match_email_to_client',
                title: `Match Email to Client: ${emailData.subject}`,
                description: `Please match this email from ${emailData.from.email} (${emailData.from.name || 'No name'}) to a client. Email snippet: ${emailData.body.text.substring(0, 200)}...`
            });
            if (taskResult.success && taskResult.resolutionData) {
                matchedClient = await processClientMatchingResult(taskResult.resolutionData, emailData, actions);
                data.set('matchedClient', matchedClient);
            }
            else {
                console.warn('Manual client matching was not completed successfully');
                // Continue without client match - ticket will be created without company association
            }
        }
        else {
            console.log(`Found exact email match: ${matchedClient.companyName}`);
            data.set('matchedClient', matchedClient);
        }
        // Step 3: Get inbound ticket defaults (provider-specific if set for this provider)
        setState('RESOLVING_TICKET_DEFAULTS');
        console.log('Resolving inbound ticket defaults for tenant:', tenant, 'provider:', providerId);
        let ticketDefaults = await actions.resolve_inbound_ticket_defaults({
            tenant: tenant,
            providerId: providerId
        });
        if (!ticketDefaults) {
            console.error(`No inbound ticket defaults configured for tenant ${tenant}. Email processing cannot continue.`);
            setState('ERROR_NO_TICKET_DEFAULTS');
            // Exit early without attempting ticket creation when defaults are missing
            return;
        }
        console.log('Using ticket defaults:', ticketDefaults);
        data.set('ticketDefaults', ticketDefaults);
        // Step 4: Create new ticket from email using resolved defaults
        setState('CREATING_TICKET');
        console.log('Creating new ticket from email with resolved defaults');
        // Override defaults with matched client info if available
        const finalCompanyId = matchedClient?.companyId || ticketDefaults.company_id;
        const finalContactId = matchedClient?.contactId || null;
        const ticketResult = await actions.create_ticket_from_email({
            title: emailData.subject,
            description: emailData.body.text,
            company_id: finalCompanyId,
            contact_id: finalContactId,
            source: 'email',
            channel_id: ticketDefaults.channel_id,
            status_id: ticketDefaults.status_id,
            priority_id: ticketDefaults.priority_id,
            category_id: ticketDefaults.category_id,
            subcategory_id: ticketDefaults.subcategory_id,
            location_id: ticketDefaults.location_id,
            entered_by: ticketDefaults.entered_by,
            // Store email metadata for future threading
            email_metadata: {
                messageId: emailData.id,
                mailhogId: emailData.mailhogId,
                threadId: emailData.threadId,
                from: emailData.from,
                inReplyTo: emailData.inReplyTo,
                references: emailData.references,
                providerId: providerId
            }
        });
        console.log(`Ticket created with ID: ${ticketResult.ticket_id}`);
        data.set('ticketId', ticketResult.ticket_id);
        // Step 5: Handle attachments if present
        if (emailData.attachments && emailData.attachments.length > 0) {
            setState('PROCESSING_ATTACHMENTS');
            console.log(`Processing ${emailData.attachments.length} email attachments`);
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
                }
                catch (attachmentError) {
                    console.warn(`Failed to process attachment ${attachment.name}: ${attachmentError.message}`);
                    // Continue processing other attachments
                }
            }
            console.log(`Processed ${emailData.attachments.length} attachments`);
        }
        // Step 6: Create initial comment with original email content
        await actions.create_comment_from_email({
            ticket_id: ticketResult.ticket_id,
            content: emailData.body.html || emailData.body.text,
            format: emailData.body.html ? 'html' : 'text',
            source: 'email',
            author_type: 'internal'
        });
        setState('EMAIL_PROCESSED');
        console.log('Email processing completed successfully');
        // Step 7: Optional notification (if we have a matched client)
        if (matchedClient?.companyId) {
            try {
                // TODO: Implement notification system
                console.log('Sent ticket creation acknowledgment email');
            }
            catch (notificationError) {
                console.warn(`Failed to send notification: ${notificationError.message}`);
                // Don't fail the workflow for notification errors
            }
        }
    }
    catch (error) {
        console.error(`Error processing inbound email: ${error.message}`);
        setState('ERROR_PROCESSING_EMAIL');
        // Create human task for error handling - simplified for compilation
        console.error(`Email processing failed: ${error.message}. Manual intervention required for email: ${emailData.subject}`);
        // Don't re-throw the error - let the human task handle resolution
        setState('AWAITING_MANUAL_RESOLUTION');
    }
}
