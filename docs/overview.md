## Architectural Overview of the Open-Source MSP PSA

This document provides a high-level architectural overview of the open-source MSP PSA (Professional Services Automation) application. It covers the system's key components, their interactions, and the underlying technologies used, along with relevant file paths.

**I. Core Modules and File Paths:**

* **Asset Management:** Manages asset lifecycle. Key files located under `server/src/models/asset.ts`, `server/src/lib/models/assetRelationship.ts`, and components under `server/src/components/assets`.

* **Billing:** Handles complex billing scenarios. Core logic resides in `server/src/lib/billing/billingEngine.ts`, with related components in `server/src/components/billing-dashboard`. Invoice templates are managed under `server/src/components/billing-dashboard/InvoiceTemplates.tsx`.

* **Companies/Clients:** Manages client information. See `server/src/lib/models/company.tsx` and components under `server/src/components/companies`.

* **Contacts:** Manages contact information. See `server/src/lib/models/contact.tsx` and components under `server/src/components/contacts`.

* **Documents:** Provides a centralized document repository. Core logic is in `server/src/models/document.tsx` and `server/src/lib/models/document.tsx`, with components located under `server/src/components/documents`.

* **Interactions:** Tracks client interactions. See `server/src/lib/models/interactions.ts` and components under `server/src/components/interactions`.

* **Projects:** Manages projects and tasks. Key files include `server/src/lib/models/project.ts` and components under `server/src/components/projects`.

* **Reporting and Analytics:** Reporting components are located under `server/src/components/Reports.tsx` and `server/src/components/billing-dashboard/Reports.tsx`.

* **Scheduling:** Manages appointments and technician dispatch. See `server/src/lib/models/scheduleEntry.ts` and components under `server/src/components/time-management/ScheduleCalendar.tsx`.

* **Security:** Implements security measures. RBAC and ABAC logic is under `server/src/lib/auth/`. Authentication is handled in `server/src/pages/api/auth/[...nextauth]/route.ts`.

* **Settings:** Configuration settings. See components under `server/src/components/settings`. User management is under `server/src/components/settings/general/`.

* **Support Ticketing:** Manages support tickets. See `server/src/lib/models/ticket.tsx` and components under `server/src/components/tickets`.

* **Time Management:** Tracks time entries and manages timesheets. Key files include `server/src/lib/models/timeEntry.interfaces.ts` and components under `server/src/components/time-management`.

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
  * **Workflows Backend:** Workflow-related services, actions, and utilities are located in `ee/server/src/services/flow/`. Server actions specific to workflows are in `ee/server/src/lib/actions/workflow.ts`.

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

* **Caching:** `server/src/lib/cache` directory contains the caching implementation.

* **Real-time Collaboration:** Hocuspocus integration setup in `server/src/lib/createHocuspocusProvider.tsx`.

* **Authentication:** NextAuth.js configuration in `server/src/pages/api/auth/[...nextauth]/options.ts`.

* **API:** API routes are located in `server/src/pages/api`.

* **Testing:** Tests are located in the `server/src/test` directory.

* **Deployment:** Dockerfile for the server is at `server/Dockerfile`. Kubernetes configurations are in the `helm` directory.

**III. Key Design Considerations:**

* **Multi-Tenancy:** Enforced through database schema and row-level security.

* **Modularity:**
  * Achieved through the organization of modules in the `server/src/components` and `server/src/lib` directories.
  * The addition of the **Workflows** module enhances the system's modularity, allowing users to define custom automation workflows.

* **Scalability:** Addressed through caching (`server/src/lib/cache`) and database optimization strategies.

* **Security:**
  * Implemented through RBAC/ABAC (`server/src/lib/auth`) and secure authentication (`server/src/pages/api/auth/[...nextauth]/options.ts`).
  * The workflows feature incorporates security measures to ensure that only authorized users can create or modify workflows.

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
