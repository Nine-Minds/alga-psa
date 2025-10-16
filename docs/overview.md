## Architectural Overview of the Open-Source Alga PSA

> 📝 **Note:** The Alga PSA hosted environment is available at `api.algapsa.com`. If you are running an on-premise installation, replace this with your configured domain.

This document provides a high-level architectural overview of the open-source MSP PSA (Professional Services Automation) application. It covers the system's key components, their interactions, and the underlying technologies used, along with relevant file paths.

**I. Core Modules and File Paths:**

* **Asset Management:** Manages asset lifecycle. Key files located under `server/src/models/asset.ts`, `server/src/lib/models/assetRelationship.ts`, and components under `server/src/components/assets`.

* **Billing:** The Billing module handles complex billing scenarios, including fixed-price contract lines, time-based billing, usage-based billing, bucket of hours/retainer contract lines, discounts, promotions, multi-currency, tax handling, contracts, refunds, and adjustments. It integrates with other modules like Projects, Time Management, and Documents to produce and store invoices.

  * Key Features:
    - Contract Lines: Assign multiple contract lines to a single client (company).
    - Contracts: Create named collections of contract lines that can be managed as a single entity.
    - Automated Invoice Generation: Automatically generate invoices for time- or usage-based charges.
    - Manual Invoicing: Allows ad-hoc or on-demand invoice creation and updates. Useful for one-off or custom charges that do not originate from usage/time entries.
    - Tax Calculation: Supports flexible tax rules via a dedicated TaxService that looks up tax rates from the database.
    - Transactions: Each invoice generation, payment, or adjustment is recorded in the transactions table for auditing and financial tracking.
    - Credits, Refunds, and Adjustments: Systematically apply credits to invoices or record partial/full refunds.
    - Invoice Templates: Standard templates are shared across tenants, while custom templates are tenant-scoped. Default selections are persisted in `invoice_template_assignments`, which records the scope (`tenant`, `company`, future types) and whether the assignment references a standard template code or a custom template ID.

  * Key Files:
    - Core Logic: `server/src/lib/billing/billingEngine.ts`
    - Manual Invoicing:
      * `server/src/lib/actions/manualInvoiceActions.ts`: Server-side logic for generating and updating manual invoices
      * `server/src/components/billing-dashboard/ManualInvoices.tsx`: Front-end form to create and edit manual invoices
      * `server/src/components/billing-dashboard/Invoices.tsx`: Overall invoices screen, which also provides an "Edit" option for manual invoices
    - Contracts:
      * `server/src/lib/models/contract.ts`: Core model for contracts
      * `server/src/lib/models/contractLineMapping.ts`: Model for contract lines within contracts
      * `server/src/lib/models/companyContract.ts`: Model for company contract assignments
      * `server/src/lib/actions/contractActions.ts`: Server-side logic for managing contracts
      * `server/src/lib/actions/companyContractActions.ts`: Server-side logic for assigning contracts to companies
      * `server/src/components/billing-dashboard/contracts/Contracts.tsx`: Front-end components for managing contracts
    - Invoice Templates: `server/src/components/billing-dashboard/InvoiceTemplates.tsx`

* **Companies/Clients:** Manages client information. See `server/src/lib/models/company.tsx` and components under `server/src/components/companies`.

* **Contacts:** Manages contact information. See `server/src/lib/models/contact.tsx` and components under `server/src/components/contacts`.

* **Documents:** Provides a centralized document repository with separated content storage:
  * Core Components:
    - Document metadata management
    - Separate content storage for improved performance
    - Multi-tenant document isolation
    - File storage integration
    - Block-based content editing with BlockNote
  * Key Files:
    - `server/src/models/document.tsx` and `server/src/lib/models/document.tsx`: Core document logic
    - `server/src/components/documents`: UI components
    - `server/src/components/editor/TextEditor.tsx`: BlockNote editor integration
    - `server/src/lib/actions/document-actions/documentBlockContentActions.ts`: Block content operations
    - `server/migrations/20241224011610_create_document_content.cjs`: Document content table
    - `server/migrations/20241224184511_create_document_block_content.cjs`: Block-based content table
  * Features:
    - 1-to-1 relationship between documents and content
    - Tenant isolation through RLS policies
    - Efficient metadata querying
    - Large text content separation
    - Rich text editing with BlockNote:
      * Block-based content structure
      * Real-time content updates
      * Standardized JSON storage format
      * Error handling and validation
    - Support for future collaborative editing features
    - Document versioning system:
      * Version tracking with version numbers
      * Active version flagging
      * Version-specific block content
      * Tenant-isolated version history
      * Creation metadata tracking
      * Optional version references for gradual adoption

* **Event Bus System:** Asynchronous event processing system using Redis streams:
  * Core components:
    - Redis-based event streaming
    - Type-safe event definitions using Zod
    - Multi-tenant event isolation through payloads
    - Automatic reconnection handling
    - Comprehensive error handling and logging
  * Key files:
    - `server/src/lib/eventBus/index.ts`: Core event bus implementation
    - `server/src/lib/eventBus/events.ts`: Event type definitions and schemas
    - `server/src/lib/eventBus/subscribers/`: Event subscribers
    - `server/src/config/redisConfig.ts`: Redis configuration
  * Features:
    - Simple event type based boards
    - Tenant isolation through event payloads
    - Type-safe event publishing and handling
    - Automatic Redis reconnection with exponential backoff
    - Event validation using Zod schemas
    - Detailed event logging and monitoring

* **Email Notifications:** Comprehensive notification system with template management and tenant customization, integrated with the event bus system. Core components:
  * Database-driven templates:
    - `system_email_templates`: System-wide default templates (read-only)
    - `tenant_email_templates`: Tenant-specific customizations with RLS
    - Template inheritance: Tenant templates can be cloned from system templates
  * Configuration and preferences:
    - Global settings per tenant (enable/disable, rate limits)
    - User-level notification preferences
    - Hierarchical category and subtype system:
      * System-wide categories (e.g., Tickets, Invoices)
      * Subtypes within each category (e.g., Ticket Created, Invoice Overdue)
      * Category-based control: Disabling a category automatically disables its subtypes
  * Features:
    - HTML and plain text email formats
    - Handlebars templating for dynamic content
    - Template versioning and inheritance
    - Rate limiting and throttling
    - Detailed audit logging
    - Asynchronous email processing through event bus
    - Reliable email delivery with Redis-backed queuing
  * Default notification types:
    - Tickets (created, updated, closed)
    - Invoices (generated, payment, overdue)
    - Projects (created, tasks, milestones)
    - Time Entries (submitted, approved, rejected)
  * Key files:
    - `server/src/lib/notifications/email.ts`: Core notification service
    - `server/src/services/emailService.ts`: SMTP integration and email service
    - `server/src/lib/models/notification.ts`: Type definitions
    - `server/src/components/settings/notifications/EmailTemplates.tsx`: Template management UI
    - `server/src/components/settings/notifications/NotificationCategories.tsx`: Category/subtype management UI
    - `server/src/components/settings/notifications/NotificationSettings.tsx`: Global settings UI

* **Interactions:** Tracks client interactions. See `server/src/lib/models/interactions.ts` and components under `server/src/components/interactions`.

* **Projects:** Manages projects and tasks. Key files include `server/src/lib/models/project.ts` and components under `server/src/components/projects`.

* **Reporting and Analytics:** Reporting components are located under `server/src/components/Reports.tsx` and `server/src/components/billing-dashboard/Reports.tsx`.

* **Scheduling:** Advanced scheduling system for managing appointments and technician dispatch:
  * Core Components:
    - Multi-agent assignment support
    - Efficient recurring event handling
    - Role-based access control
    - Interactive calendar interface
  * Key Files:
    - `server/src/lib/models/scheduleEntry.ts`: Core scheduling logic
    - `server/src/components/time-management/ScheduleCalendar.tsx`: Calendar UI
    - `server/src/components/time-management/EntryPopup.tsx`: Entry management
    - `server/migrations/20241227233407_create_schedule_entry_assignees.cjs`: Multi-agent support
  * Features:
    - Multiple technician assignments per entry
    - Efficient recurring event storage
    - On-demand virtual instance generation
    - Exception handling for recurring series
    - Drag-and-drop calendar interface
    - Visual work item type distinction
    - Real-time updates and conflict detection
  * Performance Optimizations:
    - Only master entries stored for recurrences
    - Virtual instance calculation
    - Efficient database indexing
    - Optimized assignment queries

* **Security:** Implements security measures. RBAC and ABAC logic is under `server/src/lib/auth/`. Authentication is handled through NextAuth.js with multi-portal support:
  * Authentication Routes:
    - **MSP Portal**: `/auth/msp/signin` (purple theme, internal users)
    - **Client Portal**: `/auth/client-portal/signin` (blue theme, client users)
    - **Password Reset**: Portal-specific forgot-password pages, shared reset form at `/auth/password-reset/set-new-password`
  * User Types:
    - `internal`: MSP staff with full system access
    - `client`: Client portal users with limited access
  * Key Files:
    - `server/src/app/api/auth/[...nextauth]/route.ts`: NextAuth configuration
    - `server/src/app/auth/msp/signin/page.tsx`: MSP login page
    - `server/src/app/auth/client-portal/signin/page.tsx`: Client portal login page
    - `server/src/lib/actions/useRegister.tsx`: Registration and password reset logic

* **Settings:** Configuration settings with advanced reference data management:
  * Core Components:
    - General settings and user management
    - Reference data import system for standardized configurations
    - Multi-tenant reference data isolation
  * Reference Data Import System:
    - Import pre-defined standard configurations (priorities, statuses, boards, categories)
    - Conflict resolution for duplicate names and display orders
    - Hierarchical category management with parent-child relationships
    - Board-based category organization (boards as organizational containers)
  * Key Files:
    - `server/src/components/settings/`: All settings UI components
    - `server/src/components/settings/general/`: User management and ticketing settings
    - `server/src/lib/actions/referenceDataActions.ts`: Server-side import logic
    - `server/migrations/20250630140000_create_standard_reference_tables.cjs`: Standard data definitions
  * Features:
    - "Import from Standard Types" functionality for all reference data
    - Visual selection interface with checkboxes
    - Automatic conflict detection and resolution
    - Preservation of hierarchical relationships during import
    - Display order management and conflict resolution

* **Support Ticketing:** Manages support tickets. See `server/src/lib/models/ticket.tsx` and components under `server/src/components/tickets`.

* **Time Management:** Tracks time entries and manages timesheets with both manual entry and automatic interval tracking:
  * Core Components:
    - Time entry management and approval workflows
    - Automatic interval tracking for ticket viewing sessions
    - Configurable time period settings
    - Timesheet submission and approval process
  * Key Files:
    - `server/src/lib/models/timeEntry.interfaces.ts`: Core time entry data structures
    - `server/src/services/IntervalTrackingService.ts`: Service for managing ticket viewing intervals
    - `server/src/hooks/useTicketTimeTracking.ts`: React hook for automatic interval tracking
    - `server/src/components/time-management/interval-tracking/`: Interval management components
    - `server/src/components/time-management/time-entry/`: Time entry components
  * Features:
    - Automatic tracking of time spent viewing tickets
    - Local storage of intervals using IndexedDB
    - Interval management with selection, merging, and adjustment capabilities
    - Conversion of intervals to billable time entries
    - Auto-close mechanism for abandoned intervals
    - Integration with time sheets and ticketing dashboard
    - Continuous tracking with intelligent session handling

* **Workflows:** Provides a graphical interface for designing and automating workflows within the system. Core components are located under `ee/server/src/components/flow`. Notable files include:
  * `ee/server/src/components/flow/DnDFlow.tsx`: Main drag-and-drop workflow editor.
  * Node components under `ee/server/src/components/flow/nodes/` (e.g., `ActionNode.tsx`, `DecisionNode.tsx`).
  * Workflow services and utilities in `ee/server/src/services/flow/`.
  * Protobuf definitions in `ee/server/protos/workflow.proto` and generated code in `ee/server/src/generated/`.

**II. Technical Architecture and File Paths:**

* **Docker Configuration:**
  * Base configuration in `docker-compose.yaml`:
    - Defines common services (server, postgres, redis, etc.)
    - Sets up shared environment variables
    - Configures networking
  * Enterprise Edition configuration in `ee/setup/docker-compose.yaml`:
    - Extends base services
    - Adds EE-specific overrides
    - Configures EE-specific environment variables
  * Running different editions:
    ```bash
    # Community Edition
    docker compose -f docker-compose.yaml up
    
    # Enterprise Edition
    docker compose -f docker-compose.yaml -f ee/setup/docker-compose.yaml up
    ```

* **Frontend:**
  * Next.js application located in `server/src/pages` and `server/src/components`.
  * **Workflows UI:** Workflow-related UI components for the Enterprise Edition are located in `ee/server/src/components/flow`. These include the workflow editor and associated components.

* **Backend:**
  * Node.js server with API routes in `server/src/pages/api`.
  * Server actions are defined within the `server/src/lib/actions` directory.
  * Shared data models (used by actions and workflows) are under `shared/models`.
    - Example: `shared/models/userModel.ts` exposes `createPortalUserInDB` and `createPortalUserInDBWithTrx` (accepts an existing transaction) for portal user creation.
  * **Workflows Backend:** Workflow-related services, actions, and utilities are located in `ee/server/src/services/flow/`. Server actions specific to workflows are in `ee/server/src/lib/actions/workflow.ts`.

### Upcoming Runtime Change: Moving from the built-in Next.js server to an Express.js custom server

Historically the application has been deployed by relying on the server that ships with Next.js.  While this works well for most SaaS workloads, there are two concrete limitations we keep running into:

1. The built-in **Edge / Stand-alone runtime** used by Next.js middleware makes it difficult to
   •  access long-lived Node primitives (database pools, Redis clients, etc.)
   •  mount 3rd-party express/connect style middleware (Sentry, rate-limits, custom request-logging)
2. The stock server offers very little configurability at the HTTP-layer (timeouts, keep-alive tuning, connection-handling, pre-warmed pools, etc.) which we need in bare-metal / Kubernetes clusters.

Because SEO is *not* a concern for the product (login-gated SaaS) we do **not** depend on the Vercel edge-network or ISR.  That opens the door for us to run the application with the full Node runtime by embedding Next.js inside an **Express** server – a path explicitly documented by the framework team (see https://nextjs.org/docs/app/guides/custom-server).

Key goals of the migration

• Retain every developer-facing Next.js feature:  
  – App routes (`/app/(.)`) and API routes (`/api/...`)  
  – React Server Components + Server Actions  
  – Hot-reloading / Fast-refresh in development  
• Eliminate the edge-runtime from our middleware, so we can share ordinary `node-postgres`, `ioredis`, etc. connections.
• Allow us to insert *traditional* express middleware – e.g. a single Sentry request handler rather than the current duplicated `initSentry()` helper in every route.
• Provide a single place to fine-tune HTTP server behaviour (timeouts, compression, request-body limits, etc.).

Proposed high-level design

1. Create `server/index.ts` that:
   • Calls `next({ dev: process.env.NODE_ENV !== 'production' })` to initialise the Next.js compiler/handler.  
   • Spins up an `express()` instance and mounts:
     – Health-check & readiness probes at `/healthz` and `/readyz` (needed by k8s).  
     – Logging, Sentry, tracing and rate-limit middleware.  
     – The Next.js request handler *last*, via `app.get('*', nextHandler)` – this keeps parity with Next’s routing precedence.
2. Swap the `npm run start` script in `package.json` to `NODE_ENV=production node server/index.js` after the build step.
3. Update the Docker image to expose `server/index.js` instead of `next start`.
4. Keep the current `next dev` workflow untouched for local development – the express server only runs in `production` mode.

Potential pitfalls & mitigations

• Authentication callbacks (e.g. NextAuth.js) must be wrapped correctly so cookies are still parsed by their built-in utilities. *Mitigation*: run their API routes *through* the Next handler; do **not** move them to raw express.
• `headers()` / `cookies()` helpers inside RSC still work because they ultimately read from the incoming `RequestLike` – which Next constructs for us. Our express server will forward the raw `req`/`res` objects untouched to the Next handler, so nothing breaks.
• If we ever decide to re-enable ISR or the App Router cache we must ensure the underlying `fs` access is still available in the container. This is already the case today.

Timeline

• Phase 1 – prototype branch with side-by-side express server & CI checks (1-2 days).  
• Phase 2 – Staging deploy behind feature flag (1 week).  
• Phase 3 – Production cut-over & post-mortem (1 day).

No code has been merged yet – this section serves as an architectural note so all contributors understand *why* we are switching away from the default runtime and what constraints we must preserve.

* **Enterprise Edition (`ee`) Folder:**
  * The `ee` folder contains the server code for the Enterprise Edition of the application.
  * It mirrors the base server directory structure and includes its own migrations that are overlaid on top of the base server migrations.
  * EE-specific database changes should be made in the migrations within the `ee` folder.
  * **File Paths:**
    * Protobuf definitions: `ee/server/protos/`.
    * Generated Protobuf code: `ee/server/src/generated/`.

* **Database:**
  * PostgreSQL database schema defined in the `server/migrations` folder.
  * Knex.js configurations are in `server/knexfile.cjs` and `server/src/lib/db/knexfile.tsx`.
  * EE-specific migrations are located in `ee/server/migrations/`.
  * Local EE migrations (dev workstations): use the temp-dir overlay runner documented in `docs/migrations/local-ee-migrations.md`.

* **Caching:** `server/src/lib/cache` directory contains the caching implementation.

* **Real-time Collaboration:** Hocuspocus integration setup in `server/src/lib/createHocuspocusProvider.tsx`.

* **Authentication:** NextAuth.js configuration with multi-portal support:
  * Main configuration: `server/src/app/api/auth/[...nextauth]/options.ts`
  * Portal pages: `/auth/msp/*` for MSP users, `/auth/client-portal/*` for client users
  * Shared components: `/auth/password-reset/*`, `/auth/check-email`, `/auth/verify-email`

* **API:** API routes are located in `server/src/pages/api`.

* **Testing:** Tests are located in the `server/src/test` directory.

* **Deployment:** Dockerfile for the server is at `server/Dockerfile`. Kubernetes configurations are in the `helm` directory.

* **Enterprise vs Community Edition Implementation:**
  * The application uses a module aliasing system to handle features that differ between Enterprise Edition (EE) and Community Edition (CE):
    ```typescript
    // Configuration in next.config.mjs
    config.resolve.alias['@ee'] = process.env.NEXT_PUBLIC_EDITION === 'enterprise'
      ? path.join(__dirname, '../ee/server/src')
      : path.join(__dirname, 'src/empty')
    ```
  
  * **Empty Implementations Pattern:**
    * Located in `server/src/empty/` directory
    * Mirrors the EE directory structure
    * Provides CE-appropriate fallbacks for enterprise features
    * Example structure:
      ```
      server/src/empty/
      ├── components/
      │   └── flow/
      │       └── DnDFlow.tsx      # Empty workflow editor component
      ├── services/
      │   └── chatStreamService.ts # Empty chat service
      └── lib/
          └── storage/
              └── providers/
                  └── S3StorageProvider.ts # Empty storage provider
      ```
    
  * **Implementation Strategies:**
    * UI Components: Display "Enterprise Feature" messages with upgrade information
    * Services: Return appropriate HTTP responses (e.g., 403 Forbidden) with upgrade messages
    * Storage Providers: Throw clear enterprise-only errors
    * Example:
      ```typescript
      // CE implementation of an enterprise feature
      export class ChatStreamService {
        static async handleChatStream(req: NextRequest) {
          return new Response(
            JSON.stringify({ 
              error: 'Chat streaming is only available in Enterprise Edition' 
            }), 
            { status: 403 }
          );
        }
      }
      ```

  * **Type Safety:**
    * TypeScript paths configuration ensures proper type checking:
      ```json
      {
        "compilerOptions": {
          "paths": {
            "@ee/*": [
              "../ee/server/src/*",
              "./src/empty/*"
            ]
          }
        }
      }
      ```
    * Empty implementations maintain the same interfaces as their EE counterparts
    * This ensures type safety across both editions

**III. Key Design Considerations:**

* **Multi-Tenancy:** Enforced through database schema and row-level security.

* **Modularity:**
  * Achieved through the organization of modules in the `server/src/components` and `server/src/lib` directories.
  * The addition of the **Workflows** module enhances the system's modularity, allowing users to define custom automation workflows.

* **Scalability:** Addressed through caching (`server/src/lib/cache`) and database optimization strategies.

* **Security:**
  * Implemented through RBAC/ABAC (`server/src/lib/auth`) and secure authentication (`server/src/pages/api/auth/[...nextauth]/options.ts`).
  * The workflows feature incorporates security measures to ensure that only authorized users can create or modify workflows.

  RBAC Roles (Client Portal)
  - Required roles: `User` and `Admin` in the client portal (`roles.msp = false`, `roles.client = true`).
  - Migrations create/normalize these roles; application code assumes they exist.
  - No legacy fallback: code no longer falls back to roles named "Client"/"Client_Admin". Missing roles cause explicit errors to surface misconfigurations.

* **Extensibility:**
  * Facilitated by well-defined API endpoints (`server/src/pages/api`) and a modular codebase.
  * The workflows module allows for the extension of system capabilities through custom automation, enabling integrations with external systems and services.

**IV. Future Enhancements:**

* **AI/ML Integration:**
  * With the foundation laid by the workflows module, explore opportunities for integrating AI/ML capabilities.
  * Potential applications include predictive maintenance, automated ticket routing, and intelligent decision-making within workflows.

* **Expanded Integrations:**
  * Develop APIs for third-party integrations and enhance client portal features.
  * Leverage the workflows module to streamline integrations with external systems.

* **Mobile Access:** Develop mobile applications for both technicians and clients.

* **Advanced Reporting and Analytics:** Implement more sophisticated reporting and analytics features for data-driven decision-making.

This architectural overview provides a general understanding of the MSP PSA system. Refer to the individual module documentation for more detailed information on specific features and implementations.
