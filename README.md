# Alga PSA: Open-Source MSP Professional Services Automation

Alga PSA is a professional services automation platform built for Managed Service Providers. It brings client records, service tickets, time tracking, contracts, billing, invoicing, documents, assets, reporting, and automation into one MSP-focused system.

It is designed for teams that want more control over their PSA stack: self-hostable Community Edition code, a modern TypeScript/PostgreSQL architecture, and an Enterprise Edition path for commercially licensed modules and larger deployments.

<a href="https://www.nineminds.com/AlgaPSA-features">
  <img src="https://www.nineminds.com/imported-media/Overview%20Dashboard.png" alt="Alga PSA overview dashboard" width="900">
</a>

[See the Alga PSA feature tour](https://www.nineminds.com/AlgaPSA-features)

## Why MSPs look at Alga PSA

MSP operations break down when tickets, contracts, time, and invoices live in separate tools. Teams lose billable time, service managers chase updates, and owners have a harder time seeing whether client work is profitable.

Alga PSA is built around the way MSPs operate with clients:

- **Tickets tied to clients, contacts, assets, and service history** so the team has context before work starts.
- **Time and approvals connected to billing** so billable work can move toward invoices with less duplicate entry.
- **Contracts, sales quotes, recurring services, tax, and invoice workflows** for the financial side of service delivery.
- **Client portal and document workflows** so clients have a clearer place to submit requests, view information, and follow progress.
- **Workflow automation** for turning repeatable ticket, billing, notification, and approval steps into managed processes with Event Catalog triggers and scheduled runs.
- **Open-source core with self-hosting support** so MSPs and technical teams can keep control over deployment, data, and code review.

Community Edition is the self-hostable AGPL core. Enterprise Edition covers commercially licensed modules and larger deployment needs. See [Editions and licensing](#editions-and-licensing) for details.

## Features at a glance

### Service desk and client operations

- Support ticketing for client requests, incidents, and follow-up work
- Client, contact, and company management
- Multilingual client portal support for separate MSP and client-facing access
- Email notifications for tickets, invoices, and project updates
- Document management with version control
- Asset management for client equipment, maintenance schedules, and relationships
- Project and task management for longer-running client work
- Scheduling and dispatch views for planned work and technician coordination

### Time, contracts, billing, and invoicing

- Time tracking with approval workflows and utilization reporting
- Automatic interval tracking for ticket work, stored in the browser with IndexedDB
- Conversion of tracked intervals into time entries
- Flexible billing cycles by company, including weekly, bi-weekly, monthly, and quarterly billing
- Billing-period support for proration and unapproved time rollover
- Contract purchase order support with PO numbers and advisory PO limits
- Sales quotes for pricing proposals, optional line items, approvals, client portal acceptance, and conversion to contracts or invoices
- Graphical invoice and quote designer for branded PDF layouts, data-bound fields, line-item tables, preview, and per-document template overrides
- International tax support with composite rates, thresholds, tax holidays, and reverse charge scenarios

### Automation, reporting, and controls

- Workflow Automation with an Event Catalog for ticket, billing, scheduling, email, project, CRM, asset, document, and integration triggers
- Visual workflow designer for event-driven, one-time scheduled, recurring scheduled, and manual runs, with versioning and run history
- Redis-backed event processing for asynchronous work and system events
- Reporting and analytics for operational visibility
- Role-based access control (RBAC) and attribute-based access control (ABAC)
- Multi-portal authentication for MSP users and client portal users
- API, OpenAPI registry material, and extension SDK support for integrations and custom workflows

Feature availability varies by edition, deployment configuration, and enabled feature flags. See the setup and architecture docs for implementation details.

## Product screenshots

These images link directly to screenshots from the [Alga PSA feature tour](https://www.nineminds.com/AlgaPSA-features), [Workflow Automation docs](https://www.nineminds.com/documentation/152-choosing-workflow-triggers), and [Invoice Designer docs](https://www.nineminds.com/documentation/1419-building-an-invoice-layout).

<table>
  <thead>
    <tr>
      <th width="50%" align="center">Core workflow</th>
      <th width="50%" align="center">Business operations</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td width="50%"><img src="https://www.nineminds.com/imported-media/Ticketing-1.gif" alt="Alga PSA ticketing screen" width="420"></td>
      <td width="50%"><img src="https://www.nineminds.com/imported-media/Billing%20Cycles.png" alt="Alga PSA billing dashboard" width="420"></td>
    </tr>
    <tr>
      <td width="50%">Ticketing views for client requests, assignment, attachments, and follow-up.</td>
      <td width="50%">Contracts, billing, and invoice-related workflows in one billing area.</td>
    </tr>
    <tr>
      <td width="50%"><img src="https://www.nineminds.com/imported-media/Screenshot%202026-04-30%20at%2011.33.51%E2%80%AFAM.png" alt="Alga PSA multilingual client portal" width="420"></td>
      <td width="50%"><img src="https://www.nineminds.com/imported-media/Screenshot%202026-05-01%20at%201.35.35%20PM.png" alt="Alga PSA time approval screen" width="420"></td>
    </tr>
    <tr>
      <td width="50%">Multilingual client portal views for client-facing requests and updates.</td>
      <td width="50%">Time entry views for recording and reviewing work before billing.</td>
    </tr>
    <tr>
      <td width="50%"><img src="https://www.nineminds.com/imported-media/Schedule%20view.png" alt="Alga PSA schedule view" width="420"></td>
      <td width="50%"><img src="https://www.nineminds.com/docs-images/invoice-designer-workspace.png" alt="Alga PSA invoice and quote designer workspace" width="420"></td>
    </tr>
    <tr>
      <td width="50%">Schedule views for dispatch and calendar-based work planning.</td>
      <td width="50%">Drag-and-drop invoice and quote layout designer for branded PDFs.</td>
    </tr>
    <tr>
      <td width="50%"><img src="https://www.nineminds.com/docs-images/workflow-designer-ticket-triage.png" alt="Alga PSA visual workflow designer" width="420"></td>
      <td width="50%"><img src="https://www.nineminds.com/imported-media/Assets%20Asset%20workspace%20overview.png" alt="Alga PSA asset workspace overview" width="420"></td>
    </tr>
    <tr>
      <td width="50%">Visual workflow designer for ticket triage, notifications, approvals, and other repeatable processes.</td>
      <td width="50%">Asset views for client equipment and service context.</td>
    </tr>
  </tbody>
</table>

## Quick start

For a full installation, use the [Complete Setup Guide](docs/getting-started/setup_guide.md). It covers release selection, secrets, environment configuration, Docker Compose, initial login credentials, persistence, backups, and production notes.

The current CE prebuilt Docker Compose path is below. Before running these commands, follow the setup guide to create the required `secrets/` directory and `server/.env` file.

The stack boots PostgreSQL, the Next.js application server, and the workflow worker. On first start, the server creates a seeded workspace admin account; tail the logs below to retrieve the credentials.

```bash
git clone https://github.com/nine-minds/alga-psa.git
cd alga-psa

./scripts/set-image-tag.sh

docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
  --env-file server/.env --env-file .env.image up -d
```

The prebuilt stack creates named volumes for PostgreSQL data and uploaded files so data survives container restarts and upgrades. See the setup guide for backup and restore procedures.

After the first successful boot, the server logs print a seeded workspace admin account. Tail the logs and update the password before using the system in production.

```bash
docker compose -f docker-compose.prebuilt.base.yaml -f docker-compose.prebuilt.ce.yaml \
  --env-file server/.env --env-file .env.image logs -f
```

### Requirements

- Docker Engine 24.0.0 or later
- Docker Compose v2.20.0 or later
- Git
- Node.js `>=20 <25` for source development

For Windows-specific setup, see the [Windows Setup Guide](docs/getting-started/setup_guide_windows.md).

## Technical architecture

The following details are for teams evaluating the technical stack. For deployment requirements, see [Quick start](#quick-start).

Alga PSA is a TypeScript monorepo with a Next.js application, shared domain packages, worker services, and Docker-based deployment paths.

| Area | Implementation |
| --- | --- |
| Frontend | Next.js application with React, Tailwind, Radix-based components, and shared UI packages |
| Backend | Next.js API routes running on Node.js, shared domain packages, and a dedicated workflow worker service |
| Database | PostgreSQL with row-level security for tenant isolation |
| Event processing | Redis-backed event bus with Zod schema validation for asynchronous system events |
| Workflow execution | Temporal-backed workflow runtime and worker services for event-triggered, scheduled, and manual workflow runs |
| Real-time collaboration | Hocuspocus/Yjs for collaborative document editing |
| Authentication | NextAuth.js with separate MSP and client portal access surfaces |
| Packages | npm workspaces and Nx-managed `@alga-psa/*` packages for billing, clients, tickets, documents, scheduling, reporting, integrations, and shared infrastructure |
| Deployment | Docker Compose for CE/EE stacks, named volumes for PostgreSQL and files, Docker secrets, PgBouncer, and Helm assets for Kubernetes-oriented deployments |
| Extensions and API | Extension SDK, client SDK docs, API docs, and OpenAPI registry material for integrations and custom workflows |

Useful technical docs:

- [Architecture Overview](docs/architecture/overview.md)
- [Package Build System](docs/architecture/package-build-system.md)
- [Docker Compose Structure](docs/getting-started/docker_compose.md)
- [Secrets Management](docs/security/secrets_management.md)
- [API Overview](docs/api/api_overview.md)
- [OpenAPI Registry Integration](docs/openapi/registry-integration.md)
- [Client SDK](docs/client-sdk/README.md)
- [Inbound Email](docs/inbound-email/README.md)
- [Testing Standards](docs/reference/testing-standards.md)

## Documentation

### Setup and configuration

- [Complete Setup Guide](docs/getting-started/setup_guide.md)
- [Windows Setup Guide](docs/getting-started/setup_guide_windows.md)
- [Configuration Guide](docs/getting-started/configuration_guide.md)
- [Development Guide](docs/getting-started/development_guide.md)
- [Entrypoint Scripts](docs/getting-started/entrypoint_scripts.md)

### MSP feature areas

- [Billing System](docs/billing/billing.md)
- [Invoice Templates](docs/billing/invoice_templates.md)
- [Quoting System](docs/billing/quoting-system.md)
- [International Tax Support](docs/billing/tax/international_tax_support.md)
- [Asset Management](docs/features/asset_management.md)
- [SLA Management](docs/features/sla.md)
- [Time Entry Guide](docs/features/time_entry.md)
- [Workflow Automation for MSPs](https://www.nineminds.com/documentation/151-workflow-automation-for-msps)
- [Choosing Workflow Triggers](https://www.nineminds.com/documentation/152-choosing-workflow-triggers)
- [Building Your First MSP Workflow](https://www.nineminds.com/documentation/153-building-your-first-msp-workflow)
- [Publishing and Monitoring Workflows](https://www.nineminds.com/documentation/156-publishing-monitoring-workflows)

### Development and contribution

- [Contributing Guide](docs/contributing.md)
- [Configuration Standards](docs/getting-started/configuration_standards.md)
- [Package Build System](docs/architecture/package-build-system.md)
- [Testing Standards](docs/reference/testing-standards.md)

## Project structure

```text
alga-psa/
├── server/                  # Next.js application server
│   ├── src/app/             # App routes and API routes
│   ├── src/components/      # React components
│   └── src/lib/             # Core application logic
├── packages/                # Shared @alga-psa/* packages
│   ├── billing/             # Billing, invoicing, tax
│   ├── clients/             # Client management
│   ├── tickets/             # Ticketing domain code
│   ├── db/                  # Database connection and tenant context
│   ├── event-schemas/       # Event contracts and validation
│   ├── ui/                  # Shared UI component library
│   └── ...                  # Domain and infrastructure packages
├── ee/                      # Enterprise Edition code and licensed modules
├── services/                # Background services, including workflow-worker
├── hocuspocus/              # Real-time collaboration server
├── sdk/                     # Extension SDK and samples
├── extensions/              # Extension examples and supporting code
├── helm/                    # Kubernetes deployment assets
├── redis/                   # Redis configuration
├── pgbouncer/               # PostgreSQL connection pooling configuration
├── setup/                   # Bootstrap and installation scripts
├── scripts/                 # Build, release, and utility scripts
├── tools/                   # Developer and automation tooling
└── docs/                    # Product, setup, architecture, and developer docs
```

## Development and testing

Install dependencies and run tests from the repository root. Source development requires Node.js `>=20 <25`.

```bash
npm install
npm run test:local

# Run specific tests
npm run test:local -- path/to/test/file.test.ts
```

For development workflow details, package build behavior, and test conventions, see:

- [Development Guide](docs/getting-started/development_guide.md)
- [Package Build System](docs/architecture/package-build-system.md)
- [Testing Standards](docs/reference/testing-standards.md)

## Editions and licensing

Alga PSA uses multiple licenses:

- Documentation (`docs/`): Creative Commons Attribution 4.0 International License (CC BY 4.0)
- Enterprise Edition (`ee/`): See `ee/LICENSE`
- All other content: GNU Affero General Public License Version 3 (AGPL-3.0)

See [LICENSE.md](LICENSE.md) for details. If your deployment model requires commercial terms or a license outside the AGPL core, visit [algapsa.com](https://algapsa.com) for Enterprise Edition and hosted deployment information.

## Contributing

Contributions are welcome. Start with the [Contributing Guide](docs/contributing.md) for development setup, coding expectations, pull request guidance, and module conventions.

---
Copyright (c) 2026 Nine Minds LLC
