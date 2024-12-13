# Open Source MSP Professional Services Automation (PSA)

A comprehensive Professional Services Automation platform designed for Managed Service Providers (MSPs). This open-source solution helps MSPs streamline operations, manage client relationships, track time and billing, and improve service delivery.

## Quick Start Video Guide

[![Getting Started with MSP PSA](https://img.youtube.com/vi/e0Y57qy5HFA/0.jpg)](https://youtu.be/e0Y57qy5HFA)

Watch our 10-minute getting started guide to quickly understand the system's core features and setup process.

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

### Prerequisites
- Docker Compose v2
- Node.js
- PostgreSQL

### Initial Setup

1. Create and initialize the database:
```bash
node setup/create_database.js
npx knex --knexfile knexfile.cjs migrate:latest --env development
npx knex seed:run --knexfile knexfile.cjs --env development
```

2. Start the development server:
```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

3. Access the application at [http://localhost:3000](http://localhost:3000)

### Docker Deployment

Choose between Community Edition (CE) or Enterprise Edition (EE) deployment:

#### Community Edition
```bash
# From project root
docker compose -f docker-compose.yaml up
```

#### Enterprise Edition
```bash
# From project root
docker compose -f docker-compose.yaml -f ee/setup/docker-compose.yaml up
```

For development mode or specific services:
```bash
# Development mode
make sebastian-docker-dev

# Run Hocuspocus (real-time collaboration)
make hocuspocus-docker-run

# Run server only
make server-docker-run
```

## Project Structure

```
sebastian/
├── docker-compose.yaml     # Base docker configuration
├── ee/
│   └── setup/
│       └── docker-compose.yaml  # EE-specific configuration
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

## Documentation

- [Architecture Overview](docs/overview.md)
- [Getting Started Guide](docs/getting-started.md)
- [Billing System](docs/billing.md)
- [International Tax Support](docs/international_tax_support.md)
- [Asset Management](docs/asset_management.md)
- [Time Entry Guide](docs/time_entry.md)

## License

This project uses multiple licenses:

- Documentation (`docs/`): Creative Commons Attribution 4.0 International License (CC BY 4.0)
- Enterprise Edition (`ee/`): See `ee/LICENSE`
- All other content: GNU Affero General Public License Version 3 (AGPL-3.0)

See [LICENSE.md](LICENSE.md) for details.

## Contributing

We welcome contributions! Please see our [Contributing Guide](docs/contributing.md) for details on how to get started.

---
Copyright (c) 2024 Nine Minds LLC
