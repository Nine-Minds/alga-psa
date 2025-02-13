# Open Source MSP Professional Services Automation (PSA)

A comprehensive Professional Services Automation platform designed for Managed Service Providers (MSPs). This open-source solution helps MSPs streamline operations, manage client relationships, track time and billing, and improve service delivery.

## Features

### Core Functionality
- **Asset Management**: Track and manage client assets, maintenance schedules, and relationships
- **Billing & Invoicing**: Flexible billing cycles, international tax support, and automated invoicing
- **Client Management**: Comprehensive client profiles and relationship tracking
- **Document Management**: Centralized document repository with version control
- **Project Management**: Project tracking, task management, and resource allocation
- **Support Ticketing**: Incident tracking and resolution management
- **Time Management**: Time tracking, timesheet approval, and utilization reporting
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

## Technical Architecture

- **Frontend**: Next.js application
- **Backend**: Node.js server
- **Database**: PostgreSQL with row-level security
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
