# Inbound Email Workflow System

## 1. Introduction and Purpose

The inbound email system is designed to enable Alga PSA to process incoming emails and integrate them with the platform's workflow system. This allows for automated ticket creation, client matching, and custom email processing workflows.

### Primary Goals:
- Create an abstraction layer for processing incoming emails from multiple providers
- Transform emails into workflow events for processing
- Enable ticket creation from inbound emails
- Match email senders to existing clients
- Support cloning and customization of the email processing workflow

## 2. System Architecture

### 2.1 Core Components

![Inbound Email Architecture](https://example.com/inbound-email-architecture.png)

The inbound email system consists of these major components:

1. **Email Provider Adapters**: Interfaces to different email providers (Microsoft Graph API, Google Gmail API)
2. **Email Listener Service**: Monitors mailboxes for new messages
3. **Email Parser**: Extracts relevant data from email messages
4. **Workflow Event Emitter**: Translates emails into workflow events
5. **Inbound Email Workflow**: Processes email events and creates tickets

### 2.2 Data Flow

1. **Email Reception**:
   - Email providers send notifications to our webhook endpoints when new messages arrive
   - The webhook handler retrieves the message details via the appropriate provider adapter

2. **Email Processing**:
   - The Email Parser extracts relevant data (sender, subject, body, attachments)
   - The system attempts to match the sender email with existing client records
   - The email is transformed into a workflow event

3. **Workflow Integration**:
   - The workflow event is published to the event bus
   - The Inbound Email Workflow is triggered by this event
   - The workflow processes the event according to its defined logic
   - A ticket is created based on the email content

## 3. Email Provider Adapters

### 3.1 Common Interface

```typescript
interface EmailProviderAdapter {
  // Connect to the email provider
  connect(): Promise<void>;
  
  // Set up webhooks for incoming messages
  registerWebhookSubscription(): Promise<void>;
  
  // Renew webhook subscription before expiration
  renewWebhookSubscription(): Promise<void>;
  
  // Process webhook notification data
  processWebhookNotification(payload: any): Promise<string[]>;
  
  // Mark a message as read/processed
  markMessageProcessed(messageId: string): Promise<void>;
  
  // Get message details including attachments
  getMessageDetails(messageId: string): Promise<EmailMessageDetails>;
}
```

### 3.2 Microsoft Graph API Adapter

The Microsoft Graph API adapter connects to Microsoft 365/Exchange Online accounts using OAuth2 authentication.

Key features:
- OAuth2 authentication flow with token refresh
- Webhook subscription for real-time notifications
- Full message body and attachment retrieval
- Message status management

Implementation considerations:
- Microsoft Graph API v1.0 endpoints
- Delegated permissions for mail access
- Token caching and refresh handling
- Rate limiting and retry logic
- Webhook subscription management and renewal
- Notification endpoint security

### 3.3 Google Gmail API Adapter

The Google Gmail API adapter connects to Gmail accounts using OAuth2 authentication.

Key features:
- OAuth2 authentication flow with token refresh
- Push notifications via Google Pub/Sub
- Full message body and attachment retrieval
- Label management for processed messages

Implementation considerations:
- Gmail API v1 endpoints
- Appropriate OAuth scopes for mail access
- Token caching and refresh handling
- Rate limiting and retry logic
- Google Pub/Sub topic and subscription management
- Webhook security with token verification

## 4. Email Event Model

### 4.1 Email Message Structure

```typescript
interface EmailMessage {
  id: string;
  provider: 'microsoft' | 'google';
  providerId: string;
  receivedAt: string;
  from: {
    email: string;
    name?: string;
  };
  to: Array<{
    email: string;
    name?: string;
  }>;
  cc?: Array<{
    email: string;
    name?: string;
  }>;
  subject: string;
  body: {
    text: string;
    html?: string;
  };
  attachments?: Array<{
    id: string;
    name: string;
    contentType: string;
    size: number;
    contentId?: string;
  }>;
  threadId?: string;
  references?: string[];
  inReplyTo?: string;
  tenant: string;
}
```

### 4.2 Workflow Event Structure

```typescript
interface InboundEmailEvent {
  event_type: 'INBOUND_EMAIL_RECEIVED';
  payload: {
    emailId: string;
    tenant: string;
    emailData: EmailMessage;
    matchedClient?: {
      companyId: string;
      companyName: string;
      contactId?: string;
      contactName?: string;
    };
  };
}
```

## 5. Workflow Integration

### 5.1 Event Registration

The `INBOUND_EMAIL_RECEIVED` event should be registered in the system event catalog:

```typescript
// In the event catalog seed file
{
  name: 'INBOUND_EMAIL_RECEIVED',
  description: 'Triggered when a new email is received through configured inbound email channels',
  payload_schema: JSON.stringify(inboundEmailEventSchema),
  is_system_event: true
}
```

### 5.2 Default Inbound Email Workflow

The system will provide a default workflow for processing inbound emails:

```typescript
// inbound-email-workflow.ts
async function inboundEmailWorkflow(context: WorkflowContext): Promise<void> {
  const { actions, data, logger, setState, executionId } = context;
  const { triggerEvent } = context.input;
  
  // Extract email data from the event payload
  const emailData = triggerEvent.payload.emailData;
  const matchedClient = triggerEvent.payload.matchedClient;
  
  setState('PROCESSING_INBOUND_EMAIL');
  logger.info(`Processing inbound email: ${emailData.subject}`);
  
  // Store relevant data
  data.set('emailData', emailData);
  data.set('matchedClient', matchedClient);
  
  try {
    // Determine if we can match to an existing client
    if (!matchedClient) {
      // Optional: Create a human task to manually match the client
      const taskResult = await actions.createTaskAndWaitForResult({
        taskType: 'match_email_to_client',
        title: `Match Email to Client: ${emailData.subject}`,
        description: `Please match this email from ${emailData.from.email} to a client`,
        contextData: {
          emailData,
          potentialMatches: [] // Could be populated by a fuzzy search
        }
      });
      
      if (taskResult.success && taskResult.resolutionData?.matchedClient) {
        data.set('matchedClient', taskResult.resolutionData.matchedClient);
      } else {
        logger.warn('Unable to match email to client');
      }
    }
    
    setState('CREATING_TICKET');
    
    // Create the ticket
    const ticketResult = await actions.create_ticket({
      title: emailData.subject,
      description: emailData.body.text,
      company_id: data.get('matchedClient')?.companyId,
      contact_id: data.get('matchedClient')?.contactId,
      source: 'email',
      channel_id: '{{EMAIL_CHANNEL_ID}}', // Configurable
      status_id: '{{NEW_TICKET_STATUS_ID}}', // Configurable
      priority_id: '{{DEFAULT_PRIORITY_ID}}', // Configurable
      email_metadata: {
        messageId: emailData.id,
        threadId: emailData.threadId,
        from: emailData.from
      }
    });
    
    logger.info(`Ticket created with ID: ${ticketResult.id}`);
    data.set('ticketId', ticketResult.id);
    
    // Handle attachments if present
    if (emailData.attachments && emailData.attachments.length > 0) {
      setState('PROCESSING_ATTACHMENTS');
      
      for (const attachment of emailData.attachments) {
        await actions.process_email_attachment({
          emailId: emailData.id,
          attachmentId: attachment.id,
          ticketId: ticketResult.id,
          tenant: triggerEvent.tenant
        });
      }
      
      logger.info(`Processed ${emailData.attachments.length} attachments`);
    }
    
    // Create a comment with the original email content
    await actions.create_ticket_comment({
      ticket_id: ticketResult.id,
      content: emailData.body.html || emailData.body.text,
      format: emailData.body.html ? 'html' : 'text',
      source: 'email',
      author_type: 'system',
      metadata: {
        emailSource: true,
        originalEmailId: emailData.id
      }
    });
    
    setState('EMAIL_PROCESSED');
    
    // Optional: Send notification or auto-response
    if (data.get('matchedClient')?.companyId) {
      await actions.send_ticket_created_notification({
        ticketId: ticketResult.id,
        notificationType: 'email_acknowledgment'
      });
    }
    
  } catch (error: any) {
    logger.error(`Error processing inbound email: ${error.message}`);
    setState('ERROR_PROCESSING_EMAIL');
    
    // Create a human task for error handling
    await actions.createHumanTask({
      taskType: 'email_processing_error',
      title: 'Error Processing Inbound Email',
      description: `Failed to process email: ${emailData.subject}`,
      contextData: {
        error: error.message,
        emailData,
        workflowInstanceId: executionId
      }
    });
  }
}
```

## 6. Email Webhook Service

### 6.1 Service Architecture

The Email Webhook Service will be implemented as a separate service that:

1. Provides webhook endpoints for email providers to notify of new messages
2. Reads email provider configurations from the database
3. Initializes appropriate provider adapters
4. Establishes and manages webhook subscriptions with email providers
5. Processes incoming webhook notifications and submits email events to the workflow system

### 6.2 Configuration Schema

```typescript
interface EmailProviderConfig {
  id: string;
  tenant: string;
  name: string;
  provider_type: 'microsoft' | 'google';
  mailbox: string;
  folder_to_monitor: string; // Defaults to 'Inbox'
  active: boolean;
  // Common webhook fields as real columns
  webhook_notification_url: string;
  webhook_subscription_id?: string;
  webhook_verification_token?: string;
  webhook_expires_at?: string; // ISO date
  last_subscription_renewal?: string; // ISO date
  // Connection status fields
  connection_status: 'connected' | 'disconnected' | 'error';
  last_connection_test?: string; // ISO date
  connection_error_message?: string;
  // Provider-specific configuration (OAuth scopes, etc.)
  provider_config?: {
    // Microsoft-specific
    tenantId?: string;
    scopes?: string[];
    // Google-specific
    projectId?: string;
    pubsubTopic?: string;
    // Common OAuth settings
    clientId?: string; // Usually from environment, but could be per-provider
    customScopes?: string[];
  };
  created_at: string; // ISO date
  updated_at: string; // ISO date
}
```

## 7. Database Schema

### 7.1 Provider Configuration Tables

```sql
-- Provider configuration with real fields for common properties
CREATE TABLE email_provider_configs (
  id uuid NOT NULL,
  tenant uuid NOT NULL,
  name text NOT NULL,
  provider_type text NOT NULL, -- 'microsoft' or 'google'
  mailbox text NOT NULL,
  folder_to_monitor text DEFAULT 'Inbox',
  active boolean DEFAULT true,
  -- Common webhook fields as real columns
  webhook_notification_url text,
  webhook_subscription_id text,
  webhook_verification_token text,
  webhook_expires_at timestamp,
  last_subscription_renewal timestamp,
  -- OAuth/connection status fields
  connection_status text DEFAULT 'disconnected', -- 'connected', 'disconnected', 'error'
  last_connection_test timestamp,
  connection_error_message text,
  -- Provider-specific configuration as JSONB (OAuth scopes, etc.)
  provider_config jsonb,
  -- Standard timestamps
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT email_provider_configs_pkey PRIMARY KEY (id, tenant),
  CONSTRAINT email_provider_configs_tenant_fkey FOREIGN KEY (tenant)
    REFERENCES tenants (tenant) ON DELETE CASCADE,
  CONSTRAINT email_provider_configs_provider_type_check 
    CHECK (provider_type IN ('microsoft', 'google')),
  CONSTRAINT email_provider_configs_connection_status_check 
    CHECK (connection_status IN ('connected', 'disconnected', 'error'))
);

-- Processed messages tracking with real fields
CREATE TABLE email_processed_messages (
  message_id text NOT NULL,
  provider_id uuid NOT NULL,
  tenant uuid NOT NULL,
  processed_at timestamp NOT NULL DEFAULT now(),
  processing_status text NOT NULL DEFAULT 'success', -- 'success', 'failed', 'partial'
  ticket_id uuid,
  workflow_execution_id uuid,
  error_message text,
  -- Message metadata as real fields
  from_email text,
  subject text,
  received_at timestamp,
  attachment_count integer DEFAULT 0,
  -- Additional metadata as JSONB if needed
  metadata jsonb,
  CONSTRAINT email_processed_messages_pkey PRIMARY KEY (message_id, provider_id, tenant),
  CONSTRAINT email_processed_messages_provider_id_fkey FOREIGN KEY (provider_id, tenant)
    REFERENCES email_provider_configs (id, tenant) ON DELETE CASCADE,
  CONSTRAINT email_processed_messages_tenant_fkey FOREIGN KEY (tenant)
    REFERENCES tenants (tenant) ON DELETE CASCADE,
  CONSTRAINT email_processed_messages_processing_status_check 
    CHECK (processing_status IN ('success', 'failed', 'partial'))
);

-- Index for common queries
CREATE INDEX idx_email_provider_configs_tenant_active 
  ON email_provider_configs (tenant, active) WHERE active = true;

CREATE INDEX idx_email_processed_messages_tenant_processed_at 
  ON email_processed_messages (tenant, processed_at DESC);

CREATE INDEX idx_email_processed_messages_tenant_status 
  ON email_processed_messages (tenant, processing_status);
```

### 7.2 System Workflow Registration

```sql
-- Add inbound email workflow registration
INSERT INTO system_workflow_registrations (
  name, 
  description,
  version,
  tenant,
  created_at
)
VALUES (
  'inbound_email_processing',
  'Process inbound emails and create tickets',
  1,
  '{{SYSTEM_TENANT_ID}}',
  now()
);

-- Add version with code
INSERT INTO system_workflow_registration_versions (
  registration_id,
  version,
  created_at,
  code
)
VALUES (
  (SELECT id FROM system_workflow_registrations WHERE name = 'inbound_email_processing'),
  1,
  now(),
  '-- Workflow code will be here'
);

-- Add event attachment to the workflow
INSERT INTO system_workflow_event_attachments (
  registration_id,
  event_type,
  created_at
)
VALUES (
  (SELECT id FROM system_workflow_registrations WHERE name = 'inbound_email_processing'),
  'INBOUND_EMAIL_RECEIVED',
  now()
);
```

## 8. Implementation Plan

### Phase 1: Core Infrastructure
1. Create database schema for email provider configurations
2. Implement email provider adapter interfaces
3. Create webhook endpoint infrastructure
4. Build Microsoft Graph API adapter with webhook subscription
5. Create email message to workflow event transformer
6. Register INBOUND_EMAIL_RECEIVED event type

### Phase 2: Default Workflow
1. Implement default inbound email workflow
2. Create system forms for client matching and error handling
3. Build email attachment processor
4. Integrate workflow with the ticket creation system

### Phase 3: Google Gmail Integration
1. Implement Google Gmail API adapter
2. Add Gmail-specific authentication flow
3. Create Google Pub/Sub subscription handler
4. Add Gmail webhook endpoint

### Phase 4: Configuration UI
1. Create UI components for email provider configuration
2. Build workflow cloning and customization interfaces
3. Add email rule configuration for routing logic

### Phase 5: Testing and Deployment
1. Develop comprehensive tests for all components
2. Set up monitoring for the email listener service
3. Create documentation for configuring email providers
4. Deploy the solution

## 9. Security Considerations

1. **Credential Management**:
   - Store OAuth credentials securely in the database (encrypted)
   - Use secret provider services for accessing credentials
   - Implement token refresh logic securely
   - Rotate webhook verification tokens periodically

2. **Access Control**:
   - Enforce tenant isolation for all email processing
   - Restrict access to email configuration UI to administrators
   - Implement rate limiting for webhook endpoints to prevent abuse
   - Verify webhook notifications with provider-specific validation (signature verification)

3. **Data Protection**:
   - Process email content in memory and avoid storing sensitive parts
   - Implement proper attachment handling and scanning
   - Respect data retention policies for email content
   - Use HTTPS for all webhook endpoints
   - Implement webhook request validation to prevent spoofing

## 10. Customization and Extension

The inbound email workflow is designed to be customizable by tenants through:

1. **Workflow Cloning**: Tenants can clone the default workflow and customize it
2. **Email Routing Rules**: Configure rules to route emails to different workflows
3. **Form Customization**: Customize the forms used in the workflow
4. **Integration Points**: Define custom actions for pre and post-processing

Example customization: A tenant could extend the workflow to:
- Automatically categorize tickets based on email content
- Apply specialized routing based on sender domains
- Integrate with AI services for sentiment analysis or auto-response generation

## 11. Relationship to Other Systems

### 11.1 Workflow System
The inbound email system builds on the existing workflow infrastructure, leveraging:
- Event sourcing architecture
- Typesafe workflow definitions
- Human task integration
- Action execution framework

### 11.2 Ticket System
The workflow integrates with the ticketing system to:
- Create new tickets from emails
- Link emails to existing ticket threads
- Attach email metadata to tickets for reference

### 11.3 Document System
Email attachments integrate with the document system:
- Attachments are stored using the file storage system
- Documents are associated with the created tickets
- Content is properly indexed and searchable

## 12. Conclusion

The inbound email workflow system provides a robust and extensible foundation for processing incoming emails in Alga PSA. By integrating with the workflow system, it enables customizable processing logic while maintaining a consistent architecture pattern throughout the application.

The design focuses on flexibility, security, and tenant isolation, ensuring that email processing can be tailored to each tenant's specific needs while maintaining the reliability and scalability of the platform.