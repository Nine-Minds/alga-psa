# Inbound Email Feature Documentation

## Overview

The Inbound Email feature enables automatic processing of incoming emails into tickets, supporting both Microsoft 365 (Outlook/Exchange) and Gmail providers. The system uses a workflow-based approach to handle email threading, client matching, and ticket creation with human task fallbacks.

## Key Features

- **Multi-Provider Support**: Microsoft 365 and Gmail integration
- **Email Threading**: Conversation continuity using standard email headers
- **Workflow Automation**: System-managed workflows with human task fallbacks
- **Client Matching**: Exact email matching with manual override capability
- **Attachment Processing**: Automatic download and association with tickets
- **Real-time Processing**: Webhook-based notifications for immediate processing
- **Security & Scalability**: Queue-based processing with tenant isolation

## Architecture

### Core Components

1. **Email Provider Adapters**: Abstraction layer for different email services
2. **Webhook Infrastructure**: Real-time email notification handling
3. **Workflow Engine**: System-managed email processing workflows
4. **Queue System**: Redis-based email processing with retry logic
5. **Configuration UI**: React components for provider setup

### Database Schema

The feature uses two main tables:

- `email_provider_configs`: Stores provider configurations and credentials
- `email_processed_messages`: Tracks processed emails to prevent duplicates

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Redis server for queue processing
- Database with migrations applied
- HTTPS endpoint for webhooks (ngrok for development)

### Installation

1. **Apply Database Migrations**
   ```bash
   npm run migrate
   ```

2. **Configure Environment Variables**
   ```bash
   # Add to your .env file
   NEXTAUTH_URL=https://your-domain.com
   REDIS_URL=redis://localhost:6379
   ```

3. **Start the Application**
   ```bash
   npm run dev
   ```

## Provider Setup

### Microsoft 365 Setup

1. **Azure AD App Registration**
   - Go to [Azure Portal](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
   - Create new app registration
   - Note the Client ID and Tenant ID

2. **Configure API Permissions**
   - Add `Mail.Read` permission
   - Add `Mail.ReadWrite` if you need to mark emails as read
   - Grant admin consent

3. **Create Client Secret**
   - Go to Certificates & secrets
   - Create new client secret
   - Save the secret value immediately

4. **Set Redirect URI**
   - Add `https://your-domain.com/api/auth/microsoft/callback`

5. **Configure in Application**
   - Use the Email Provider Configuration UI
   - Enter Client ID, Client Secret, and Tenant ID
   - Complete OAuth authorization flow

### Gmail Setup

1. **Google Cloud Console Setup**
   - Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   - Create or select a project
   - Enable Gmail API

2. **Create OAuth Credentials**
   - Go to Credentials section
   - Create OAuth 2.0 Client ID
   - Configure consent screen

3. **Set Redirect URI**
   - Add `https://your-domain.com/api/auth/google/callback`

4. **Set Up Pub/Sub (Required for Gmail)**
   - Create a Pub/Sub topic: `gmail-notifications`
   - Create subscription: `gmail-webhook-subscription`
   - Set push endpoint: `https://your-domain.com/api/email/webhooks/google`

5. **Configure in Application**
   - Use the Email Provider Configuration UI
   - Enter Client ID, Client Secret, and Project ID
   - Configure Pub/Sub settings
   - Complete OAuth authorization flow

## Email Processing Workflow

### How It Works

1. **Email Received**: Provider webhook notifies the system
2. **Queue Processing**: Email is queued for processing with retry logic
3. **Thread Detection**: System checks for existing ticket threads
4. **Client Matching**: Attempts to match sender to existing clients
5. **Ticket Creation**: Creates new ticket or adds to existing thread
6. **Attachment Processing**: Downloads and associates attachments

### Email Threading

The system uses standard email headers for conversation threading:

- `Message-ID`: Unique identifier for each email
- `In-Reply-To`: References the message being replied to
- `References`: Chain of message IDs in the conversation

### Client Matching Process

1. **Exact Match**: Look for contact with exact email address
2. **Manual Fallback**: If no match, create human task for manual selection
3. **Association Storage**: Save email-to-client mapping for future

## Configuration UI

### Email Provider Configuration

Navigate to the Email Providers section in your admin panel to:

- Add new email providers (Microsoft 365 or Gmail)
- Configure OAuth credentials and settings
- Test connections and view status
- Manage existing providers

### Provider Settings

**Microsoft 365 Options:**
- Folder filters (default: Inbox)
- Auto-processing toggle
- Max emails per sync (1-1000)

**Gmail Options:**
- Label filters (default: INBOX)
- Pub/Sub configuration
- Auto-processing toggle
- Max emails per sync (1-1000)

## API Reference

### Provider Management

```typescript
// Get all providers for a tenant
GET /api/email/providers?tenant={tenantId}

// Create new provider
POST /api/email/providers
{
  "tenant": "uuid",
  "providerType": "microsoft|google",
  "providerName": "Support Email",
  "mailbox": "support@company.com",
  "vendorConfig": { ... }
}

// Update provider
PUT /api/email/providers/{providerId}

// Test connection
POST /api/email/providers/{providerId}/test

// Delete provider
DELETE /api/email/providers/{providerId}
```

### Auto-Wiring

```typescript
// Auto-configure provider with OAuth
POST /api/email/providers/auto-wire
{
  "providerType": "microsoft|google",
  "config": {
    "tenant": "uuid",
    "providerName": "Support Email",
    "mailbox": "support@company.com",
    "clientId": "...",
    "clientSecret": "...",
    "authorizationCode": "...",
    // Additional provider-specific fields
  }
}
```

## Troubleshooting

### Common Issues

1. **OAuth Authorization Fails**
   - Verify redirect URI matches exactly
   - Check client ID and secret are correct
   - Ensure proper API permissions are granted

2. **Webhooks Not Working**
   - Verify HTTPS endpoint is accessible
   - Check webhook URL configuration
   - Validate authentication tokens

3. **Emails Not Processing**
   - Check Redis queue is running
   - Verify workflow is registered and active
   - Check provider status and error messages

4. **Duplicate Tickets Created**
   - Verify email threading headers are present
   - Check `email_processed_messages` table
   - Ensure message IDs are unique

### Debug Mode

Enable debug logging by setting:

```bash
DEBUG=email:*
NODE_ENV=development
```

### Health Checks

Monitor provider health via:

```bash
# Check provider status
GET /api/email/providers/{providerId}

# Test connection
POST /api/email/providers/{providerId}/test
```

## Security Considerations

### Authentication & Authorization

- All API endpoints require authentication
- Provider configurations are tenant-isolated
- OAuth tokens are encrypted in database

### Webhook Security

- Microsoft webhooks use validation tokens
- Gmail uses Google Cloud IAM for authentication
- All webhook endpoints validate request signatures

### Data Privacy

- Email content is processed but not permanently stored
- Only metadata required for ticket creation is retained
- Attachments are stored in secure file storage system

## Performance & Scaling

### Queue Processing

- Redis-based queue with configurable workers
- Exponential backoff retry logic (3 attempts: 2s, 4s, 8s)
- Dead letter queue for failed messages

### Rate Limiting

- Respects provider API rate limits
- Configurable max emails per sync
- Automatic throttling during peak loads

### Database Optimization

- Indexed queries for email threading lookups
- Partitioned tables for high-volume tenants
- Regular cleanup of processed message records

## Monitoring & Alerts

### Key Metrics

- Email processing latency
- Provider connection status
- Queue depth and processing rate
- Error rates by provider type

### Logging

The system logs key events:

- Provider connection status changes
- Email processing start/completion
- Threading decisions and client matches
- Error conditions and retries

## Development

### Local Development

1. Use ngrok for webhook testing:
   ```bash
   ngrok http 3000
   ```

2. Update provider webhook URLs to ngrok URL

3. Monitor logs for email processing:
   ```bash
   npm run dev | grep "email:"
   ```

### Testing

Run the test suite:

```bash
npm test src/services/email/
```

### Adding New Providers

To add support for a new email provider:

1. Create adapter class implementing `EmailProviderAdapter`
2. Add provider type to database schema
3. Create UI form components
4. Update auto-wiring service
5. Add webhook endpoint handler

## Migration Notes

### From Previous Email Systems

If migrating from an existing email-to-ticket system:

1. Export existing email-to-client associations
2. Import via `save_email_client_association` action
3. Update email forwarding rules to new webhooks
4. Test thoroughly before switching over

### Breaking Changes

Version 1.0.0 introduces:

- New database schema (migrations required)
- OAuth-based authentication (API keys deprecated)
- Webhook-based processing (polling deprecated)

## Support

For technical support:

1. Check the troubleshooting section above
2. Review application logs for specific errors
3. Test provider connections via UI
4. Verify webhook endpoints are accessible

## Changelog

### Version 1.0.0 (Current)

- Initial release with Microsoft 365 and Gmail support
- System-managed workflows with human task fallbacks
- Real-time webhook processing
- Configuration UI with auto-wiring
- Email threading and client matching