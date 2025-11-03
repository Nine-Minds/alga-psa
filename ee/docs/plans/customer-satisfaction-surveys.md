# Customer Satisfaction Survey System - Technical Implementation Plan

## Overview

### Current Status
- **Edition:** Community Edition (CE) feature available in all installations
- **Phase:** Phase 1 (Core Infrastructure) - In Progress
- **Completed:** Database schema, RLS policies, indexes, token service with tests
- **Next:** Server actions, event integration, email templates, UI components

### Goals
- Automate post-ticket CSAT feedback loops for MSP tenants inside Alga PSA.
- Centralize survey configuration, delivery, and analytics while maintaining tenant isolation.
- Reuse existing UI, email, and workflow foundations to minimize net-new surface area.

### Scope Snapshot
- **Touchpoints:** Database, server actions, event bus, email templates, UI surfaces (see Details for specs).
- **Edition:** Community Edition (CE) feature, available to all installations.
- **Standards:** Adhere to `docs/AI_coding_standards.md`, email templating conventions, and Citus multi-tenant rules.

### Phase Checklist
1. **Phase 1 – Core Infrastructure** (Details §Implementation Phases > Phase 1)
   - Database & Token Foundations  
     - Create migrations for templates/triggers/invitations/responses with tenant composite PKs and RLS (Details §Database Schema, §Migration Files).  
     - Add seed migration for default CSAT template with JSONB labels stored as strings (Details §Migration Files).  
     - Implement hashing + issuance helpers in `surveyTokenService` and validate against stored digests (Details §Token Service).
   - Backend Actions & Entry Points  
     - Build `surveyActions.ts` CRUD using `createTenantKnex`/`withTransaction` patterns (Details §Server Actions).  
     - Add public submission + validation actions that run under `runWithTenant` and update invitations atomically (Details §Server Actions).  
     - Register event subscriber that listens to ticket closure events and invokes `sendSurveyInvitation` (Details §Event Bus Integration).
   - Email Delivery & Workflow  
     - Register `SURVEY_TICKET_CLOSED` template variants (EN/FR/ES/DE/NL/IT) and document merge fields (Details §Email Integration).  
     - Implement invitation send pipeline that persists invites, queues Temporal workflow, and delegates to `TenantEmailService` (Details §Email Integration).  
     - Verify provider fallback + localization via unit tests under `server/src/lib/email/__tests__` (Details §Email Integration).
   - UI Components
     - Build survey settings tabs (templates/triggers) using `server/src/components/ui` components + translated copy (Details §UI Components > SurveySettings).
     - Ship public response page with i18n + accessibility IDs (Details §UI Components > SurveyResponsePage).
     - Add navigation integration to Settings menu (Details §UI Components > Navigation Integration).

2. **Phase 2 – Reporting & Analytics** (Details §Implementation Phases > Phase 2)
   - API Layer  
     - Implement stats + response listing endpoints with tenant-scoped filters and pagination (Details §API Implementation).  
     - Extend server actions to serve dashboard data and cache expensive aggregates where needed (Details §Server Actions > Response queries).
   - UI Surfaces  
     - Build dashboard cards/charts leveraging existing components and formatters (Details §UI Components > SurveyDashboard).  
     - Embed response summaries on ticket + company detail views (Details §Integration with Existing Modules).  
     - Ensure filters persist via query params for shareable links (Details §UI Components > ResponseList).
   - Observability & QA  
     - Add unit tests for CSAT calculations and trigger condition evaluation (Details §Testing Strategy).  
     - Extend manual checklist for analytics validation (Details §Testing Strategy > Manual).

3. **Phase 3 – Enhancements** (Details §Implementation Phases > Phase 3)
   - Alerting & Automation  
     - Emit `SURVEY_NEGATIVE_RESPONSE` events and hook into notification workflows (Details §Event Bus Integration > Negative Feedback).  
     - Optionally open follow-up tickets using existing automation patterns (Details §Implementation Phases > Phase 3).
   - Advanced Features  
     - Implement CSV export + bulk trigger management (Details §Implementation Phases > Phase 3).  
     - Add survey preview, response time analytics, and mobile/responsive polish (Details §UI Components).  
     - Harden duplicate suppression + token expiry monitoring (Details §Server Actions, §Token Service).

### Critical Dependencies & Risks
- Multi-tenant schema requirements and RLS enforcement (Details §Database Schema).
- Email localization, provider routing, and template fallbacks (Details §Email Integration; `server/src/lib/email/README.md`).
- Event bus + Temporal workflow coordination (Details §Event Bus Integration).
- Secure token issuance/storage practices (Details §Token Service).

### Reference Documents
- `docs/AI_coding_standards.md`
- `server/src/lib/email/README.md`
- `docs/email-i18n-implementation-summary.md`
- `docs/inbound-email/README.md`
- This plan’s Details section for implementation specifics.

---

## Details

### System Overview

This plan outlines the technical implementation of a customer satisfaction (CSAT) survey system for Alga PSA, targeting MSPs with 5-10 employees and 50-100 customers. The system will automatically send surveys after ticket closure, collect responses, and provide reporting capabilities.

### Technical Architecture

### Core Components

1. **Database Layer** - Survey configuration, responses, and templates
2. **Event Integration** - Hook into existing event bus for ticket lifecycle events
3. **Email Integration** - Leverage existing email notification system
4. **API Layer** - Survey response submission and management
5. **UI Components** - Survey configuration, response viewing, and reporting
6. **Token Service** - Secure, unique, time-limited survey response links

### Data Flow

```
Ticket Closed → Event Bus → Survey Event Subscriber →
Email Service (with survey link) → Customer clicks rating →
API validates token → Store response → Display in UI/Reports
```

### Database Schema

### New Tables

#### `survey_templates`
Tenant-scoped survey templates with customizable rating scales and text. All new tables include `tenant UUID NOT NULL` in a composite primary key, enforce a foreign key to `tenants(tenant)`, and scope unique constraints/indexes by tenant to satisfy Citus distribution rules.

```sql
CREATE TABLE survey_templates (
  template_id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant UUID NOT NULL,
  template_name VARCHAR(255) NOT NULL,
  is_default BOOLEAN DEFAULT false,
  rating_type VARCHAR(50) DEFAULT 'stars', -- 'stars', 'numbers', 'emojis'
  rating_scale INTEGER DEFAULT 5, -- 3, 5, or 10
  rating_labels JSONB DEFAULT '{}'::jsonb, -- {1: "Very Poor", 2: "Poor", ...}
  prompt_text TEXT DEFAULT 'How would you rate your support experience?',
  comment_prompt TEXT DEFAULT 'Additional comments (optional)',
  thank_you_text TEXT DEFAULT 'Thank you for your feedback!',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT survey_templates_pkey PRIMARY KEY (template_id, tenant),
  CONSTRAINT survey_templates_tenant_fk FOREIGN KEY (tenant) REFERENCES tenants(tenant),
  UNIQUE(tenant, template_name)
);

-- RLS policies
ALTER TABLE survey_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON survey_templates USING (tenant = current_setting('app.current_tenant')::uuid);
```

#### `survey_triggers`
Configuration for when surveys are sent (e.g., ticket closed, project completed).

```sql
CREATE TABLE survey_triggers (
  trigger_id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant UUID NOT NULL,
  template_id UUID NOT NULL,
  trigger_type VARCHAR(50) NOT NULL, -- 'ticket_closed', 'project_completed'
  trigger_conditions JSONB DEFAULT '{}'::jsonb, -- {board_id: [...], status_id: [...], priority: [...]}
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT survey_triggers_pkey PRIMARY KEY (trigger_id, tenant),
  CONSTRAINT survey_triggers_tenant_fk FOREIGN KEY (tenant) REFERENCES tenants(tenant),
  CONSTRAINT survey_triggers_template_fk FOREIGN KEY (template_id, tenant)
    REFERENCES survey_templates(template_id, tenant)
    ON DELETE CASCADE
);

-- RLS policies
ALTER TABLE survey_triggers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON survey_triggers USING (tenant = current_setting('app.current_tenant')::uuid);

-- Indexes
CREATE INDEX idx_survey_triggers_tenant_type ON survey_triggers(tenant, trigger_type) WHERE enabled = true;
CREATE INDEX idx_survey_triggers_template ON survey_triggers(tenant, template_id);
```

#### `survey_responses`
Stores individual survey responses linked to tickets. Hash the survey token before persisting so plain tokens never touch the database.

```sql
CREATE TABLE survey_responses (
  response_id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant UUID NOT NULL,
  ticket_id UUID NOT NULL,
  client_id UUID,
  contact_id UUID,
  template_id UUID NOT NULL,
  rating INTEGER NOT NULL, -- 1-5 (or based on scale)
  comment TEXT,
  survey_token_hash VARCHAR(255) NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  response_time_seconds INTEGER, -- Time from email sent to response
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT survey_responses_pkey PRIMARY KEY (response_id, tenant),
  CONSTRAINT survey_responses_tenant_fk FOREIGN KEY (tenant) REFERENCES tenants(tenant),
  CONSTRAINT survey_responses_template_fk FOREIGN KEY (template_id, tenant)
    REFERENCES survey_templates(template_id, tenant),
  CONSTRAINT survey_responses_ticket_fk FOREIGN KEY (ticket_id, tenant)
    REFERENCES tickets(ticket_id, tenant)
    ON DELETE CASCADE,
  CONSTRAINT survey_responses_client_fk FOREIGN KEY (tenant, client_id)
    REFERENCES clients(tenant, client_id),
  CONSTRAINT survey_responses_contact_fk FOREIGN KEY (tenant, contact_id)
    REFERENCES contacts(tenant, contact_name_id),
  UNIQUE (tenant, survey_token_hash)
);

-- RLS policies
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON survey_responses USING (tenant = current_setting('app.current_tenant')::uuid);

-- Indexes
CREATE INDEX idx_survey_responses_tenant_ticket ON survey_responses(tenant, ticket_id);
CREATE INDEX idx_survey_responses_tenant_client ON survey_responses(tenant, client_id);
CREATE INDEX idx_survey_responses_tenant_submitted ON survey_responses(tenant, submitted_at DESC);
CREATE INDEX idx_survey_responses_token ON survey_responses(tenant, survey_token_hash) WHERE submitted_at IS NULL;
CREATE INDEX idx_survey_responses_rating ON survey_responses(tenant, rating);
```

#### `survey_invitations`
Track sent survey invitations (for analytics and preventing duplicates). Persist only the hashed token digest; the plain token is emailed to the respondent.

```sql
CREATE TABLE survey_invitations (
  invitation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant UUID NOT NULL,
  ticket_id UUID NOT NULL,
  client_id UUID,
  contact_id UUID,
  template_id UUID NOT NULL,
  survey_token_hash VARCHAR(255) NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  opened_at TIMESTAMPTZ, -- Track email opens via pixel
  responded BOOLEAN DEFAULT false,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT survey_invitations_pkey PRIMARY KEY (invitation_id, tenant),
  CONSTRAINT survey_invitations_tenant_fk FOREIGN KEY (tenant) REFERENCES tenants(tenant),
  CONSTRAINT survey_invitations_template_fk FOREIGN KEY (template_id, tenant)
    REFERENCES survey_templates(template_id, tenant),
  CONSTRAINT survey_invitations_ticket_fk FOREIGN KEY (ticket_id, tenant)
    REFERENCES tickets(ticket_id, tenant)
    ON DELETE CASCADE,
  CONSTRAINT survey_invitations_client_fk FOREIGN KEY (tenant, client_id)
    REFERENCES clients(tenant, client_id),
  CONSTRAINT survey_invitations_contact_fk FOREIGN KEY (tenant, contact_id)
    REFERENCES contacts(tenant, contact_name_id),
  UNIQUE (tenant, survey_token_hash)
);

-- RLS policies
ALTER TABLE survey_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON survey_invitations USING (tenant = current_setting('app.current_tenant')::uuid);

-- Indexes
CREATE INDEX idx_survey_invitations_tenant_ticket ON survey_invitations(tenant, ticket_id);
CREATE INDEX idx_survey_invitations_token ON survey_invitations(tenant, survey_token_hash);
CREATE INDEX idx_survey_invitations_sent ON survey_invitations(tenant, sent_at DESC);
```

### API Implementation

### New API Routes

#### `POST /api/surveys/respond` (Public - Token-based)
Submit a survey response without authentication.

**Request:**
```typescript
{
  token: string;
  rating: number;
  comment?: string;
}
```

**Response:**
```typescript
{
  success: boolean;
  message: string;
  response_id?: string;
}
```

**Implementation:**
- Validate token exists and hasn't expired
- Verify no response already submitted for this token
- Store response in `survey_responses`
- Update `survey_invitations.responded = true`
- Trigger `survey.negative_response` event if rating <= 2
- Return success/error

#### `GET /api/surveys/templates`
List survey templates for current tenant.

**Response:**
```typescript
{
  templates: Array<{
    template_id: string;
    template_name: string;
    is_default: boolean;
    rating_type: string;
    rating_scale: number;
    enabled: boolean;
  }>
}
```

#### `POST /api/surveys/templates`
Create new survey template.

**Request:**
```typescript
{
  template_name: string;
  rating_type: 'stars' | 'numbers' | 'emojis';
  rating_scale: 3 | 5 | 10;
  rating_labels?: Record<number, string>;
  prompt_text?: string;
  comment_prompt?: string;
  thank_you_text?: string;
  is_default?: boolean;
}
```

#### `PUT /api/surveys/templates/:id`
Update existing survey template.

#### `GET /api/surveys/triggers`
List configured survey triggers.

#### `POST /api/surveys/triggers`
Create new survey trigger.

**Request:**
```typescript
{
  template_id: string;
  trigger_type: 'ticket_closed' | 'project_completed';
  trigger_conditions?: {
    board_id?: string[];
    status_id?: string[];
    priority?: string[];
  };
  enabled?: boolean;
}
```

#### `GET /api/surveys/responses`
List survey responses with filtering.

**Query Parameters:**
- `ticket_id` - Filter by ticket
- `company_id` - Filter by company
- `rating` - Filter by rating (e.g., `rating=1,2` for negative)
- `start_date`, `end_date` - Date range
- `limit`, `offset` - Pagination

**Response:**
```typescript
{
  responses: Array<{
    response_id: string;
    ticket_id: string;
    ticket_number: string;
    company_name: string;
    contact_name: string;
    rating: number;
    comment: string | null;
    submitted_at: string;
    assigned_to: string; // Technician name
  }>,
  total: number;
}
```

#### `GET /api/surveys/stats`
Get aggregate statistics for dashboard.

**Query Parameters:**
- `start_date`, `end_date` - Date range
- `company_id` - Filter by company
- `user_id` - Filter by technician

**Response:**
```typescript
{
  overall_csat: number; // Average rating
  total_responses: number;
  response_rate: number; // Percentage of invitations that got responses
  rating_distribution: Record<number, number>; // {1: 5, 2: 3, 3: 10, ...}
  trend: Array<{
    date: string;
    avg_rating: number;
    response_count: number;
  }>;
  by_technician: Array<{
    user_id: string;
    user_name: string;
    avg_rating: number;
    response_count: number;
  }>;
}
```

### Server Actions

### New Action Files

#### `server/src/lib/actions/surveyActions.ts`

```typescript
'use server';

import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { withTransaction } from '@shared/db';
import { createTenantKnex } from '@/lib/db';

// Template management
export async function getSurveyTemplates() {
  const { knex, tenant } = await createTenantKnex();
  return knex('survey_templates')
    .where('tenant', tenant)
    .orderBy('template_name');
}

export async function createSurveyTemplate(data: CreateTemplateInput) {
  await getCurrentUser(); // ensure requester is authenticated
  const { knex, tenant } = await createTenantKnex();

  return withTransaction(knex, async (trx) => {
    const [template] = await trx('survey_templates')
      .insert({
        tenant,
        template_name: data.template_name,
        rating_type: data.rating_type,
        rating_scale: data.rating_scale,
        rating_labels: JSON.stringify(data.rating_labels),
        prompt_text: data.prompt_text,
        comment_prompt: data.comment_prompt,
        thank_you_text: data.thank_you_text,
        enabled: data.enabled ?? true,
      })
      .returning('*');

    return template;
  });
}

export async function updateSurveyTemplate(id: string, data: UpdateTemplateInput) {
  await getCurrentUser();
  const { knex, tenant } = await createTenantKnex();

  return withTransaction(knex, async (trx) => {
    const updatePayload: Record<string, unknown> = {
      updated_at: trx.fn.now(),
    };

    if (typeof data.template_name === 'string') {
      updatePayload.template_name = data.template_name;
    }
    if (data.rating_type) {
      updatePayload.rating_type = data.rating_type;
    }
    if (data.rating_scale) {
      updatePayload.rating_scale = data.rating_scale;
    }
    if (data.rating_labels) {
      updatePayload.rating_labels = JSON.stringify(data.rating_labels);
    }
    if (data.prompt_text) {
      updatePayload.prompt_text = data.prompt_text;
    }
    if (data.comment_prompt) {
      updatePayload.comment_prompt = data.comment_prompt;
    }
    if (data.thank_you_text) {
      updatePayload.thank_you_text = data.thank_you_text;
    }
    if (typeof data.enabled === 'boolean') {
      updatePayload.enabled = data.enabled;
    }

    return trx('survey_templates')
      .where({ template_id: id, tenant })
      .update(updatePayload);
  });
}

export async function deleteSurveyTemplate(id: string) {
  await getCurrentUser();
  const { knex, tenant } = await createTenantKnex();
  await knex('survey_templates')
    .where({ template_id: id, tenant })
    .del();
}

// Trigger management mirrors the same createTenantKnex + withTransaction pattern
// Response queries filter by tenant and include tenant in all joins

// Token generation (internal)
async function generateSurveyToken(): Promise<string> {
  // Generate cryptographically secure random token
  // Format: base64url encoded (URL-safe)
}
```

#### `server/src/lib/actions/surveyResponseActions.ts`

```typescript
import { createTenantKnex, runWithTenant } from '@/lib/db';
import { withTransaction } from '@shared/db';
import { hashSurveyToken, resolveSurveyTenantFromToken } from '@/lib/actions/surveyTokenService';

// Public action - no auth required
export async function submitSurveyResponse(
  token: string,
  rating: number,
  comment?: string
) {
  const { tenant, invitation } = await resolveSurveyTenantFromToken(token);

  await runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex();

    await withTransaction(knex, async (trx) => {
      const [response] = await trx('survey_responses')
        .insert({
          tenant,
          template_id: invitation.templateId,
          ticket_id: invitation.ticketId,
          client_id: invitation.clientId,
          contact_id: invitation.contactId,
          rating,
          comment,
          survey_token_hash: hashSurveyToken(token),
          token_expires_at: invitation.tokenExpiresAt,
        })
        .returning('*');

      await trx('survey_invitations')
        .where({ tenant, invitation_id: invitation.invitationId })
        .update({
          responded: true,
          responded_at: trx.fn.now(),
        });

      // Trigger events after transaction commits
      return response;
    });
  });
}

export async function validateSurveyToken(token: string) {
  const { tenant } = await resolveSurveyTenantFromToken(token);

  return runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex();

    return knex('survey_invitations')
      .select([
        'survey_invitations.invitation_id',
        'survey_invitations.tenant',
        'survey_invitations.template_id',
        'survey_templates.prompt_text',
        'survey_templates.comment_prompt',
        'survey_templates.thank_you_text',
        'survey_templates.rating_type',
        'survey_templates.rating_scale',
        'survey_templates.rating_labels',
      ])
      .innerJoin('survey_templates', function joinTemplates() {
        this.on('survey_templates.template_id', '=', 'survey_invitations.template_id')
          .andOn('survey_templates.tenant', '=', 'survey_invitations.tenant');
      })
      .where('survey_invitations.survey_token', hashSurveyToken(token))
      .andWhere('survey_invitations.tenant', tenant)
      .first();
  });
}
```

#### `server/src/lib/actions/surveyTokenService.ts`

- `resolveSurveyTenantFromToken(token: string)` decodes the signed token payload, validates the HMAC, extracts the tenant identifier, and loads the invitation metadata in a single query (`survey_invitations` joined on `tenant`). Compare against the stored hashed token and fail fast with explicit `Error` messages when the token is missing, expired, or already used.
- `issueSurveyToken()` synchronously returns `{ plainToken, hashedToken }` where `plainToken` is a base64url string generated with `crypto.randomBytes(32)` and `hashedToken` is the SHA-256 digest.
- `hashSurveyToken(token: string)` returns a deterministic SHA-256 base64url digest used anywhere the token needs to be persisted.
- All helpers must call `runWithTenant(tenant)` before touching Knex so `createTenantKnex()` provides the correctly scoped connection.

```typescript
import { createHash, randomBytes } from 'crypto';

export function issueSurveyToken() {
  const plainToken = randomBytes(32).toString('base64url');
  return {
    plainToken,
    hashedToken: hashSurveyToken(plainToken),
  } as const;
}

export function hashSurveyToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('base64url');
}
```

### Event Bus Integration

### New Event Types

Add to `server/src/lib/eventBus/events.ts`:

```typescript
// Survey invitation event
export const SURVEY_INVITATION_SENT = 'survey.invitation.sent';
export const surveyInvitationSentSchema = z.object({
  tenant: z.string(),
  invitation_id: z.string(),
  ticket_id: z.string(),
  company_id: z.string(),
  contact_id: z.string(),
  survey_token_hash: z.string(),
});

// Survey response event
export const SURVEY_RESPONSE_SUBMITTED = 'survey.response.submitted';
export const surveyResponseSubmittedSchema = z.object({
  tenant: z.string(),
  response_id: z.string(),
  ticket_id: z.string(),
  company_id: z.string(),
  rating: z.number(),
  has_comment: z.boolean(),
});

// Negative feedback alert
export const SURVEY_NEGATIVE_RESPONSE = 'survey.negative_response';
export const surveyNegativeResponseSchema = z.object({
  tenant: z.string(),
  response_id: z.string(),
  ticket_id: z.string(),
  ticket_number: z.string(),
  company_id: z.string(),
  company_name: z.string(),
  contact_name: z.string(),
  rating: z.number(),
  comment: z.string().optional(),
  assigned_to: z.string(), // user_id of technician
});
```

### New Event Subscriber

#### `server/src/lib/eventBus/subscribers/surveySubscriber.ts`

```typescript
import { eventBus } from '../index';
import { TICKET_CLOSED } from '../events';
import { getSurveyTriggers } from '../../actions/surveyActions';
import { sendSurveyInvitation } from '../../../services/surveyService';

export function registerSurveySubscriber() {
  // Listen for ticket closed events
  eventBus.subscribe(TICKET_CLOSED, async (event) => {
    const { tenant, ticket_id, status_id, board_id, company_id, contact_id } = event;

    // Check if any triggers match
    const triggers = await getSurveyTriggers();
    const matchingTrigger = triggers.find(trigger => {
      if (!trigger.enabled) return false;
      if (trigger.trigger_type !== 'ticket_closed') return false;

      // Check conditions
      const conditions = trigger.trigger_conditions;
      if (conditions?.board_id && !conditions.board_id.includes(board_id)) return false;
      if (conditions?.status_id && !conditions.status_id.includes(status_id)) return false;

      return true;
    });

    if (matchingTrigger) {
      await sendSurveyInvitation({
        tenant,
        ticket_id,
        company_id,
        contact_id,
        template_id: matchingTrigger.template_id,
      });
    }
  });

  // Listen for negative survey responses
  eventBus.subscribe(SURVEY_NEGATIVE_RESPONSE, async (event) => {
    // Send alert to manager/technician
    // Optionally create follow-up ticket
    // Implementation in Phase 2
  });
}
```

Register in `server/src/lib/eventBus/index.ts`:

```typescript
import { registerSurveySubscriber } from './subscribers/surveySubscriber';

// In initialization
registerSurveySubscriber();
```

### Email Integration

### New Email Template

#### Template registration

- Add a `SURVEY_TICKET_CLOSED` row to `system_email_templates` (category `Surveys`, subtype `Ticket Closed`). Provide localized subject/body variants for the supported locales (EN, FR, ES, DE, NL, IT). Follow the existing handlebars-style placeholder naming (`{{tenant_name}}`, `{{ticket_number}}`, `{{survey_url}}`, etc.).
- Provide a default HTML version (with inline styles that match `/server/src/lib/email/templates`) and a text fallback. Keep the markup minimal, delegate iconography to Unicode stars, and embed the hidden reply token partial so threading still works.
- No tenant-specific copies are required at launch, but tenants should be able to override via `tenant_email_templates`; document the required merge tags so CS can assist tenants later.
- Confirm the template works with the default fallback chain (tenant locale → tenant en → system locale → system en) by adding tests under `server/src/lib/email/__tests__`.

Template recommendations:
- Above the fold summary: ticket number, subject, technician, closed time.
- Primary call-to-action: five star-style buttons (links to `https://{domain}/surveys/respond/{{survey_token}}?rating={{rating}}`).
- Secondary CTA: full survey link + short note about optional comments.
- Footer: branding partial + unsubscribe per existing transactional email policy.
- Reference `/docs/email-i18n-implementation-summary.md` for language key naming and `/server/src/lib/email/templates/partials` for reusable header/footer fragments.

### Survey Service

#### `server/src/services/surveyService.ts`

```typescript
import { TenantEmailService } from '@/lib/email/services/TenantEmailService';
import { issueSurveyToken } from '@/lib/actions/surveyTokenService';

export async function sendSurveyInvitation({...}) {
  // 1. Issue plain + hashed tokens (stored hashed)
  // 2. Persist invitation + invitation audit inside transaction
  // 3. Resolve ticket/contact metadata for template variables
  // 4. Delegate email send to TenantEmailService with template_code SURVEY_TICKET_CLOSED
  //    - Pass requested locale (contact preferred language → tenant default → en)
  //    - Provide merge fields: tenant_name, ticket_subject, technician_name, survey_url, rating_links[]
  // 5. Publish SURVEY_INVITATION_SENT after successful enqueue
}
```

Implementation notes:
- Use `TenantEmailService.sendTransactional` so the existing provider auto-selection, language fallback, and rate limiting are preserved.
- Build rating links in code (array of `{ rating: number, url: string }`) and let the template iterate with partials if needed; keep HTML generation out of the plan.
- Queue sends through the existing Temporal workflow used by other ticket notifications (follow the pattern in `ticketNotificationService`).
- `getTicketDetailsForSurvey` and `getSurveyTemplate` remain thin data access helpers that filter by tenant and run inside the transaction that logs invitations.
- Document the merge fields and translation keys in Confluence so future tenant-specific overrides stay aligned with the system templates.
- Keep this plan at the integration level—actual email/provider plumbing continues to live inside `/server/src/lib/email/services`, and we reuse that infrastructure rather than reinventing it here.

### UI Components

### Directory Structure

```
server/src/components/
  surveys/
    SurveySettings.tsx          # Main settings page (templates + triggers)
    templates/
      TemplateList.tsx          # List all templates
      TemplateForm.tsx          # Create/edit template
      TemplatePreview.tsx       # Preview survey appearance
    triggers/
      TriggerList.tsx           # List all triggers
      TriggerForm.tsx           # Create/edit trigger
    responses/
      ResponseList.tsx          # List all responses
      ResponseDetail.tsx        # Individual response view
      ResponseFilters.tsx       # Filter controls
    dashboard/
      SurveyDashboard.tsx       # Main reporting dashboard
      CSATMetric.tsx            # Overall CSAT score display
      RatingDistribution.tsx    # Chart showing rating breakdown
      TrendChart.tsx            # Time series of CSAT
      TechnicianLeaderboard.tsx # Performance by technician
    public/
      SurveyResponsePage.tsx    # Public survey submission page
```

### Key Components

#### `SurveySettings.tsx`
Main settings page accessible from Settings menu.

All buttons, inputs, selects, and tabs receive stable kebab-case `id` attributes so the reflection system can target them (e.g., `survey-settings-tabs`, `survey-response-submit-button`). Reuse the existing UI primitives from `server/src/components/ui` (`Card`, `Button`, `CustomTabs`, etc.) to remain consistent with design standards.

```typescript
'use client';

import { useTranslation } from '@/lib/i18n/client';
import { Card } from '@/components/ui/Card';
import { CustomTabs } from '@/components/ui/CustomTabs';
import { TemplateList } from './templates/TemplateList';
import { TriggerList } from './triggers/TriggerList';

export default function SurveySettings() {
  const { t } = useTranslation('common');

  return (
    <Card className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 id="survey-settings-heading" className="text-2xl font-semibold tracking-tight">
          {t('surveys.settings.title')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('surveys.settings.subtitle')}
        </p>
      </header>

      <CustomTabs
        id="survey-settings-tabs"
        defaultValue="templates"
        tabs={[
          {
            id: 'survey-template-tab',
            value: 'templates',
            label: t('surveys.settings.tabs.templates'),
            content: (
              <section id="survey-template-panel">
                <TemplateList />
              </section>
            ),
          },
          {
            id: 'survey-trigger-tab',
            value: 'triggers',
            label: t('surveys.settings.tabs.triggers'),
            content: (
              <section id="survey-trigger-panel">
                <TriggerList />
              </section>
            ),
          },
        ]}
      />
    </Card>
  );
}
```

#### `SurveyDashboard.tsx`
Main reporting dashboard (could be standalone page or integrated into existing Reports section).

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useTranslation, useFormatters } from '@/lib/i18n/client';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { getSurveyStats } from '@/lib/actions/surveyActions';
import { CSATMetric } from './CSATMetric';
import { RatingDistribution } from './RatingDistribution';
import { TrendChart } from './TrendChart';
import { ResponseList } from '../responses/ResponseList';
import { TechnicianLeaderboard } from './TechnicianLeaderboard';

export default function SurveyDashboard() {
  const { t } = useTranslation('common');
  const { formatNumber, formatPercent } = useFormatters();
  const [stats, setStats] = useState<SurveyStats | null>(null);
  const [filters, setFilters] = useState<SurveyFilters>({
    start_date: last30Days(),
    end_date: today(),
    company_id: 'all',
    technician_id: 'all',
  });

  useEffect(() => {
    void loadStats();
  }, [filters]);

  async function loadStats() {
    const data = await getSurveyStats(filters);
    setStats(data);
  }

  return (
    <section className="space-y-6" aria-live="polite">
      <header className="space-y-1">
        <h1 id="survey-dashboard-heading" className="text-2xl font-semibold tracking-tight">
          {t('surveys.dashboard.title')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('surveys.dashboard.subtitle')}
        </p>
      </header>

      <Card className="p-4" aria-labelledby="survey-dashboard-filters-heading">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <DateRangePicker
            id="survey-dashboard-date-range"
            value={{ start: filters.start_date, end: filters.end_date }}
            onChange={(range) =>
              setFilters((prev) => ({
                ...prev,
                start_date: range.start,
                end_date: range.end,
              }))
            }
            label={t('surveys.dashboard.filters.dateRange')}
          />

          <CustomSelect
            id="survey-dashboard-company-filter"
            label={t('surveys.dashboard.filters.company')}
            value={filters.company_id}
            onValueChange={(companyId) =>
              setFilters((prev) => ({ ...prev, company_id: companyId }))
            }
            options={companyOptions}
          />

          <CustomSelect
            id="survey-dashboard-technician-filter"
            label={t('surveys.dashboard.filters.technician')}
            value={filters.technician_id}
            onValueChange={(technicianId) =>
              setFilters((prev) => ({ ...prev, technician_id: technicianId }))
            }
            options={technicianOptions}
          />

          <Button
            id="survey-dashboard-refresh-button"
            variant="secondary"
            onClick={() => void loadStats()}
          >
            {t('actions.refresh')}
          </Button>
        </div>
      </Card>

      <section
        id="survey-dashboard-summary"
        className="grid gap-4 md:grid-cols-3"
        aria-labelledby="survey-dashboard-summary-heading"
      >
        <Card className="p-4">
          <h2 id="survey-dashboard-summary-heading" className="text-sm font-medium text-muted-foreground">
            {t('surveys.dashboard.summary.title')}
          </h2>
          <CSATMetric id="survey-dashboard-csat" value={stats?.overall_csat ?? 0} />
        </Card>

        <MetricCard
          id="survey-dashboard-total-responses"
          label={t('surveys.dashboard.summary.totalResponses')}
          value={formatNumber(stats?.total_responses ?? 0)}
        />

        <MetricCard
          id="survey-dashboard-response-rate"
          label={t('surveys.dashboard.summary.responseRate')}
          value={formatPercent((stats?.response_rate ?? 0) / 100)}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <RatingDistribution
          id="survey-dashboard-rating-distribution"
          data={stats?.rating_distribution ?? {}}
        />
        <TrendChart
          id="survey-dashboard-trend-chart"
          data={stats?.trend ?? []}
        />
      </section>

      <TechnicianLeaderboard
        id="survey-dashboard-technician-leaderboard"
        data={stats?.by_technician ?? []}
      />

      <ResponseList
        id="survey-dashboard-response-list"
        filters={filters}
      />
    </section>
  );
}
```

`companyOptions` and `technicianOptions` come from tenant-scoped queries (via server actions) and must include an initial `all` option so the filter IDs remain stable for the reflection system. Ensure each option object supplies a unique `id` field to power `CustomSelect`.

#### `SurveyResponsePage.tsx`
Public page for survey submission (no authentication).

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/client';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Label';
import { TextArea } from '@/components/ui/TextArea';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
import { validateSurveyToken, submitSurveyResponse } from '@/lib/actions/surveyResponseActions';

export default function SurveyResponsePage() {
  const { t } = useTranslation('clientPortal');
  const params = useParams<{ token: string }>();
  const [isLoading, setIsLoading] = useState(true);
  const [survey, setSurvey] = useState<SurveyInvitationView | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadSurvey();
  }, [params.token]);

  async function loadSurvey() {
    setIsLoading(true);
    setError(null);

    try {
      const data = await validateSurveyToken(params.token);
      if (!data) {
        setError(t('surveys.response.errors.invalidToken'));
        return;
      }

      setSurvey(data);
    } catch (err) {
      setError(t('surveys.response.errors.generic'));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit() {
    if (!rating || !survey) {
      return;
    }

    await submitSurveyResponse(params.token, rating, comment.trim());
    setSubmitted(true);
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center" aria-busy="true">
        <LoadingIndicator
          id="survey-response-loading-indicator"
          layout="stacked"
          text={t('surveys.response.loading')}
        />
      </div>
    );
  }

  if (submitted) {
    return (
      <ThankYouMessage
        id="survey-response-thank-you"
        text={survey?.thank_you_text ?? t('surveys.response.thankYouFallback')}
      />
    );
  }

  if (error) {
    return (
      <Card className="mx-auto max-w-2xl p-6 text-center" role="alert" id="survey-response-error">
        <p className="text-sm text-destructive">{error}</p>
        <Button
          id="survey-response-retry-button"
          className="mt-4"
          variant="secondary"
          onClick={() => void loadSurvey()}
        >
          {t('actions.retry')}
        </Button>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 id="survey-response-heading" className="text-2xl font-semibold tracking-tight">
          {survey?.prompt_text}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('surveys.response.subtitle', { company: survey?.company_name })}
        </p>
      </header>

      <TicketSummary id="survey-response-ticket-summary" ticket={survey?.ticket} />

      <RatingSelector
        id="survey-response-rating-selector"
        type={survey?.rating_type}
        scale={survey?.rating_scale}
        labels={survey?.rating_labels}
        value={rating}
        onChange={setRating}
      />

      <div className="space-y-2">
        <Label htmlFor="survey-response-comment-field">
          {survey?.comment_prompt}
        </Label>
        <TextArea
          id="survey-response-comment-field"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={4}
        />
      </div>

      <Button
        id="survey-response-submit-button"
        onClick={() => void handleSubmit()}
        disabled={!rating}
      >
        {t('surveys.response.submit')}
      </Button>
    </Card>
  );
}
```

### Navigation Integration

Add to Settings menu:
```typescript
// In settings navigation
{
  id: 'settings-surveys-nav-item',
  label: t('navigation.settings.surveys'),
  href: '/msp/settings/surveys',
  icon: MessageSquareIcon,
}
```

### Localization Requirements

Add the following keys to `server/public/locales/{locale}/common.json`:

- `navigation.settings.surveys`
- `navigation.primary.surveys`
- `surveys.settings.title`
- `surveys.settings.subtitle`
- `surveys.settings.tabs.templates`
- `surveys.settings.tabs.triggers`
- `surveys.dashboard.title`
- `surveys.dashboard.subtitle`
- `surveys.dashboard.filters.dateRange`
- `surveys.dashboard.filters.company`
- `surveys.dashboard.filters.technician`
- `surveys.dashboard.summary.title`
- `surveys.dashboard.summary.totalResponses`
- `surveys.dashboard.summary.responseRate`
- `actions.refresh` (reuse existing key if it already exists)
- `actions.retry` (reuse existing key if it already exists)

Add the following keys to `server/public/locales/{locale}/clientPortal.json` for the public survey form:

- `surveys.response.loading`
- `surveys.response.errors.invalidToken`
- `surveys.response.errors.generic`
- `surveys.response.subtitle`
- `surveys.response.thankYouFallback`
- `surveys.response.submit`

Add to main navigation (optional - could just be in Reports):
```typescript
// In main navigation
{
  id: 'primary-surveys-nav-item',
  label: t('navigation.primary.surveys'),
  href: '/msp/surveys',
  icon: StarIcon,
}
```

### Integration with Existing Modules

### Ticket Detail Page

Add survey response display to ticket detail view:

```typescript
// In TicketDetail.tsx
import { SurveyResponseCard } from '@/components/surveys/SurveyResponseCard';

// In ticket detail
{ticket.survey_response && (
  <SurveyResponseCard response={ticket.survey_response} />
)}
```

### Company View

Show aggregate CSAT score on company detail page:

```typescript
// In CompanyDetail.tsx
import { CompanyCSATSummary } from '@/components/surveys/CompanyCSATSummary';

<CompanyCSATSummary company_id={company.company_id} />
```

### Migration Files

### Phase 1 Migrations

#### `server/migrations/YYYYMMDDHHMMSS_create_survey_tables.cjs`

```javascript
exports.up = async function up(knex) {
  await knex.schema.createTable('survey_templates', (table) => {
    table.uuid('template_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();
    table.string('template_name').notNullable();
    table.boolean('is_default').notNullable().defaultTo(false);
    table.string('rating_type', 50).notNullable().defaultTo('stars');
    table.integer('rating_scale').notNullable().defaultTo(5);
    table.jsonb('rating_labels').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.text('prompt_text').notNullable().defaultTo('How would you rate your support experience?');
    table.text('comment_prompt').notNullable().defaultTo('Additional comments (optional)');
    table.text('thank_you_text').notNullable().defaultTo('Thank you for your feedback!');
    table.boolean('enabled').notNullable().defaultTo(true);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['template_id', 'tenant']);
    table
      .foreign('tenant')
      .references('tenant')
      .inTable('tenants');
    table.unique(['tenant', 'template_name']);
  });

  await knex.schema.createTable('survey_triggers', (table) => {
    table.uuid('trigger_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();
    table.uuid('template_id').notNullable();
    table.string('trigger_type', 50).notNullable();
    table.jsonb('trigger_conditions').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.boolean('enabled').notNullable().defaultTo(true);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['trigger_id', 'tenant']);
    table
      .foreign(['template_id', 'tenant'])
      .references(['template_id', 'tenant'])
      .inTable('survey_templates')
      .onDelete('CASCADE');
  });

  await knex.schema.createTable('survey_invitations', (table) => {
    table.uuid('invitation_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();
    table.uuid('ticket_id').notNullable();
    table.uuid('client_id');
    table.uuid('contact_id');
    table.uuid('template_id').notNullable();
    table.string('survey_token_hash', 255).notNullable();
    table.timestamp('token_expires_at', { useTz: true }).notNullable();
    table.timestamp('sent_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('opened_at', { useTz: true });
    table.boolean('responded').notNullable().defaultTo(false);
    table.timestamp('responded_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['invitation_id', 'tenant']);
    table.unique(['tenant', 'survey_token_hash']);
    table
      .foreign(['template_id', 'tenant'])
      .references(['template_id', 'tenant'])
      .inTable('survey_templates');
    table
      .foreign(['ticket_id', 'tenant'])
      .references(['ticket_id', 'tenant'])
      .inTable('tickets')
      .onDelete('CASCADE');
    table
      .foreign(['tenant', 'client_id'])
      .references(['tenant', 'client_id'])
      .inTable('clients');
    table
      .foreign(['tenant', 'contact_id'])
      .references(['tenant', 'contact_name_id'])
      .inTable('contacts');
  });

  await knex.schema.createTable('survey_responses', (table) => {
    table.uuid('response_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();
    table.uuid('ticket_id').notNullable();
    table.uuid('client_id');
    table.uuid('contact_id');
    table.uuid('template_id').notNullable();
    table.integer('rating').notNullable();
    table.text('comment');
    table.string('survey_token_hash', 255).notNullable();
    table.timestamp('token_expires_at', { useTz: true }).notNullable();
    table.timestamp('submitted_at', { useTz: true }).defaultTo(knex.fn.now());
    table.integer('response_time_seconds');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['response_id', 'tenant']);
    table.unique(['tenant', 'survey_token_hash']);
    table
      .foreign(['template_id', 'tenant'])
      .references(['template_id', 'tenant'])
      .inTable('survey_templates');
    table
      .foreign(['ticket_id', 'tenant'])
      .references(['ticket_id', 'tenant'])
      .inTable('tickets')
      .onDelete('CASCADE');
    table
      .foreign(['tenant', 'client_id'])
      .references(['tenant', 'client_id'])
      .inTable('clients');
    table
      .foreign(['tenant', 'contact_id'])
      .references(['tenant', 'contact_name_id'])
      .inTable('contacts');
  });

  await knex.raw(`
    ALTER TABLE survey_templates ENABLE ROW LEVEL SECURITY;
    ALTER TABLE survey_triggers ENABLE ROW LEVEL SECURITY;
    ALTER TABLE survey_invitations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    CREATE POLICY tenant_isolation ON survey_templates USING (tenant = current_setting('app.current_tenant')::uuid);
    CREATE POLICY tenant_isolation ON survey_triggers USING (tenant = current_setting('app.current_tenant')::uuid);
    CREATE POLICY tenant_isolation ON survey_invitations USING (tenant = current_setting('app.current_tenant')::uuid);
    CREATE POLICY tenant_isolation ON survey_responses USING (tenant = current_setting('app.current_tenant')::uuid);
  `);

  await knex.raw(`
    CREATE INDEX idx_survey_triggers_tenant_type
    ON survey_triggers (tenant, trigger_type)
    WHERE enabled = true;
  `);
  await knex.raw(`
    CREATE INDEX idx_survey_triggers_template
    ON survey_triggers (tenant, template_id);
  `);

  await knex.raw(`
    CREATE INDEX idx_survey_invitations_tenant_ticket
    ON survey_invitations (tenant, ticket_id);
  `);
  await knex.raw(`
    CREATE INDEX idx_survey_invitations_token
    ON survey_invitations (tenant, survey_token_hash);
  `);
  await knex.raw(`
    CREATE INDEX idx_survey_invitations_sent
    ON survey_invitations (tenant, sent_at);
  `);

  await knex.raw(`
    CREATE INDEX idx_survey_responses_tenant_ticket
    ON survey_responses (tenant, ticket_id);
  `);
  await knex.raw(`
    CREATE INDEX idx_survey_responses_tenant_client
    ON survey_responses (tenant, client_id);
  `);
  await knex.raw(`
    CREATE INDEX idx_survey_responses_tenant_submitted
    ON survey_responses (tenant, submitted_at);
  `);
  await knex.raw(`
    CREATE INDEX idx_survey_responses_token
    ON survey_responses (tenant, survey_token_hash)
    WHERE submitted_at IS NULL;
  `);
  await knex.raw(`
    CREATE INDEX idx_survey_responses_rating
    ON survey_responses (tenant, rating);
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('survey_responses');
  await knex.schema.dropTableIfExists('survey_invitations');
  await knex.schema.dropTableIfExists('survey_triggers');
  await knex.schema.dropTableIfExists('survey_templates');
};
```

#### `server/migrations/YYYYMMDDHHMMSS_add_default_survey_template.cjs`

```javascript
exports.up = async function(knex) {
  // Insert default survey template for each existing tenant
  const tenants = await knex('tenants').select('tenant');

  for (const { tenant } of tenants) {
    await knex('survey_templates').insert({
      tenant,
      template_name: 'Default CSAT Survey',
      is_default: true,
      rating_type: 'stars',
      rating_scale: 5,
      rating_labels: JSON.stringify({
        1: 'Very Poor',
        2: 'Poor',
        3: 'Okay',
        4: 'Good',
        5: 'Excellent',
      }),
      prompt_text: 'How would you rate your support experience?',
      comment_prompt: 'Additional comments (optional)',
      thank_you_text: 'Thank you for your feedback!',
      enabled: true,
    });
  }
};
```

#### `server/migrations/YYYYMMDDHHMMSS_add_survey_email_template.cjs`

```javascript
exports.up = function(knex) {
  return knex('system_email_templates').insert({
    template_code: 'SURVEY_TICKET_CLOSED',
    category: 'Surveys',
    subtype: 'Ticket Closed',
    name: 'Customer Satisfaction Survey - Ticket Closed',
    description: 'Survey sent to customer after ticket is closed',
    subject_template: 'How was your support experience? (Ticket #{{ticket_number}})',
    html_template: `<!-- Full HTML template -->`,
    text_template: `<!-- Plain text version -->`,
  });
};
```

### TypeScript Types & Interfaces

### `server/src/types/survey.ts`

```typescript
export type RatingType = 'stars' | 'numbers' | 'emojis';
export type RatingScale = 3 | 5 | 10;
export type TriggerType = 'ticket_closed' | 'project_completed';

export interface SurveyTemplate {
  template_id: string;
  tenant: string;
  template_name: string;
  is_default: boolean;
  rating_type: RatingType;
  rating_scale: RatingScale;
  rating_labels: Record<number, string>;
  prompt_text: string;
  comment_prompt: string;
  thank_you_text: string;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface SurveyTrigger {
  trigger_id: string;
  tenant: string;
  template_id: string;
  trigger_type: TriggerType;
  trigger_conditions?: {
    board_id?: string[];
    status_id?: string[];
    priority?: string[];
  };
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface SurveyInvitation {
  invitation_id: string;
  tenant: string;
  ticket_id: string;
  company_id: string;
  contact_id: string;
  template_id: string;
  survey_token: string; // hashed digest
  token_expires_at: Date;
  sent_at: Date;
  opened_at?: Date;
  responded: boolean;
  responded_at?: Date;
  created_at: Date;
}

export interface SurveyResponse {
  response_id: string;
  tenant: string;
  ticket_id: string;
  company_id: string;
  contact_id: string;
  template_id: string;
  rating: number;
  comment?: string;
  survey_token: string; // hashed digest
  token_expires_at: Date;
  submitted_at: Date;
  response_time_seconds?: number;
  created_at: Date;
}

export interface SurveyStats {
  overall_csat: number;
  total_responses: number;
  response_rate: number;
  rating_distribution: Record<number, number>;
  trend: Array<{
    date: string;
    avg_rating: number;
    response_count: number;
  }>;
  by_technician: Array<{
    user_id: string;
    user_name: string;
    avg_rating: number;
    response_count: number;
  }>;
}

export interface ResponseFilters {
  ticket_id?: string;
  company_id?: string;
  rating?: number[];
  start_date?: Date;
  end_date?: Date;
  limit?: number;
  offset?: number;
}

export interface StatsFilters {
  start_date?: Date;
  end_date?: Date;
  company_id?: string;
  user_id?: string;
}
```

### Implementation Phases

### Phase 1: Core Infrastructure (MVP)
**Estimated: 3-5 days**
**Status: In Progress** (Database & Token Service ✅ Complete; Server Actions, Services, UI, Email pending)

1. **Database Setup** ✅ COMPLETE
   - [x] Create migration files for all tables with proper tenant isolation
   - [x] Add RLS policies (note: currently disabled via migration `20251201093000_disable_rls_on_survey_tables.cjs`)
   - [x] Create indexes for efficient querying
   - [x] Add foreign keys with Citus multi-tenancy rules

2. **Token Service** ✅ COMPLETE
   - [x] Implement `surveyTokenService.ts` with secure token generation and validation
   - [x] Unit tests for token hashing and issuance
   - [x] Integration tests with real database

3. **Server Actions** 🔄 IN PROGRESS
   - [ ] Implement `surveyActions.ts` (CRUD for templates/triggers via server actions)
   - [ ] Implement `surveyResponseActions.ts` (public response submission via server action)
   - [x] Add event types to `events.ts` (SURVEY_INVITATION_SENT, SURVEY_RESPONSE_SUBMITTED, SURVEY_NEGATIVE_RESPONSE)

4. **Services & Integration** ⏳ PENDING
   - [ ] Create `surveyService.ts` (email sending logic via server action)
   - [ ] Create `surveySubscriber.ts` (listen to ticket closure events)
   - [ ] Register subscriber in event bus initialization

5. **Email Integration** ⏳ PENDING
   - [ ] Register `SURVEY_TICKET_CLOSED` template in `system_email_templates`
   - [ ] Design HTML email template with rating buttons
   - [ ] Implement token-based one-click rating links
   - [ ] Add email provider tests for localization and fallbacks

6. **UI Components** ⏳ PENDING
   - [ ] Build `SurveySettings.tsx` (templates + triggers management)
   - [ ] Build `TemplateList.tsx` + `TemplateForm.tsx`
   - [ ] Build `TriggerList.tsx` + `TriggerForm.tsx`
   - [ ] Build `SurveyResponsePage.tsx` (public survey page)
   - [ ] Add navigation integration to Settings menu

7. **API Routes** ⏳ PENDING (optional for external integrations)
   - [ ] `POST /api/surveys/respond` (public, wraps surveyResponseActions)
   - [ ] `GET /api/surveys/templates` (wraps surveyActions)
   - [ ] `POST /api/surveys/templates` (wraps surveyActions)
   - [ ] `GET /api/surveys/triggers` (wraps surveyActions)
   - [ ] `POST /api/surveys/triggers` (wraps surveyActions)

**Deliverables:**
- Surveys can be configured to trigger on ticket closure
- Customers receive email with one-click rating
- Responses are stored in database
- Admin UI to manage templates and triggers

### Phase 2: Reporting & Analytics
**Estimated: 2-3 days**

1. **API Routes**
   - `GET /api/surveys/responses` (with filtering)
   - `GET /api/surveys/stats` (aggregated metrics)

2. **Dashboard Components**
   - `SurveyDashboard.tsx` (main reporting page)
   - `CSATMetric.tsx` (overall score display)
   - `RatingDistribution.tsx` (chart)
   - `TrendChart.tsx` (time series)
   - `TechnicianLeaderboard.tsx` (performance breakdown)
   - `ResponseList.tsx` (detailed response list)

3. **Integrations**
   - Add survey response card to ticket detail page
   - Add CSAT summary to company detail page

**Deliverables:**
- Comprehensive survey dashboard
- Filter responses by date, company, technician
- View CSAT trends over time
- See performance by technician

### Phase 3: Enhancements
**Estimated: 2-3 days**

1. **Negative Feedback Alerts**
   - Subscribe to `SURVEY_NEGATIVE_RESPONSE` event
   - Send notification to technician and manager
   - Optionally create follow-up ticket

2. **Advanced Features**
   - Export responses to CSV
   - Email template customization per tenant
   - Survey response tracking (email opens)
   - Prevent duplicate surveys for same ticket

3. **Polish**
   - Survey preview in template editor
   - Bulk trigger configuration
   - Response time analytics
   - Mobile-responsive survey page

**Deliverables:**
- Proactive alerts on negative feedback
- Export capabilities
- Enhanced reporting features

### Testing Strategy

### Unit Tests
- Token generation and validation
- Survey trigger condition matching
- CSAT calculation logic
- Email template rendering

### Integration Tests
- End-to-end survey flow (trigger → email → response → storage)
- Event bus integration (ticket closed → survey sent)
- API endpoint security (token validation)
- Multi-tenant isolation

### Manual Testing Checklist
- [ ] Create survey template
- [ ] Configure trigger for ticket closure
- [ ] Close ticket and verify email sent
- [ ] Click rating in email and verify response stored
- [ ] Submit survey with comment
- [ ] View responses in dashboard
- [ ] Filter responses by date/company
- [ ] Verify CSAT calculations
- [ ] Test expired token rejection
- [ ] Test duplicate response prevention
- [ ] Verify tenant isolation

### Implementation Notes

**Edition Status:**
- This is a Community Edition (CE) feature available in all installations.
- No edition-specific guards or fallbacks are required.
- All survey functionality should be accessible to all tenants by default.

### Configuration

### Environment Variables

No new environment variables required. Uses existing:
- `DOMAIN` - For survey response URLs
- Email service configuration (already configured)
- Redis/event bus configuration (already configured)

### Feature Flag (Optional)

Could add optional feature flag in tenant settings:

```sql
ALTER TABLE tenant_settings ADD COLUMN surveys_enabled BOOLEAN DEFAULT true;
```

This allows disabling surveys per tenant if needed.

### Summary

This plan provides a complete technical implementation roadmap for a customer satisfaction survey system tailored to small MSPs. The phased approach allows for iterative development and testing, with Phase 1 delivering core functionality and subsequent phases adding reporting and enhancements.

The system leverages existing Alga PSA infrastructure (event bus, email notifications, multi-tenancy) while adding focused survey-specific features that match what competitors offer without unnecessary complexity.
