# Open Source MSP Professional Services Automation (PSA)

A comprehensive Professional Services Automation platform designed for Managed Service Providers (MSPs). This open-source solution helps MSPs streamline operations, manage client relationships, track time and billing, and improve service delivery.

## Features

### Current Feature Status

| Feature                        | Status         | Completion | Notes                                                                                                                                                                                                                                                              |
| ------------------------------ | -------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Support Ticketing System       | Implemented    | 95%        | Overall ticketing system (MSP & Client Portal foundation) is largely complete. UI and specific client portal features are in progress.                                                                                                                             |
| Technician Dispatch            | Implemented    | 99%        | Scheduling system supports multi-agent assignment to entries, recurrence, and an interactive calendar interface.                                                                                                                                                   |
| Client Management              | In Development | 85%        | Client portal with features for account management, support ticketing, invoice access, and knowledge base.                                                                                                                                                         |
| Contact and Company Management | In Development | 80%        | System for managing client and company contact information, relationships, and communication history.                                                                                                                                                              |
| Schedule Management            | Implemented    | 99%        | Interactive calendar for managing schedule entries, supporting multi-agent assignments and recurrence.                                                                                                                                                             |
| Project Management             | Implemented    | 90%        | Comprehensive project management system with phases, tasks, resource allocation, and ticket linking. Includes project status tracking, timeline management, and team collaboration features.                                                                       |
| API Management                 | In Development | 85%        | Comprehensive API system with NextAuth integration, JWT authentication. Supports API key management, rate limiting, and detailed documentation.                                                                                                                    |
| Billing & Invoicing            | Implemented    | 90%        | Flexible system supporting manual invoicing, plan bundles, fixed/time/usage/bucket service types, detailed tax calculations, and a credit system.                                                                                                                  |
| Invoice Template Editor        | Implemented    | 95%        | System for customizing invoice appearance and layout with standard and custom templates. Uses AssemblyScript compiled to WebAssembly for safe, sandboxed execution. Includes UI components for template management, editing, and a compilation/execution pipeline. |
| Tax Support                    | Implemented    | 95%        | Supports composite taxes, threshold-based rates, tax holidays, and reverse charge mechanisms.                                                                                                                                                                      |
| QuickBooks Online              | Implemented    | 90%        | Integration leverages event-driven workflow system for financial data synchronization. Supports entity mapping and automated updates between Alga PSA and QuickBooks Online.                                                                                       |
| Workflow Automation Hub        | Implemented    | 90%        | Supports TypeScript-based workflow creation, management, testing, versioning, event attachment, and monitoring.                                                                                                                                                    |
| Job Scheduler                  | Implemented    | 95%        | Robust system built on pg-boss with PostgreSQL backend. Supports immediate, scheduled, and recurring jobs with monitoring, metrics, automatic retries, and job history tracking. Pluggable job schedulers are planned for future development.                      |
| Document Management            | Implemented    | 90%        | Robust multi-tenant file storage with provider support, metadata, entity relationships, versioning, and multiple content storage options (file, text, block-based JSON with BlockNote).                                                                            |
| Email Notification System      | In Development | 80%        | Comprehensive system with template management, tenant customization, and event bus integration. Features database-driven templates, user-level preferences, hierarchical category system, and reliable email delivery with Redis-backed queuing.                   |
| Team Management                | In Development | 75%        | Team creation and management system with member assignments and role-based permissions. Supports team-based resource allocation and scheduling for projects and tickets.                                                                                           |
| Security                       | Implemented    | 95%        | Secure secrets management using Docker secrets. RBAC and ABAC are core security functionalities.                                                                                                                                                                   |
| Time Management                | Implemented    | 95%        | Supports manual time entries, automatic ticket interval tracking, configurable time periods, and timesheet approval workflows.                                                                                                                                     |
| Real-time Collaboration        | Postponed      | 65%        | Hocuspocus integration enables real-time collaborative editing of documents and content. Supports multi-user editing with conflict resolution and change tracking.                                                                                                 |
| Asset Management               | Postponed      | 50%        | Core, service integration, and advanced features (relationships, type-specific attributes) are complete. Phase 4 (Automation/Intelligence) is future.                                                                                                              |
| Reporting & Analytics          | Postponed | 60%        | Core reporting infrastructure in place with custom report builder. Dashboard integration and export capabilities are in progress. Advanced analytics features planned for future phases.                                                                           |
| Third-Party Integrations       | In Development | 70%        | Framework in place for additional integrations (API, data source, authentication). More integrations planned.                                                                                                                                                      |
| Mobile Version                 | Planned        | 0%         | Mobile application version of the platform for on-the-go access to key features.                                                                                                                                                                                   |
| SLA Service                    | Planned        | 0%         | Service Level Agreement tracking and management system.                                                                                                                                                                                                            |
| Procurement Center             | Planned        | 0%         | Centralized procurement management for hardware, software, and services.                                                                                                                                                                                           |
| Message Center                 | Planned        | 0%         | Unified messaging system for internal and client communications.                                                                                                                                                                                                   |
| Intelligent Assistance         | In Development | ✨         | Next-generation platform intelligence to enhance productivity and decision-making across core features.                                                                                                                                                            |

### Core Functionality
- **Asset Management**: Track and manage client assets, maintenance schedules, and relationships
- **Automation Hub**: Create and manage TypeScript-based workflows with event-based triggers
- **Billing & Invoicing**: Flexible billing cycles, international tax support, and automated invoicing
- **Client Management**: Comprehensive client profiles and relationship tracking
- **Document Management**: Centralized document repository with version control
- **Project Management**: Project tracking, task management, and resource allocation
- **Support Ticketing**: Incident tracking and resolution management
- **Time Management**: Time tracking with automatic interval tracking, timesheet approval, and utilization reporting
- **Reporting & Analytics**: Customizable reports and business intelligence
- **Security**: Role-based access control (RBAC) and attribute-based access control (ABAC)

### Advanced Features
- **International Tax Support**: Handle complex tax scenarios across jurisdictions
  - Composite taxes
  - Threshold-based tax rates
  - Tax holidays
  - Reverse charge mechanisms
- **Flexible Billing Cycles**: Customizable per company
  - Weekly, bi-weekly, monthly, quarterly options
  - Proration support
  - Approval-based time entry billing
  - Unapproved time entry rollover
- **Automatic Interval Tracking**: Intelligent time tracking for ticket work
  - Automatic capture of ticket viewing sessions
  - Local browser storage with IndexedDB
  - Interval management with merging and adjustment capabilities
  - Seamless conversion to billable time entries
  - Auto-close mechanism for abandoned intervals
- **Automation Hub**: Powerful workflow automation system
  - TypeScript-based workflow definitions
  - Event-driven workflow triggers
  - Visual workflow editor with code completion
  - Workflow versioning and history
  - Template library for common automation patterns

## Technical Architecture

- **Frontend**: Next.js application
- **Backend**: Node.js server
- **Database**: PostgreSQL with row-level security
- **Event Processing**: Redis-based event bus with Zod schema validation
- **Workflow Engine**: Event-sourced workflow system with TypeScript support
- **Real-time Collaboration**: Hocuspocus integration
- **Authentication**: NextAuth.js
- **UI Components**: Radix-based component library

## Getting Started

For detailed setup instructions, please refer to our [Complete Setup Guide](/docs/setup_guide.md) or [Setup Guide for Windows](/docs/setup_guide_windows.md) . The guide covers:
- Prerequisites and system requirements
- Installation steps for both Community and Enterprise editions
- Environment configuration
- Security setup
- Verification steps

## Documentation

### Setup & Configuration
- [Complete Setup Guide](/docs/setup_guide.md) - Step-by-step setup instructions
- [Configuration Guide](/docs/configuration_guide.md) - Detailed configuration options
- [Development Guide](/docs/development_guide.md) - Development workflow and best practices

### Architecture & Components
- [Docker Compose Structure](/docs/docker_compose.md) - Container orchestration
- [Secrets Management](/docs/secrets_management.md) - Secure credentials handling
- [Configuration Standards](/docs/configuration_standards.md) - Coding and config standards
- [Entrypoint Scripts](/docs/entrypoint_scripts.md) - Service initialization

### Features & Modules
- [Architecture Overview](/docs/overview.md)
- [Billing System](/docs/billing.md)
- [International Tax Support](/docs/international_tax_support.md)
- [Asset Management](/docs/asset_management.md)
- [Time Entry Guide](/docs/time_entry.md)
- [Workflow System](/docs/workflow/workflow-system.md)
- [TypeScript Workflow Creation](/docs/workflow/typescript-workflow-creation.md)
- [Automation Hub Guide](/docs/workflow/automation-hub-workflow-guide.md)

## Project Structure

```
alga-psa/
├── docker-compose.yaml     # Base docker configuration
├── docker-compose.ce.yaml  # Community Edition config
├── docker-compose.ee.yaml  # Enterprise Edition config
├── ee/                    # Enterprise Edition
│   └── setup/
│       └── docker-compose.yaml
├── helm/                  # Kubernetes configurations
├── hocuspocus/           # Real-time collaboration server
└── server/
    ├── public/           # Static assets
    ├── src/
    │   ├── app/         # Next.js pages
    │   ├── components/  # React components
    │   │   ├── ui/     # Shared UI components
    │   │   └── features/# Feature-specific components
    │   ├── lib/        # Core business logic
    │   └── types/      # TypeScript definitions
    └── migrations/     # Database migrations
```

## Testing

We use Vitest for testing. Run the test suite:

```bash
npm run test

# Run specific tests
npm run test -- path/to/test/file.test.ts
```

## License

This project uses multiple licenses:

- Documentation (`docs/`): Creative Commons Attribution 4.0 International License (CC BY 4.0)
- Enterprise Edition (`ee/`): See `ee/LICENSE`
- All other content: GNU Affero General Public License Version 3 (AGPL-3.0)

See [LICENSE.md](/LICENSE.md) for details.

## Contributing

We welcome contributions! Please see our [Contributing Guide](/docs/contributing.md) for details on how to get started.

---
Copyright (c) 2024 Nine Minds LLC
