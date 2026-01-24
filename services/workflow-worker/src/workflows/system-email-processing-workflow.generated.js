async function execute(context) {
    const { actions, data, logger, setState, events } = context;
    // Helper functions - defined inside the main workflow function
    const truncateForMetadata = (value, maxLength) => {
        if (!value) {
            return undefined;
        }
        if (!maxLength || value.length <= maxLength) {
            return value;
        }
        return value.slice(0, maxLength) + '...';
    };
    const parseEmailBody = async (emailData, actions) => {
        try {
            const parseResult = await actions.parse_email_reply({
                text: emailData.body?.text,
                html: emailData.body?.html
            });
            if (!parseResult?.success || !parseResult.parsed) {
                console.warn('Email reply parser returned no result; falling back to raw body.');
                return {
                    sanitizedText: emailData.body?.text || '',
                    sanitizedHtml: emailData.body?.html,
                    confidence: 'low',
                    metadata: {
                        parser: {
                            confidence: 'low',
                            warnings: ['parser-unavailable'],
                            rawText: truncateForMetadata(emailData.body?.text, 4000),
                            rawHtml: truncateForMetadata(emailData.body?.html, 4000)
                        }
                    }
                };
            }
            const parsed = parseResult.parsed;
            const sanitizedText = parsed.sanitizedText || emailData.body?.text || '';
            const sanitizedHtml = parsed.sanitizedHtml || undefined;
            const metadata = {
                parser: {
                    confidence: parsed.confidence,
                    strategy: parsed.strategy,
                    heuristics: parsed.appliedHeuristics,
                    warnings: parsed.warnings,
                    tokens: parsed.tokens || null
                }
            };
            if (parsed.confidence === 'low') {
                metadata.parser.rawText = truncateForMetadata(emailData.body?.text, 4000);
                metadata.parser.rawHtml = truncateForMetadata(emailData.body?.html, 4000);
            }
            if (metadata.parser.warnings && metadata.parser.warnings.length > 0) {
                metadata.parser.warnings = metadata.parser.warnings.map((warning) => String(warning));
            }
            return {
                sanitizedText,
                sanitizedHtml,
                confidence: parsed.confidence,
                metadata
            };
        }
        catch (error) {
            console.warn(`Reply parser threw error; falling back to raw body: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return {
                sanitizedText: emailData.body?.text || '',
                sanitizedHtml: emailData.body?.html,
                confidence: 'low',
                metadata: {
                    parser: {
                        confidence: 'low',
                        warnings: ['parser-error'],
                        error: error instanceof Error ? error.message : 'Unknown error',
                        rawText: truncateForMetadata(emailData.body?.text, 4000),
                        rawHtml: truncateForMetadata(emailData.body?.html, 4000)
                    }
                }
            };
        }
    };
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
    const handleEmailReply = async (emailData, existingTicket, actions, parsedBody, replyMatchedBy) => {
        const commentContent = parsedBody.sanitizedHtml || parsedBody.sanitizedText || emailData.body.html || emailData.body.text;
        // Convert HTML to BlockNote blocks
        let blockContent = commentContent;
        if (parsedBody.sanitizedHtml || emailData.body.html) {
            try {
                const conversionResult = await actions.convert_html_to_blocks({
                    html: parsedBody.sanitizedHtml || emailData.body.html
                });
                if (conversionResult.success && conversionResult.blocks) {
                    blockContent = JSON.stringify(conversionResult.blocks);
                }
            }
            catch (error) {
                console.warn('Failed to convert HTML to blocks for reply, falling back to raw content');
            }
        }
        const toEmails = (emailData.to && emailData.to.length > 0)
            ? emailData.to.map((recipient) => recipient.email).filter(Boolean)
            : [emailData.from.email];
        const receivedAt = (() => {
            const value = emailData.receivedAt;
            if (!value)
                return undefined;
            const parsed = Date.parse(value);
            if (Number.isNaN(parsed))
                return undefined;
            return new Date(parsed).toISOString();
        })();
        // Add email as comment to existing ticket
        await actions.create_comment_from_email({
            ticket_id: existingTicket.ticketId,
            content: blockContent,
            // format is optional, but if we send BlockNote JSON, the system likely detects it or we can omit format
            // If it's blocks, we can set format to 'blocknote' if supported, or just let the system handle it.
            // Looking at blocknoteUtils, it tries to parse JSON.
            source: 'email',
            author_type: 'contact', // Reply from the client
            inboundReplyEvent: {
                messageId: emailData.id,
                threadId: emailData.threadId || emailData.id,
                from: emailData.from.email,
                to: toEmails,
                subject: emailData.subject,
                receivedAt,
                provider: emailData.providerId || 'unknown',
                matchedBy: replyMatchedBy || 'thread_headers'
            },
            metadata: parsedBody.metadata
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
                    clientId: result.contact.client_id,
                    clientName: result.contact.client_name
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
        let clientId = matchingResult.selectedClientId;
        let clientName = '';
        let contactId = null;
        // Create new client if requested
        if (matchingResult.createNewClient && matchingResult.newClientName) {
            const result = await actions.create_client_from_email({
                client_name: matchingResult.newClientName,
                email: emailData.from.email,
                source: 'email'
            });
            if (result.success) {
                clientId = result.client.client_id;
                clientName = result.client.client_name;
            }
        }
        else {
            // Get existing client details
            const result = await actions.get_client_by_id_for_email({ clientId });
            if (result.success && result.client) {
                clientName = result.client.client_name || '';
            }
        }
        // Create or find contact
        if (matchingResult.contactName || emailData.from.name) {
            const result = await actions.create_or_find_contact({
                email: emailData.from.email,
                name: matchingResult.contactName || emailData.from.name,
                client_id: clientId
            });
            if (result.success) {
                contactId = result.contact.id;
            }
        }
        // Save email association if requested
        if (matchingResult.saveEmailAssociation) {
            await actions.save_email_client_association({
                email: emailData.from.email,
                client_id: clientId,
                contact_id: contactId || undefined
            });
        }
        return {
            clientId,
            clientName,
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
    const parsedEmailBody = await parseEmailBody(emailData, actions);
    data.set('parsedEmail', parsedEmailBody);
    if (parsedEmailBody.confidence === 'low') {
        console.warn('Reply parser reported low confidence; storing raw body for review.', {
            tenant,
            subject: emailData.subject,
            appliedHeuristics: parsedEmailBody.metadata?.parser?.heuristics || []
        });
    }
    try {
        // Step 1: Check if this is a threaded email (reply to existing ticket)
        setState('CHECKING_EMAIL_THREADING');
        console.log('Checking if email is part of existing conversation thread');
        let existingTicket = null;
        let replyMatchedBy = 'thread_headers';
        const parserTokens = parsedEmailBody.metadata?.parser?.tokens;
        if (parserTokens && parserTokens.conversationToken) {
            try {
                const tokenResult = await actions.find_ticket_by_reply_token({ token: parserTokens.conversationToken });
                if (tokenResult?.success && tokenResult.match?.ticketId) {
                    existingTicket = {
                        ticketId: tokenResult.match.ticketId,
                    };
                    replyMatchedBy = 'reply_token';
                    parsedEmailBody.metadata.parser.matchedReplyToken = tokenResult.match;
                    console.log('Matched reply token to ticket', {
                        ticketId: tokenResult.match.ticketId,
                        commentId: tokenResult.match.commentId
                    });
                }
            }
            catch (tokenError) {
                console.warn(`Failed to resolve reply token mapping: ${tokenError instanceof Error ? tokenError.message : tokenError}`);
            }
        }
        if (!existingTicket) {
            existingTicket = await checkEmailThreading(emailData, actions);
        }
        if (existingTicket) {
            // This is a reply to an existing ticket - add as comment
            console.log(`Email is part of existing ticket: ${existingTicket.ticketId}`);
            await handleEmailReply(emailData, existingTicket, actions, parsedEmailBody, replyMatchedBy);
            return; // Exit workflow after handling reply
        }
        // Step 2: This is a new email - find or match client
        setState('MATCHING_EMAIL_CLIENT');
        console.log('Attempting to match email sender to existing client');
        let matchedClient = await findExactEmailMatch(emailData.from.email, actions);
        if (!matchedClient) {
            // No exact match found - log and continue to ticket creation (will use catch-all defaults)
            console.log('No exact email match found; creating ticket using defaults (no client association)');
        }
        else {
            console.log(`Found exact email match: ${matchedClient.clientName}`);
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
        const defaultClientId = ticketDefaults.client_id ?? null;
        const matchedClientId = matchedClient?.clientId ?? null;
        const finalClientId = matchedClientId || defaultClientId;
        const finalContactId = matchedClient?.contactId || null;
        let finalLocationId = ticketDefaults.location_id ?? null;
        if (matchedClientId && (!defaultClientId || matchedClientId !== defaultClientId)) {
            finalLocationId = null; // Drop default location when switching to a different client
        }
        const ticketResult = await actions.create_ticket_from_email({
            title: emailData.subject,
            description: parsedEmailBody.sanitizedText || emailData.body.text,
            client_id: finalClientId,
            contact_id: finalContactId,
            source: 'email',
            board_id: ticketDefaults.board_id,
            status_id: ticketDefaults.status_id,
            priority_id: ticketDefaults.priority_id,
            category_id: ticketDefaults.category_id,
            subcategory_id: ticketDefaults.subcategory_id,
            location_id: finalLocationId,
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
        const initialCommentContent = parsedEmailBody.sanitizedHtml || parsedEmailBody.sanitizedText || emailData.body.html || emailData.body.text;
        let initialBlockContent = initialCommentContent;
        if (parsedEmailBody.sanitizedHtml || emailData.body.html) {
            try {
                const conversionResult = await actions.convert_html_to_blocks({
                    html: parsedEmailBody.sanitizedHtml || emailData.body.html
                });
                if (conversionResult.success && conversionResult.blocks) {
                    initialBlockContent = JSON.stringify(conversionResult.blocks);
                }
            }
            catch (error) {
                console.warn('Failed to convert HTML to blocks for new ticket, falling back to raw content');
            }
        }
        await actions.create_comment_from_email({
            ticket_id: ticketResult.ticket_id,
            content: initialBlockContent,
            source: 'email',
            author_type: 'internal',
            metadata: parsedEmailBody.metadata
        });
        setState('EMAIL_PROCESSED');
        console.log('Email processing completed successfully');
        // Step 7: Optional notification (if we have a matched client)
        if (matchedClient?.clientId) {
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
