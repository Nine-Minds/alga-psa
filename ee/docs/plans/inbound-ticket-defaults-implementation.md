# Inbound Ticket Defaults Implementation Plan

## Table of Contents

1. [Problem Summary](#problem-summary)
2. [Solution Architecture](#solution-architecture)
3. [Implementation Phases](#implementation-phases)
   - [Phase 1: Database Schema](#phase-1-database-schema)
   - [Phase 2: Backend API Development](#phase-2-backend-api-development)
   - [Phase 3: Workflow Integration](#phase-3-workflow-integration)
   - [Phase 4: UI Components](#phase-4-ui-components)
4. [Database Schema Details](#database-schema-details)
5. [TypeScript Interfaces](#typescript-interfaces)
6. [File Changes Summary](#file-changes-summary)

## Problem Summary

The email-to-ticket workflow is failing with validation errors because required ticket fields (`channel_id`, `company_id`, `status_id`, `priority_id`, `entered_by`, etc.) are not being provided. The workflow receives email data but cannot create tickets without these mandatory database fields.

## Solution Architecture

Create a flexible `inbound_ticket_defaults` table with named default configurations that can be referenced by email providers. This design allows for reusable default configurations and enables future domain-based routing capabilities.

## Implementation Phases

### Phase 1: Database Schema

- [ ] Create `inbound_ticket_defaults` table migration
- [ ] Add reference column to `email_providers` table  
- [ ] Create default inbound ticket defaults seed data

### Phase 2: Backend API Development

- [ ] Create inbound ticket defaults actions (CRUD operations)
- [ ] Create ticket field options actions (for dropdowns)
- [ ] Update email provider actions to handle defaults reference
- [ ] Add TypeScript interfaces for new types
- [ ] Update TicketModel to allow null `entered_by` for system-generated tickets

### Phase 3: Workflow Integration

- [ ] Update `createTicketFromEmail()` to accept default field values
- [ ] Create helper function to resolve email provider's ticket defaults
- [ ] Update email processing workflow to retrieve and use defaults
- [ ] Validate workflow execution with configured defaults

### Phase 4: UI Components

- [ ] Create InboundTicketDefaultsManager component
- [ ] Create InboundTicketDefaultsForm component
- [ ] Update provider forms to select from existing defaults
- [ ] Integrate defaults management into EmailProviderConfiguration

## Database Schema Details

### New Table: `inbound_ticket_defaults`

```sql
CREATE TABLE inbound_ticket_defaults (
  id UUID NOT NULL,
  tenant UUID NOT NULL,
  short_name VARCHAR(100) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  description TEXT,
  defaults JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, tenant),
  FOREIGN KEY (tenant) REFERENCES tenants(tenant),
  UNIQUE (tenant, short_name)
);
```

### Email Providers Table Update

```sql
ALTER TABLE email_providers 
ADD COLUMN inbound_ticket_defaults_id UUID;
```

### Default JSON Structure

```json
{
  "channel_id": "uuid",
  "status_id": "uuid", 
  "priority_id": "uuid",
  "company_id": "uuid",
  "entered_by": null,
  "category_id": "uuid",
  "subcategory_id": "uuid",
  "location_id": "uuid"
}
```

## TypeScript Interfaces

```typescript
interface InboundTicketDefaults {
  id: string;
  tenant: string;
  short_name: string;
  display_name: string;
  description?: string;
  defaults: {
    channel_id: string;
    status_id: string;
    priority_id: string;
    company_id?: string;
    entered_by?: string | null;
    category_id?: string;
    subcategory_id?: string;
    location_id?: string;
  };
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface TicketFieldOptions {
  channels: Array<{ id: string; name: string; is_default: boolean }>;
  statuses: Array<{ id: string; name: string }>;
  priorities: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; parent_id?: string }>;
  users: Array<{ id: string; name: string; username: string }>;
}
```

## File Changes Summary

### New Files
- `/server/migrations/20250713002000_create_inbound_ticket_defaults_table.cjs`
- `/server/migrations/20250713002001_add_defaults_ref_to_email_providers.cjs`
- `/server/seeds/dev/005_default_inbound_ticket_defaults.cjs`
- `/server/src/lib/actions/email-actions/inboundTicketDefaultsActions.ts`
- `/server/src/lib/actions/email-actions/ticketFieldOptionsActions.ts`
- `/server/src/components/admin/InboundTicketDefaultsManager.tsx`
- `/server/src/components/forms/InboundTicketDefaultsForm.tsx`

### Modified Files
- `/server/src/lib/actions/email-actions/emailProviderActions.ts`
- `/server/src/components/EmailProviderConfiguration.tsx`
- `/server/src/components/MicrosoftProviderForm.tsx`
- `/server/src/components/GmailProviderForm.tsx`
- `/shared/workflow/actions/emailWorkflowActions.ts`
- `/shared/models/ticketModel.ts` - Update validation to allow null `entered_by`
- `/server/seeds/dev/004_email_processing_workflow_from_source.cjs`
- `/server/src/types/email.types.ts`

### Key Implementation Details

#### Database Migration Strategy
1. Create `inbound_ticket_defaults` table with tenant partitioning
2. Add foreign key reference from `email_providers`
3. Seed with default "email-general" configuration

#### Backend API Pattern
- Follow existing email actions pattern with tenant isolation
- Use consistent error handling and validation
- Return structured responses with proper TypeScript types
- Update TicketModel validation to allow `entered_by: null` for system tickets

#### Workflow Integration Points
- Resolve email provider → inbound ticket defaults in workflow
- Pass defaults as additional parameters to ticket creation
- Merge email data with configured defaults before validation

#### UI Component Architecture
- Reusable form components for ticket field selection
- Manager component for CRUD operations on defaults
- Integration into existing email provider configuration flow

#### System-Generated Ticket Handling
For tickets created from email processing, `entered_by` will be `null` to indicate system generation:
- Update TicketModel validation schema to allow `entered_by: null`
- Modify ticket creation logic to handle null `entered_by` gracefully
- UI components should display "System" when `entered_by` is null
- Audit logs should show system-generated entries appropriately

#### TicketModel Changes Required
```typescript
// Update validation to allow null for system tickets
entered_by: z.string().uuid().nullable().optional()

// In createTicket logic:
const auditUser = data.entered_by || 'system';
```

This implementation focuses strictly on solving the immediate validation issue while providing a solid foundation for the email-to-ticket workflow.