# Inbound Email Workflow - Implementation Guide

This guide provides step-by-step instructions for implementing the inbound email workflow system as described in the [inbound-email-workflow.md](./inbound-email-workflow.md).

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Phase 1: Core Infrastructure](#phase-1-core-infrastructure)
3. [Phase 2: Default Workflow](#phase-2-default-workflow)
4. [Phase 3: Google Gmail Integration](#phase-3-google-gmail-integration)
5. [Phase 4: Configuration UI](#phase-4-configuration-ui)
6. [Phase 5: Testing and Deployment](#phase-5-testing-and-deployment)
7. [Development Guidelines](#development-guidelines)
8. [Testing Strategy](#testing-strategy)

## Prerequisites

Before starting implementation, ensure you have:

- Access to the Alga PSA codebase
- Understanding of the workflow system architecture
- Database migration capabilities
- Email provider developer accounts (Microsoft Graph, Google Gmail)
- Knowledge of TypeScript, Node.js, and the project's tech stack

## Phase 1: Core Infrastructure

### 1.1 Database Schema Implementation

**Task: Create email provider configuration tables**

Create a new migration file using the proper Knex command:

```bash
# In server directory
cd server && npx knex migrate:make create_email_provider_tables --knexfile knexfile.cjs --env migration
```

Implementation details:
- `email_provider_configs` table with tenant support
- `email_processed_messages` table for tracking
- Proper foreign key constraints and CitusDB compatibility
- **Real fields for common properties** (name, provider_type, mailbox, active, etc.)
- **JSONB only for vendor-specific configurations** (OAuth scopes, specific settings)
- **IMPORTANT**: Include `tenant` in primary keys for CitusDB compatibility
- Use UUID data type for tenant columns
- Filter all queries on tenant column

**Key requirements:**
- Follow CitusDB tenant column standards
- Include tenant in all WHERE clauses and JOINs
- Use `gen_random_uuid()` for generating UUIDs
- Set NOT NULL constraint on tenant columns

**Example Migration Schema:**
```sql
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
  connection_status text DEFAULT 'disconnected',
  last_connection_test timestamp,
  connection_error_message text,
  -- JSONB only for provider-specific settings
  provider_config jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT email_provider_configs_pkey PRIMARY KEY (id, tenant),
  CONSTRAINT email_provider_configs_tenant_fkey FOREIGN KEY (tenant)
    REFERENCES tenants (tenant) ON DELETE CASCADE
);
```

**Provider Config JSONB Examples:**
```typescript
// Microsoft Graph provider_config
{
  "tenantId": "microsoft-tenant-id",
  "scopes": ["https://graph.microsoft.com/Mail.Read", "https://graph.microsoft.com/Mail.ReadWrite"],
  "customSettings": {
    "deltaSync": true,
    "includeAttachments": true
  }
}

// Google Gmail provider_config  
{
  "projectId": "google-cloud-project-id",
  "pubsubTopic": "gmail-notifications",
  "scopes": ["https://www.googleapis.com/auth/gmail.readonly"],
  "customSettings": {
    "labelToMonitor": "INBOX",
    "historyTypes": ["messageAdded"]
  }
}
```

**Files to create:**
- `server/migrations/YYYYMMDDHHMMSS_create_email_provider_tables.cjs`

### 1.2 Email Provider Adapter Interface

**Task: Define the core adapter interface**

Create the base interfaces and types:

```typescript
// server/src/interfaces/emailProvider.interface.ts
interface EmailProviderAdapter {
  connect(): Promise<void>;
  registerWebhookSubscription(): Promise<void>;
  renewWebhookSubscription(): Promise<void>;
  processWebhookNotification(payload: any): Promise<string[]>;
  markMessageProcessed(messageId: string): Promise<void>;
  getMessageDetails(messageId: string): Promise<EmailMessageDetails>;
}
```

**Files to create:**
- `server/src/interfaces/emailProvider.interface.ts`
- `server/src/interfaces/email.interfaces.ts` (following existing naming pattern)
- `server/src/types/emailProvider.types.ts`

### 1.3 Microsoft Graph API Adapter

**Task: Implement Microsoft Graph integration**

Create the Microsoft-specific adapter:

**Key implementation points:**
- OAuth2 flow with tenant-specific configuration
- Webhook subscription management
- Token refresh handling
- Rate limiting and retry logic
- Message content and attachment retrieval

**Files to create:**
- `server/src/services/email/providers/MicrosoftGraphAdapter.ts`
- `server/src/services/email/providers/base/BaseEmailAdapter.ts`
- `server/src/utils/microsoftGraph.ts`

### 1.4 Webhook Infrastructure

**Task: Create webhook endpoints and routing**

Create the webhook service infrastructure:

**Key components:**
- Next.js API routes for webhook endpoints
- Provider-specific notification handlers
- Webhook verification and security
- Redis queue integration for reliable processing
- Event transformation and publishing

**Files to create:**
- `server/src/services/email/EmailWebhookService.ts`
- `server/src/services/email/EmailQueueService.ts` (Redis queue integration)
- `server/src/pages/api/email/webhooks/microsoft.ts`
- `server/src/pages/api/email/webhooks/google.ts`
- `server/src/middleware/emailWebhookAuth.ts`

### 1.5 System Event Catalog Integration

**Task: Register email events in system event catalog and create system-managed workflow**

Integrate with the existing event catalog system to create a system-managed email processing workflow:

**Implementation steps:**
1. Add email events to `system_event_catalog` table (global events)
2. Register email processing workflow in `system_workflow_registrations`
3. Create auto-wiring mechanism for email provider activation
4. Implement email threading for ticket conversations
5. Create hardcoded retry policies for MVP

**Key features:**
- System-managed workflow (not tenant-customizable)
- Automatic event wiring when email provider is activated
- Automatic event unwiring when email provider is deactivated
- Email threading support for ticket conversations
- Each email triggers individual workflow execution (no batching)

**System Events to Add:**
```sql
INSERT INTO system_event_catalog (event_type, name, description, category, payload_schema) VALUES
('INBOUND_EMAIL_RECEIVED', 'Inbound Email Received', 'Triggered when an email is received from a configured email provider', 'Email Processing', 
 '{"type": "object", "properties": {"emailId": {"type": "string"}, "providerId": {"type": "string", "format": "uuid"}, "tenant": {"type": "string", "format": "uuid"}, "emailData": {"type": "object"}}, "required": ["emailId", "providerId", "tenant", "emailData"]}');
```

**Files to create:**
- `server/src/services/email/EmailQueueService.ts` (simplified with hardcoded retry policies)
- `server/migrations/YYYYMMDDHHMMSS_register_email_system_workflow.cjs`

**Files to modify:**
- `server/migrations/YYYYMMDDHHMMSS_create_email_provider_tables.cjs`
- `shared/workflow/workflows/` (add email processing workflow)
- Integration activation/deactivation logic for auto-wiring

## Phase 2: Default Workflow

### 2.1 System-Managed Workflow Definition

**Task: Create the system-managed inbound email workflow**

Implement the workflow code as a system-managed workflow with simplified features for MVP:

**MVP Features:**
- Email processing and direct client email matching (exact match only)
- Ticket creation with email metadata
- Email threading as comments on existing tickets
- Attachment handling
- Inline forms for human tasks (no separate form definitions)
- Hardcoded retry policies and error handling

**Email Threading Logic:**
1. Check if email has `In-Reply-To` or `References` headers
2. Look up existing ticket by original email metadata
3. If found, add email as comment to existing ticket
4. If not found, create new ticket

**Files to create:**
- `shared/workflow/workflows/system-email-processing-workflow.ts`
- `shared/workflow/actions/email/processEmailAttachment.ts`
- `shared/workflow/actions/email/findOrCreateTicketFromEmail.ts` (with threading logic)
- `shared/workflow/actions/email/addEmailCommentToTicket.ts`

### 2.2 System Workflow Registration

**Task: Register the workflow as a system-managed workflow**

Create migration to register the workflow in the system workflow tables:

**Implementation details:**
- Add to `system_workflow_registrations` table with deterministic UUID
- Create version entry in `system_workflow_registration_versions` with workflow code
- Use auto-wiring pattern from QBO integration for event attachments
- System-managed flag ensures it's not customizable by tenants

**System Workflow Registration Pattern:**
```sql
-- Fixed registration ID for deterministic system workflow
INSERT INTO system_workflow_registrations (
  registration_id, name, description, category, version, status, definition
) VALUES (
  'email-processing-workflow-id', -- Fixed UUID
  'Email Processing Workflow',
  'System-managed workflow for processing inbound emails and creating tickets',
  'Email Processing', 
  '1.0.0',
  'active',
  '{"isSystemManaged": true, "autoWireEvents": ["INBOUND_EMAIL_RECEIVED"]}'
);
```

**Files to create:**
- `server/migrations/YYYYMMDDHHMMSS_register_system_email_workflow.cjs`

### 2.3 Inline Human Task Forms

**Task: Create inline forms for manual intervention (MVP)**

For MVP, use inline forms within the workflow rather than separate form definitions:

**Inline Forms for:**
- Client matching when exact email match fails
- Error handling and resolution
- Email processing overrides

**Implementation approach:**
- Define form schemas directly in workflow actions
- Use existing form validation patterns
- No separate form registry files needed for MVP

**Example inline form structure:**
```typescript
// Inline form definition within workflow action
const clientMatchingForm = {
  type: 'object',
  properties: {
    selectedCompanyId: { type: 'string', format: 'uuid' },
    createNewCompany: { type: 'boolean' },
    companyName: { type: 'string' }
  }
};
```

**Files to modify:**
- `shared/workflow/workflows/system-email-processing-workflow.ts` (include inline forms)

### 2.4 Simplified Email Client Matching

**Task: Implement exact email matching only (MVP)**

Create simplified service for exact email matching to existing clients:

**MVP Features:**
- Exact email address match lookup only
- Contact and company association
- No fuzzy matching (saved for future implementation)

**Matching Logic:**
1. Look up contact by exact email address
2. If contact found, get associated company
3. If not found, trigger inline human task form for manual selection
4. Store email-to-client association for future emails

**Files to create:**
- `server/src/services/email/EmailClientMatcher.ts` (simplified version)

## Phase 3: Google Gmail Integration

### 3.1 Gmail API Adapter

**Task: Implement Google Gmail adapter**

Create Gmail-specific implementation:

**Key differences from Microsoft:**
- Google OAuth2 flow
- Pub/Sub notification system
- Gmail API v1 endpoints
- Label management instead of folder monitoring

**Files to create:**
- `server/src/services/email/providers/GmailAdapter.ts`
- `server/src/utils/googleAuth.ts`
- `server/src/services/email/GooglePubSubHandler.ts`

### 3.2 Google Pub/Sub Integration

**Task: Set up Pub/Sub notification handling**

Implement Google's push notification system:

**Components:**
- Pub/Sub topic and subscription management
- Message acknowledgment handling
- Redis queue integration for reliable processing
- Individual workflow execution per email (no batching)
- Error handling and retry logic

**Files to create:**
- `server/src/services/email/pubsub/GmailPubSubService.ts`
- `server/src/pages/api/email/webhooks/google.ts` (already mentioned in Phase 1)

## Phase 4: Configuration UI

### 4.1 Email Provider Configuration Components

**Task: Create React components for provider setup**

Build UI for managing email providers using existing UI component standards:

**Components needed:**
- Provider list/management view using DataTable
- Microsoft Graph configuration form
- Gmail configuration form
- OAuth flow handling
- Test connection functionality

**Key implementation details:**
- Use components from `@/components/ui` folder (Button, Card, Dialog, Input, etc.)
- Follow Radix UI component patterns
- Implement proper ID naming with kebab-case (e.g., `email-provider-list`, `add-provider-button`)
- Use existing DataTable patterns for list views
- Follow tenant isolation standards

**Files to create:**
- `server/src/components/email/EmailProviderList.tsx`
- `server/src/components/email/EmailProviderForm.tsx`
- `server/src/components/email/EmailProviderDialog.tsx`
- `server/src/components/email/EmailProviderTestDialog.tsx`

### 4.2 Email Provider Auto-Wiring

**Task: Implement automatic workflow wiring/unwiring**

Create logic to automatically wire/unwire the system email workflow when providers are activated/deactivated:

**Features:**
- Auto-wire `INBOUND_EMAIL_RECEIVED` event to system workflow when provider is activated
- Auto-unwire events when provider is deactivated
- Follow QBO integration pattern for event attachment management

**Implementation Pattern:**
```typescript
// When email provider is connected
const eventWorkflowMap = {
  'INBOUND_EMAIL_RECEIVED': 'systemEmailProcessingWorkflow'
};

await createWorkflowEventAttachment({
  tenant: tenantId,
  event_type: 'INBOUND_EMAIL_RECEIVED',
  workflow_id: EMAIL_PROCESSING_WORKFLOW_ID, // System workflow ID
  is_active: true
});
```

**Files to modify:**
- `server/src/lib/actions/integrations/emailActions.ts` (add auto-wiring logic)

### 4.3 Server Actions and API Routes

**Task: Create server actions for email configuration**

Build server actions following the existing pattern in `/server/src/lib/actions`:

**Server actions needed:**
- Email provider CRUD operations
- Provider connection testing
- OAuth flow handling
- Workflow configuration management

**Key implementation details:**
- Use `getCurrentUser()` from `server/src/lib/actions/user-actions/userActions.ts`
- Follow tenant isolation with `createTenantKnex()` from `/server/src/lib/db/index.ts`
- Implement proper error handling and logging
- Use existing patterns from other action files

**Files to create:**
- `server/src/lib/actions/email-actions/emailProviderActions.ts`
- `server/src/lib/actions/email-actions/emailWorkflowActions.ts`
- `server/src/pages/api/email/oauth/microsoft/callback.ts` (OAuth callback API route)
- `server/src/pages/api/email/oauth/google/callback.ts` (OAuth callback API route)

## Phase 5: MVP Deployment

### 5.1 Basic Documentation

**Task: Create essential setup documentation**

Document the core setup requirements:
- Email provider OAuth configuration
- Environment variable setup
- Basic troubleshooting

**Files to create:**
- `docs/inbound-email/setup-guide.md` (basic setup only)

### 5.2 Future Implementation Items

**Deferred for post-MVP:**
- Comprehensive test coverage
- Monitoring and logging system  
- Performance testing
- Advanced troubleshooting guides
- Fuzzy client matching
- Workflow customization interfaces

## Development Guidelines

### Code Organization

```
server/src/
├── services/email/
│   ├── providers/
│   │   ├── base/
│   │   ├── MicrosoftGraphAdapter.ts
│   │   └── GmailAdapter.ts
│   ├── queue/
│   │   ├── EmailQueueService.ts
│   │   ├── EmailQueueConsumer.ts
│   │   └── EmailQueueProducer.ts
│   ├── EmailWebhookService.ts
│   ├── EmailClientMatcher.ts
│   └── EmailProcessor.ts
├── pages/api/email/
│   ├── webhooks/
│   │   ├── microsoft.ts
│   │   └── google.ts
│   └── oauth/
│       ├── microsoft/
│       │   └── callback.ts
│       └── google/
│           └── callback.ts
├── lib/actions/email-actions/
│   ├── emailProviderActions.ts
│   └── emailWorkflowActions.ts
├── components/email/
│   ├── EmailProviderList.tsx
│   ├── EmailProviderForm.tsx
│   ├── EmailProviderDialog.tsx
│   └── EmailProviderTestDialog.tsx
├── interfaces/
│   ├── emailProvider.interface.ts
│   └── email.interfaces.ts
└── utils/
    ├── microsoftGraph.ts
    └── googleAuth.ts

shared/workflow/
├── workflows/
│   └── inbound-email-workflow.ts
├── actions/email/
│   ├── processEmailAttachment.ts
│   └── createTicketFromEmail.ts
└── forms/email/
    ├── client-matching-form.ts
    └── email-error-handling-form.ts
```

### Development Standards

1. **Type Safety**: Use strict TypeScript types for all email interfaces following existing patterns
2. **Component Standards**: 
   - Use Radix UI components from `@/components/ui` folder
   - Follow kebab-case naming for component IDs (e.g., `add-email-provider-button`)
   - Implement proper action menus using DropdownMenu patterns
3. **Server Actions**: 
   - Use server actions in `/server/src/lib/actions` instead of REST APIs
   - Use `getCurrentUser()` for user context
   - Use `createTenantKnex()` for database connections
4. **Database Standards**:
   - Always include `tenant` in primary keys and WHERE clauses for CitusDB compatibility
   - Use `.cjs` extension for migrations
   - Run migrations with `--env migration` flag
   - Follow tenant isolation patterns
5. **Error Handling**: Implement comprehensive error handling with proper logging
6. **Security**: Follow OAuth2 best practices and secure credential storage
7. **Testing**: Maintain >90% test coverage for critical paths
8. **Performance**: Use Redis queues for reliable and efficient email processing
9. **Queue Management**: Implement proper retry logic and dead letter queues

### Following Existing Patterns

Before implementing new components, study these existing patterns in the codebase:

1. **Server Actions Pattern**: 
   - Study `server/src/lib/actions/billing-actions/` for CRUD operations
   - Follow the pattern in `server/src/lib/actions/user-actions/userActions.ts` for user context

2. **Component Patterns**:
   - Study `server/src/components/companies/` for list management components
   - Follow DataTable patterns from `server/src/components/billing-dashboard/`
   - Use Dialog patterns from existing forms

3. **Interface Patterns**:
   - Study existing interfaces in `server/src/interfaces/` folder
   - Follow naming conventions like `billing.interfaces.ts`

4. **Database Patterns**:
   - Study recent migrations for proper tenant handling
   - Look at `server/migrations/` for CitusDB-compatible patterns
   - Follow the RLS policy patterns from existing tables

5. **Event Bus Integration**:
   - Study `server/src/lib/eventBus/` for event definitions
   - Follow patterns from `server/src/lib/eventBus/events.ts`

**Example Server Action Pattern:**
```typescript
// server/src/lib/actions/email-actions/emailProviderActions.ts
'use server';

import { getCurrentUser } from '../user-actions/userActions';
import { createTenantKnex } from '../../db';

export async function createEmailProvider(data: EmailProviderConfig) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    // Always include tenant in queries
    const result = await knex('email_provider_configs')
      .insert({
        ...data,
        tenant,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      })
      .returning('*');
    
    return result[0];
  } finally {
    await knex.destroy();
  }
}
```

**Example Component Pattern:**
```typescript
// server/src/components/email/EmailProviderList.tsx
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { DataTable } from '@/components/ui/DataTable';
import { MoreVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/DropdownMenu';

export function EmailProviderList() {
  const [providers, setProviders] = useState([]);
  const [showAddDialog, setShowAddDialog] = useState(false);

  const columns = [
    {
      accessorKey: 'name',
      header: 'Provider Name',
    },
    {
      accessorKey: 'provider',
      header: 'Type',
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="email-provider-actions-menu"
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem id="edit-email-provider-menu-item">
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem 
              id="delete-email-provider-menu-item"
              className="text-red-600 focus:text-red-600"
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2>Email Providers</h2>
        <Button 
          id="add-email-provider-button"
          onClick={() => setShowAddDialog(true)}
        >
          Add Provider
        </Button>
      </div>
      
      <DataTable 
        id="email-providers-table"
        columns={columns} 
        data={providers} 
      />
      
      {showAddDialog && (
        <Dialog id="add-email-provider-dialog">
          {/* Dialog content */}
        </Dialog>
      )}
    </div>
  );
}
```

**Example Redis Queue Service Pattern:**
```typescript
// server/src/services/email/queue/EmailQueueService.ts
import { createClient } from 'redis';
import { getRedisConfig } from '@/config/redisConfig';

export interface EmailQueueJob {
  id: string;
  tenant: string;
  provider: 'microsoft' | 'google';
  messageId: string;
  providerId: string;
  webhookData: any;
  attempt: number;
  createdAt: string;
}

export class EmailQueueService {
  private redis;
  
  constructor() {
    this.redis = createClient(getRedisConfig());
  }

  async addEmailJob(job: Omit<EmailQueueJob, 'id' | 'attempt' | 'createdAt'>) {
    const emailJob: EmailQueueJob = {
      ...job,
      id: `email:${job.tenant}:${Date.now()}`,
      attempt: 0,
      createdAt: new Date().toISOString()
    };

    await this.redis.lPush('email:processing:queue', JSON.stringify(emailJob));
    console.log(`Added email job to queue: ${emailJob.id}`);
  }

  async processEmailQueue() {
    while (true) {
      try {
        const jobData = await this.redis.brPop('email:processing:queue', 5);
        if (jobData) {
          const job: EmailQueueJob = JSON.parse(jobData.element);
          await this.processEmailJob(job);
        }
      } catch (error) {
        console.error('Error processing email queue:', error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  private async processEmailJob(job: EmailQueueJob) {
    try {
      // Process the email using the appropriate provider adapter
      const emailProcessor = new EmailProcessor();
      await emailProcessor.processEmail(job);
      
      console.log(`Successfully processed email job: ${job.id}`);
    } catch (error) {
      console.error(`Failed to process email job ${job.id}:`, error);
      await this.handleFailedJob(job, error);
    }
  }

  private async handleFailedJob(job: EmailQueueJob, error: any) {
    job.attempt += 1;
    
    // Hardcoded retry policy for MVP (max 3 attempts)
    const MAX_RETRIES = 3;
    const BASE_DELAY = 2000; // 2 seconds base delay
    
    if (job.attempt <= MAX_RETRIES) {
      // Retry with exponential backoff: 2s, 4s, 8s
      const delay = BASE_DELAY * Math.pow(2, job.attempt - 1);
      setTimeout(async () => {
        await this.redis.lPush('email:processing:queue', JSON.stringify(job));
      }, delay);
    } else {
      // Move to dead letter queue after max retries
      await this.redis.lPush('email:failed:queue', JSON.stringify({
        ...job,
        failedAt: new Date().toISOString(),
        error: error.message,
        totalAttempts: job.attempt
      }));
    }
  }
}
```

### Configuration Management

Use environment variables for:
- OAuth client credentials
- Webhook endpoint URLs
- Redis queue configuration
- Timeout configurations

Example `.env` additions:
```
# Microsoft Graph
MICROSOFT_CLIENT_ID=your_client_id
MICROSOFT_CLIENT_SECRET=your_client_secret

# Gmail
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_PUBSUB_PROJECT_ID=your_project_id

# Email Service
EMAIL_WEBHOOK_BASE_URL=https://your-domain.com/api/email/webhooks
EMAIL_PROCESSING_TIMEOUT_MS=30000

# Redis Queue Configuration (using hardcoded values in MVP)
# EMAIL_QUEUE_NAME=email:processing:queue (hardcoded)
# EMAIL_FAILED_QUEUE_NAME=email:failed:queue (hardcoded)
# EMAIL_QUEUE_MAX_RETRIES=3 (hardcoded)
# EMAIL_QUEUE_RETRY_DELAY_MS=2000 (hardcoded)
```

## Testing Strategy

### Test Pyramid

1. **Unit Tests (70%)**
   - Provider adapter logic
   - Email parsing and transformation
   - Client matching algorithms
   - Redis queue service logic
   - Workflow action implementations

2. **Integration Tests (20%)**
   - Email provider API interactions
   - Database operations
   - Redis queue integration
   - Workflow execution end-to-end
   - Webhook processing

3. **E2E Tests (10%)**
   - Complete email-to-ticket flow
   - UI configuration workflows
   - OAuth authentication flows

### Mock Strategies

- Mock email provider APIs for consistent testing
- Use Redis test instance for queue testing
- Use test email accounts for integration testing
- Create webhook payload fixtures for various scenarios
- Mock workflow execution context for unit tests

### Performance Testing

- Load test webhook endpoints
- Test Redis queue performance under high volume
- Test email processing throughput
- Verify memory usage with large attachments
- Test OAuth token refresh under load
- Monitor queue depth and processing times

## Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] Database schema migration created and tested
- [ ] Email provider adapter interface defined
- [ ] Microsoft Graph adapter implemented
- [ ] Webhook infrastructure created
- [ ] Event system integration completed
- [ ] Basic end-to-end test passing

### Phase 2: Default Workflow
- [ ] Workflow definition implemented
- [ ] System workflow registration completed
- [ ] Human task forms created
- [ ] Email client matching service implemented
- [ ] Attachment processing working
- [ ] Error handling tested

### Phase 3: Google Gmail Integration
- [ ] Gmail adapter implemented
- [ ] Pub/Sub integration working
- [ ] Gmail-specific tests passing
- [ ] OAuth flow tested

### Phase 4: Configuration UI
- [ ] Provider configuration components created
- [ ] Workflow customization interface built
- [ ] API endpoints implemented
- [ ] UI integration tested

### Phase 5: Testing and Deployment
- [ ] Unit test suite completed (>90% coverage)
- [ ] Integration tests implemented
- [ ] Monitoring and logging added
- [ ] Documentation completed
- [ ] Security review passed
- [ ] Performance testing completed

## Success Criteria

The implementation is complete when:

1. **Functional Requirements Met**:
   - Emails are successfully converted to tickets
   - Both Microsoft and Gmail integrations work
   - Client matching functions correctly
   - Attachments are properly handled
   - Error scenarios are handled gracefully

2. **Non-Functional Requirements Met**:
   - System handles 1000+ emails/hour per tenant via Redis queues
   - 99.9% uptime for webhook endpoints
   - <5 second average processing time per email
   - Redis queue processes jobs reliably with <1% failure rate
   - Dead letter queue handles failed jobs appropriately
   - All security requirements satisfied
   - Comprehensive monitoring in place

3. **User Experience**:
   - Configuration UI is intuitive
   - OAuth flows work seamlessly
   - Error messages are helpful
   - Workflow customization is accessible

4. **Maintainability**:
   - Code follows project standards
   - Comprehensive test coverage
   - Documentation is complete
   - Monitoring provides actionable insights

This implementation guide provides a structured approach to building the inbound email workflow system. Follow the phases sequentially, and ensure each phase is fully tested before proceeding to the next.

## Integration Settings Patterns (Based on QBO Implementation)

### 1. **Settings Page Integration**

The email provider settings should be added to the existing settings page structure:

**Location**: Add to `server/src/components/settings/general/SettingsPage.tsx`

```typescript
// Add to the tabContent array
{
  label: "Email Providers",
  content: <EmailProviderSettings />,
}
```

**URL Structure**: Follow the existing pattern with `/msp/settings?tab=email-providers`

### 2. **Component Architecture Pattern**

Based on `QboIntegrationSettings.tsx`, the email provider component should:

**Key Features:**
- **Connection Status Display**: Show connected/disconnected/error states with proper icons
- **OAuth Redirect Handling**: Process URL parameters from OAuth callback
- **Action Buttons**: Connect/Disconnect based on current status  
- **Real-time Status Updates**: Fetch status after connection/disconnection actions
- **Error/Success Messaging**: Clear user feedback with Alert components
- **Conditional Rendering**: Show provider-specific configuration when connected

**State Management Pattern:**
```typescript
const [statusInfo, setStatusInfo] = useState<EmailConnectionStatus | null>(null);
const [isLoading, setIsLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
const [successMessage, setSuccessMessage] = useState<string | null>(null);
```

### 3. **OAuth Flow Implementation**

**Connect Route**: `/api/integrations/email/microsoft/connect`
- Generate CSRF token for security
- Create state parameter with `{ tenantId, csrf, provider }` encoded as base64url
- Redirect to Microsoft Graph OAuth authorization URL
- Use environment-configured redirect URI

**Callback Route**: `/api/integrations/email/microsoft/callback`
- Validate state parameter and CSRF token
- Exchange authorization code for tokens
- Store credentials using secret provider
- Create workflow event attachments for email processing
- Redirect to settings page with status

### 4. **Credential Storage Pattern**

Following the QBO multi-realm pattern, store email credentials as:

```typescript
// Secret name: 'email_provider_credentials'
{
  [provider_account_id]: {
    provider: 'microsoft' | 'google',
    accessToken: string,
    refreshToken: string,
    accessTokenExpiresAt: string, // ISO string
    refreshTokenExpiresAt: string, // ISO string
    mailbox: string,
    tenantId?: string, // For Microsoft Graph
    webhookSubscriptionId?: string
  }
}
```

### 5. **Server Actions Pattern**

Based on `qboActions.ts`, implement these actions:

```typescript
// server/src/lib/actions/integrations/emailActions.ts
export async function getEmailProviderStatus(provider: 'microsoft' | 'google'): Promise<EmailConnectionStatus>
export async function disconnectEmailProvider(provider: 'microsoft' | 'google'): Promise<{success: boolean, error?: string}>
export async function getEmailMessages(provider: 'microsoft' | 'google'): Promise<EmailMessage[]>
```

**Key Patterns:**
- Use `getCurrentUser()` for tenant context
- Use `createTenantKnex()` for database operations
- Store credentials with `ISecretProvider` using tenant-scoped secrets
- Implement automatic token refresh logic
- Handle multiple provider accounts per tenant

### 6. **Workflow Integration Pattern**

Following the QBO callback pattern, automatically create workflow event attachments:

```typescript
const eventWorkflowMap: Record<string, string> = {
  'INBOUND_EMAIL_RECEIVED': 'inboundEmailProcessingWorkflow',
  'EMAIL_PROVIDER_CONNECTED': 'emailSetupNotificationWorkflow',
};
```

**Implementation in OAuth Callback:**
1. Store credentials successfully
2. Look up system workflow registrations
3. Get event IDs from system event catalog
4. Create workflow event attachments using `createWorkflowEventAttachment`
5. Handle errors gracefully without failing the connection

### 7. **UI Component IDs and Accessibility**

Following the established ID naming pattern:

```typescript
// Component IDs (kebab-case)
id="email-provider-settings-card"
id="microsoft-connect-button" 
id="google-connect-button"
id="email-provider-disconnect-button"
id="email-provider-status-alert"
id="email-provider-actions-menu"
```

### 8. **Environment Configuration**

Add environment variables following the QBO pattern:

```bash
# Microsoft Graph
MICROSOFT_CLIENT_ID=your_client_id
MICROSOFT_CLIENT_SECRET=your_client_secret
MICROSOFT_REDIRECT_URI=http://localhost:3000/api/integrations/email/microsoft/callback

# Google Gmail
GOOGLE_CLIENT_ID=your_client_id  
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/integrations/email/google/callback

# App Configuration
APP_BASE_URL=http://localhost:3000
EMAIL_WEBHOOK_BASE_URL=https://your-domain.com/api/email/webhooks
```

This pattern provides a robust foundation that matches the established QBO integration architecture while adapting it for email provider management.