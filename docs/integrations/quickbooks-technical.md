# QuickBooks Online Integration - Technical Details

## 1. Architectural Overview

The QuickBooks Online (QBO) integration is built upon the Alga PSA's existing **event-driven, TypeScript-based workflow system**, managed via the **Automation Hub UI**. It does not introduce a separate microservice but rather extends the core platform's capabilities.

**Key Components:**

1.  **Event Bus:** Utilizes the existing Redis Streams-based event bus (`server/src/lib/eventBus/index.ts`). Specific business events trigger integration workflows.
    *   Relevant Events: `INVOICE_CREATED`, `INVOICE_UPDATED`, `COMPANY_CREATED`, `COMPANY_UPDATED` (defined in `server/src/lib/eventBus/events.ts`).
2.  **Automation Hub:** The UI where users configure integrations, enable/disable workflows, and manage entity mappings.
    *   QBO Connection UI: Handles the OAuth 2.0 flow (`/msp/settings/integrations/qbo`).
    *   Entity Mapping UI: Allows mapping Alga entities to QBO entities (`server/src/components/integrations/qbo/QboMappingManager.tsx` and related components).
3.  **Workflow Engine:** Executes workflows defined as TypeScript functions.
    *   **Workflow Context (`WorkflowContext`):** Provides access to trigger event data (`context.input.triggerEvent`), tenant information (`context.tenantId`), workflow state (`context.setState`), and internal data (`context.data`). **Crucially, `tenantId` and the QBO `realmId` must be available within the context for all QBO-related operations.**
    *   **Workflow Actions:** Reusable TypeScript code units performing specific tasks (e.g., API calls). New actions were created for QBO interactions:
        *   `createQboCustomer`, `updateQboCustomer`
        *   `createQboInvoice`, `updateQboInvoice`
        *   These actions encapsulate QBO API logic, data mapping, error handling, and tenant-scoped locking/throttling.
    *   **Action Registry:** Where custom workflow actions are registered to be available in the Automation Hub.
4.  **Workflow Runtime & Workers:** Asynchronous background services that pick up workflow tasks from Redis Streams and execute the corresponding TypeScript functions and actions.
    *   **Human Task Enhancements (Task Inbox):** The platform's Task Inbox has been enhanced to support direct rendering of **inline forms**. When a workflow (like QBO conflict resolution) creates a human task using `actions.createInlineTaskAndWaitForResult` and provides a JSON schema, the Task Inbox can render this form directly, allowing for richer, more contextual user interaction within the task itself.
5.  **Database:** Stores configuration, mappings, and synchronization state.
    *   `tenant_external_entity_mappings`: Central table for storing links between Alga entities and external system entities (see Section 3).
    *   Existing tables (`invoices`, `companies`) may be augmented with columns like `qbo_invoice_id`, `qbo_customer_id`, `qbo_sync_token` (though the primary mapping mechanism is the `tenant_external_entity_mappings` table).

## 2. Data Flow & Synchronization Logic

**General Flow:**

1.  An action occurs in Alga PSA (e.g., Invoice created).
2.  The corresponding event (e.g., `INVOICE_CREATED`) is published to the Event Bus, including the `tenantId`.
3.  If a QBO sync workflow is enabled for that event and tenant in the Automation Hub, the Workflow Runtime picks it up.
4.  The workflow function executes:
    *   Retrieves necessary data from Alga PSA using the `tenantId`.
    *   Retrieves the QBO `realmId` associated with the tenant's connection.
    *   Checks for dependencies (e.g., Invoice Sync requires Customer Sync to have run first). Uses `context.setState` to manage workflow state if waiting.
    *   Calls appropriate QBO Workflow Actions (e.g., `createQboInvoice`).
5.  The Workflow Action executes:
    *   Retrieves tenant-specific QBO credentials securely (see Section 4).
    *   Acquires tenant- and realm-scoped locks/throttles using Redis (see Section 5).
    *   Performs data mapping using configured `tenant_external_entity_mappings`.
    *   Calls the QBO API using the correct `realmId` and access token.
    *   Handles API responses (success/error), including rate limiting (HTTP 429).
    *   Releases locks/throttles.
6.  On successful API call:
    *   The action returns the external ID and sync token.
    *   The workflow saves the mapping to the `tenant_external_entity_mappings` table (e.g., linking `alga_invoice_id` to `qbo_invoice_id` for the specific `tenantId` and `realmId`).
    *   The workflow updates its state (`context.setState('Completed')`).
7.  On failure:
    *   The action logs the error (tagged with `tenantId`/`realmId`).
    *   Retries may occur based on error type.
    *   Persistent errors may trigger a Human Task for manual intervention. For specific, complex scenarios like company duplicate detection during QBO synchronization (detailed further in "Company Synchronization Specifics & Conflict Resolution"), the workflow leverages an **inline form task** (typically via `actions.createInlineTaskAndWaitForResult`). This presents rich contextual data and specific resolution options directly to the user, pausing the main workflow until resolution.

**Source of Truth:**

*   Initially, Alga PSA acts as the primary source of truth, pushing data *to* QBO. Bi-directional sync is not implemented in the initial version due to complexity.

### Company Synchronization Specifics & Conflict Resolution

The `qboCustomerSyncWorkflow.ts` (located in `server/src/lib/workflows/`) handles the synchronization of Alga PSA `Company` entities to QuickBooks Online `Customer` entities. A key enhancement in this workflow is the interactive handling of potential duplicate customers found in QBO during the creation of a new customer.

**Conflict Detection and Inline Form Invocation:**
1.  When attempting to create a new QBO customer, the workflow first checks for potential duplicates in QBO based on display name or email using the `actions.get_qbo_customer_by_display_or_email` action.
2.  If potential duplicates are found (using `actions.get_qbo_customer_by_display_or_email`), the workflow invokes a specialized **inline form task** via the `actions.createInlineTaskAndWaitForResult` action. This replaces previous generic error tasking for this scenario.
3.  This inline form is designed to provide the user with comprehensive information to make an informed decision. It displays:
    *   Details of the Alga company being synced.
    *   Details of the potential QuickBooks duplicate(s).
    *   Contextual information about the sync job.
4.  The form utilizes a `RichTextViewerWidget` (registered in `server/src/lib/workflow/forms/customWidgets.tsx`) for an enhanced display of this information, rendering formatted text (e.g., bolding) from Markdown. For the Alga company's address, which is stored as a single string in the Alga system, the workflow prepares hardcoded, delineated address parts (street, city, etc.) specifically for the form's `contextData`, while also displaying the original full address string for user reference.

**User Resolution Options and Workflow Processing:**
The inline form presents the user with two primary resolution options:
*   **"Link Alga company to this existing QuickBooks company":**
    *   If selected, the user chooses one of the potential QB duplicates (or an explicitly searched one, if the form supports it).
    *   The workflow receives the `quickbooks_company_id_linked` from the form.
    *   It then sets this ID as the `existingQboCustomerId` and explicitly clears any existing `qboSyncToken`. This action ensures that when the workflow transitions to the "UPDATE PATH" for the selected QBO customer, it will re-fetch the customer's latest details, including the current `SyncToken`, before attempting an update, thus preventing sync token errors.
*   **"Create this Alga company as a new company in QuickBooks":**
    *   If selected, the workflow proceeds with the original "CREATE PATH", creating a new customer record in QBO based on the Alga company's data.

**Task Cancellation:**
*   If the user cancels the inline form task (e.g., by closing the modal), the `createInlineTaskAndWaitForResult` action returns a status indicating cancellation.
*   The `qboCustomerSyncWorkflow` then logs this event and typically emits a failure event, allowing the calling process or system to handle the unresolved conflict appropriately (e.g., manual follow-up or retry at a later time).

This inline form mechanism significantly improves the user experience for resolving common data conflicts during QBO synchronization by providing all necessary information and actions directly within the resolution task.

## 3. Key Storage & Mappings

*   **External IDs:** The primary mechanism for linking Alga entities to their QBO counterparts is the `tenant_external_entity_mappings` table.
    *   **Schema:** Stores `tenant_id`, `integration_type` ('quickbooks_online'), `alga_entity_type`, `alga_entity_id`, `external_entity_id`, `external_realm_id`, `sync_status`, `metadata`, etc.
    *   **Purpose:** Allows looking up the QBO ID for a given Alga entity (and vice-versa) within the context of a specific tenant and QBO realm.
    *   **Example Lookup:** To find the QBO Customer ID for Alga Company 'XYZ' for Tenant 'ABC' connected to Realm '123':
        ```sql
        SELECT external_entity_id
        FROM tenant_external_entity_mappings
        WHERE tenant_id = 'ABC'
          AND integration_type = 'quickbooks_online'
          AND alga_entity_type = 'customer' -- or 'company' depending on convention
          AND alga_entity_id = 'XYZ'
          AND external_realm_id = '123';
        ```
*   **QBO Sync Tokens:** Used for optimistic locking during updates. These are stored alongside the mapping in the `metadata` field of `tenant_external_entity_mappings` or potentially in dedicated columns if added later.
*   **Entity Mappings (Configuration):** User-configured mappings (Service <-> Item, Tax Code <-> Tax Code, Term <-> Term) are also stored, likely referencing the `tenant_external_entity_mappings` table or a dedicated configuration table scoped by tenant and integration type.

## 4. Secrets Management (OAuth Tokens)

*   **Requirement:** QBO OAuth 2.0 access and refresh tokens must be stored securely and **scoped per tenant**.
*   **Storage:** A dedicated, secure mechanism is required. Options include:
    *   A separate, encrypted database table with strict Row-Level Security (RLS) based on `tenant_id`.
    *   An external secrets manager (like HashiCorp Vault) with paths keyed by `tenant_id`.
    *   Leveraging the existing `server/src/lib/utils/getSecret.ts` utility if it can be adapted for tenant-specific secrets.
*   **Access:** Workflow actions needing to call the QBO API must retrieve the *current* tenant's valid access token from this secure storage. They should **never** receive tokens directly via the workflow context.
*   **Refresh:** A background process or mechanism within the actions themselves must handle refreshing tokens using the stored refresh token before the access token expires. The new refresh token must be stored back securely. Lazy/on-demand refresh is preferred to avoid unnecessary polling for inactive tenants.

## 5. Multi-Tenancy Considerations

Integrating with an external API like QBO in a multi-tenant environment requires careful design to ensure isolation, fairness, and adherence to API limits per QBO company (Realm).

*   **Tenant/Realm Context:** `tenantId` and `realmId` MUST be available in the workflow context and passed to all relevant actions and functions.
*   **Scoped Redis Keys:** All shared resources managed in Redis (locks, rate limiters, concurrency semaphores, caches) MUST be namespaced using **both** `tenantId` and `realmId`.
    *   Example Key: `qbo:<tenantId>:<realmId>:lock:Customer:<qboCustomerId>`
    *   This prevents cross-tenant/cross-realm interference and collisions.
*   **Rate Limiting & Concurrency:** QBO limits are per Realm ID. The integration must implement:
    *   **Per-Realm Concurrency Limiter:** Using a Redis semaphore keyed by `tenantId:realmId` (e.g., limit 10 concurrent requests).
    *   **Per-Realm Rate Limiter:** Using a Redis leaky bucket or similar keyed by `tenantId:realmId` (e.g., limit 500 requests/minute).
*   **Fair Queuing:** To prevent a single tenant/realm from monopolizing QBO API access, a fair dispatching mechanism (e.g., round-robin queue processing across active `tenantId:realmId` pairs) should manage jobs feeding into the per-realm limiters.
*   **Database Isolation:** Use Row-Level Security (RLS) on the `tenant_external_entity_mappings` table and any tables storing tenant-specific configuration or credentials. Ensure all database queries within workflows and actions include `WHERE tenant_id = ?`.
*   **Logging & Monitoring:** All logs and metrics related to QBO interactions MUST be tagged with `tenantId` and `realmId` for effective debugging and monitoring.

## 6. Relevant Codebase Files (Illustrative)

*   **Workflows/Actions:** Likely within `server/src/lib/actions/integrations/qbo/` or similar.
*   **Event Definitions:** `server/src/lib/eventBus/events.ts`
*   **Mapping UI:** `server/src/components/integrations/qbo/`
*   **Mapping Storage:** `tenant_external_entity_mappings` table schema (defined in a migration file).
*   **Secret Storage:** Implementation depends on the chosen method (see Section 4).
*   **Core Models:** `server/src/lib/models/invoice.ts`, `server/src/lib/models/company.tsx`, etc.