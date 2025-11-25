# Alga PSA Monorepo Build System

## Overview

This document describes the monorepo build architecture for Alga PSA, designed for cache-efficient incremental builds using Turborepo.

## Architecture

### Package Types

The monorepo is organized into three categories:

#### 1. Horizontal Slices (Shared Infrastructure)

These packages are used across all feature packages:

| Package | Location | Purpose |
|---------|----------|---------|
| `@alga-psa/database` | `packages/database` | Database connection management, Knex configuration, tenant context |
| `@alga-psa/shared` | `shared/` | Core utilities, logging, types, workflow engine |
| `@alga-psa/ui-kit` | `packages/ui-kit` | Shared UI components, design system |

#### 2. Vertical Slices (Feature Packages)

Each feature package is a self-contained module with its own:
- Types/interfaces
- Server actions
- React components
- Data repositories
- API route handlers

| Package | Location | Domain |
|---------|----------|--------|
| `@alga-psa/feature-contacts` | `features/contacts` | Contact management |
| `@alga-psa/feature-clients` | `features/clients` | Client/company management |
| `@alga-psa/feature-projects` | `features/projects` | Project management |
| `@alga-psa/feature-tickets` | `features/tickets` | Ticket/issue tracking |
| `@alga-psa/feature-time-entry` | `features/time-entry` | Time tracking |
| `@alga-psa/feature-invoicing` | `features/invoicing` | Invoicing and billing |
| `@alga-psa/feature-scheduling` | `features/scheduling` | Calendar and appointments |
| `@alga-psa/feature-assets` | `features/assets` | Asset management |
| `@alga-psa/feature-users` | `features/users` | User and role management |
| `@alga-psa/feature-workflows` | `features/workflows` | Automation and workflows |

#### 3. App Shell

| Package | Location | Purpose |
|---------|----------|---------|
| `server` | `server/` | Next.js app with App Router (composes features) |
| `ee/server` | `ee/server/` | Enterprise Edition overlays |

## Directory Structure

```
alga-psa/
├── turbo.json                    # Turborepo configuration
├── package.json                  # Root workspace config
├── tsconfig.base.json           # Shared TypeScript config
│
├── server/                       # Next.js App Shell
│   ├── src/
│   │   └── app/                 # App Router (imports from features)
│   ├── next.config.mjs
│   └── package.json
│
├── packages/                     # Horizontal slices
│   ├── database/                # Database access layer
│   ├── ui-kit/                  # Shared UI components
│   └── product-*/               # Existing product packages
│
├── features/                     # Vertical feature slices
│   ├── contacts/
│   ├── clients/
│   ├── projects/
│   ├── tickets/
│   ├── time-entry/
│   └── ...
│
├── shared/                       # @alga-psa/shared
├── services/                     # Background services
├── sdk/                          # Client SDKs
└── ee/                           # Enterprise Edition
```

## Feature Package Structure

Each feature package follows this structure:

```
features/contacts/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # Public exports
    ├── types/
    │   └── index.ts          # Type definitions & Zod schemas
    ├── actions/
    │   └── index.ts          # Server actions
    ├── components/
    │   └── index.ts          # React components
    ├── repositories/
    │   └── index.ts          # Data access layer
    └── api/
        └── index.ts          # API route handlers
```

## Dependency Graph

```
                    ┌─────────────────┐
                    │     server      │
                    │   (App Shell)   │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ feature-contacts│ │ feature-tickets │ │ feature-projects│
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
     ┌─────────────────┐           ┌─────────────────┐
     │   @alga-psa/    │           │   @alga-psa/    │
     │    database     │           │     shared      │
     └─────────────────┘           └─────────────────┘
```

## Build System

### Turborepo Pipeline

The build system uses Turborepo for:

1. **Incremental builds**: Only rebuild packages that changed
2. **Remote caching**: Share build cache across CI/CD
3. **Parallel execution**: Run independent tasks concurrently
4. **Dependency-aware ordering**: Respect `^build` dependencies

### Tasks

| Task | Description | Caching |
|------|-------------|---------|
| `build` | Full production build | Yes |
| `build:ce` | Community Edition build | Yes |
| `build:ee` | Enterprise Edition build | Yes |
| `dev` | Development server | No |
| `lint` | ESLint | Yes |
| `test` | Run tests | Yes |
| `typecheck` | TypeScript type checking | Yes |
| `clean` | Remove build artifacts | No |

### Running Builds

```bash
# Full build (uses cache)
npm run build

# Build specific package
npm run build -- --filter=@alga-psa/feature-contacts

# Build with dependencies
npm run build -- --filter=@alga-psa/feature-contacts...

# Build dependents (packages that depend on this one)
npm run build -- --filter=...@alga-psa/database

# Force rebuild (ignore cache)
npm run build -- --force

# Dry run (see what would be built)
npm run build -- --dry-run
```

## Cache Strategy

### Local Cache

Turborepo maintains a local cache in `.turbo/` and `node_modules/.cache/turbo/`:

- Build outputs (`.next/`, `dist/`)
- Lint results
- Test results

### Remote Cache (Optional)

For CI/CD and team sharing, configure Vercel Remote Cache:

```bash
npx turbo login
npx turbo link
```

Or self-host with Turborepo Remote Cache server.

### Cache Inputs

Each task declares its inputs. Changes to these files invalidate the cache:

```json
{
  "build": {
    "inputs": [
      "$TURBO_DEFAULT$",  // All source files
      ".env*",            // Environment files
      "!.env*.local"      // Exclude local overrides
    ]
  }
}
```

## Migration Path

### Phase 1: Foundation (Current)

1. ✅ Add Turborepo configuration
2. ✅ Create `@alga-psa/database` package
3. ✅ Create example feature package (`contacts`)
4. ✅ Update root `package.json` with new scripts

### Phase 2: Extract Features

For each feature domain (contacts, clients, projects, etc.):

1. Create feature package structure
2. Move types from `server/src/interfaces/` to `features/X/src/types/`
3. Move actions from `server/src/lib/actions/X-actions/` to `features/X/src/actions/`
4. Move repositories from `server/src/lib/repositories/` to `features/X/src/repositories/`
5. Update imports in server to use feature packages
6. Add to `transpilePackages` in `next.config.mjs`

### Phase 3: Optimize

1. Configure remote caching for CI/CD
2. Fine-tune task inputs for better cache hits
3. Add feature-specific test configurations
4. Set up parallel test execution

## Code Duplication Strategy

The architecture prioritizes build efficiency over strict DRY principles:

### Allowed Duplication

- Type re-exports in feature packages (for convenience)
- Test utilities within feature packages
- Simple helper functions (<10 lines)

### Must Share

- Database connection management (`@alga-psa/database`)
- Core types and interfaces (`@alga-psa/shared`)
- UI components (`@alga-psa/ui-kit`)
- Authentication and authorization logic

### Evaluation Criteria

When deciding whether to share code:

1. **Cache impact**: Will sharing increase cache invalidation frequency?
2. **Build time**: How much does this code add to build time?
3. **Change frequency**: How often does this code change?
4. **Consumer count**: How many packages need this code?

If a piece of code changes frequently and has many consumers, consider duplicating it to improve cache efficiency.

## Best Practices

### Package Dependencies

1. Feature packages should only depend on horizontal slices
2. Feature packages should NOT depend on other feature packages
3. The server app shell composes features

### Imports

```typescript
// Good: Import from feature package
import { createContact, Contact } from '@alga-psa/feature-contacts';

// Good: Import database utilities
import { getConnection, withTransaction } from '@alga-psa/database';

// Avoid: Cross-feature imports
import { something } from '@alga-psa/feature-tickets'; // In feature-contacts
```

### Testing

Each feature package includes its own tests:

```bash
# Test specific feature
npm run test -- --filter=@alga-psa/feature-contacts

# Test all features
npm run test -- --filter='./features/*'
```

## Environment Variables

### Global (affect all packages)

- `NODE_ENV`
- `DATABASE_URL`
- `REDIS_URL`

### Build-specific

- `EDITION` - `ce` or `ee`
- `NEXT_PUBLIC_EDITION` - `community` or `enterprise`

These are declared in `turbo.json` to ensure proper cache invalidation when they change.

## Troubleshooting

### Cache Miss Investigation

```bash
# See why a package was rebuilt
npx turbo build --filter=@alga-psa/feature-contacts --summarize

# View the run summary
cat .turbo/runs/[run-id].json
```

### Common Issues

1. **Unexpected rebuilds**: Check `inputs` in `turbo.json`
2. **Missing dependencies**: Ensure `dependsOn: ["^build"]` is set
3. **Environment variable changes**: Add to `env` array in task config
