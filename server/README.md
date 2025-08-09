# Alga PSA Server

## Overview

Alga PSA (Professional Services Automation) is a comprehensive business management platform designed for Managed Service Providers (MSPs) and professional services organizations. This server application provides REST APIs and core business logic for managing clients, projects, tickets, billing, and more.

## Prerequisites

- **Node.js 20.0.0 or higher** (Required for modern JavaScript features and performance optimizations)
- PostgreSQL 14 or higher
- Redis (for caching and session management)
- npm or yarn package manager

## Tech Stack

- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript
- **Database**: PostgreSQL with Knex.js
- **Authentication**: API Keys for REST APIs, Session-based for web
- **Validation**: Zod schemas
- **Testing**: Vitest for unit tests, custom E2E test framework

## Key Features

- Multi-tenant architecture with complete data isolation
- Comprehensive REST API with V2 controllers
- Real-time workflow automation system
- Flexible billing and invoicing engine
- Project and ticket management
- Time tracking and approval workflows
- Asset management system
- Document management with version control
- Email integration and notifications

## Getting Started

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables (copy `.env.example` to `.env`)

4. Run database migrations:
   ```bash
   npm run migrate
   ```

5. Seed the database (development only):
   ```bash
   npm run seed
   ```

### Development

Start the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:3000`

### Testing

Run the test suite:
```bash
# All tests
npm test

# E2E tests only
npm test -- src/test/e2e/

# Specific test file
npm test -- src/test/e2e/api/test-single-contact.test.ts
```

## API Documentation

The REST API follows RESTful conventions with the following pattern:
- Base URL: `/api/v1/`
- Authentication: API Key in `X-API-KEY` header
- Response format: JSON

See `/docs/api-migration-summary.md` for detailed API migration information and patterns.

## Architecture

The application uses a modular architecture with:
- **Controllers**: Handle HTTP requests and responses
- **Services**: Business logic and data operations
- **Models**: Database entities and relationships
- **Middleware**: Authentication, authorization, error handling
- **Workflows**: Event-driven automation system

## Contributing

Please ensure all code follows the established patterns:
- Use TypeScript with strict mode
- Follow the V2 controller pattern for new APIs
- Include comprehensive E2E tests
- Validate all inputs with Zod schemas
- Handle errors consistently

## License

See LICENSE file for details.