# PRD: NX Monorepo Modularization for Alga-PSA

## Problem Statement

The Alga-PSA application is a large Next.js codebase with ~2,300+ TypeScript files organized in a monolithic structure. While npm workspaces provide some modularization, the current architecture has several limitations:

1. **Build Performance**: Full rebuilds are required even for small changes
2. **Cache Inefficiency**: No intelligent caching across builds
3. **Memory Consumption**: The entire codebase loads into memory for most operations
4. **Test Execution**: All tests run regardless of which code changed
5. **Developer Experience**: Long feedback loops slow development velocity
6. **Code Organization**: Feature boundaries are implicit, making ownership unclear

## User Value

This modularization effort will deliver:

- **Faster Builds**: Only rebuild what changed using NX's computation caching
- **Faster Tests**: Run only tests affected by code changes
- **Lower Memory Usage**: Load only relevant modules during development
- **Clearer Architecture**: Explicit feature boundaries improve maintainability
- **Better CI/CD**: Affected-based pipelines reduce deployment time
- **Team Scalability**: Clear module ownership enables parallel team development

## Goals

1. Migrate the codebase to an NX monorepo structure
2. Create horizontal slices for shared infrastructure (database, validation, types, UI)
3. Create vertical slices for major business features (billing, clients, projects, etc.)
4. Maintain all Next.js routes in a single application (Next.js requirement)
5. Convert routes to thin shims that delegate to feature modules
6. Enable NX caching and affected commands for build optimization

## Project Status (2026-01-18)

This PRD is a living document. As of **January 18, 2026**, the migration is underway and partially complete.

### What’s Done (high confidence)
- NX workspace is initialized and `nx affected` + caching are wired up.
- Horizontal slices exist and are used broadly: `@alga-psa/core`, `@alga-psa/db`, `@alga-psa/types`, `@alga-psa/validation`, `@alga-psa/ui`.
- Large parts of the codebase already import from `@alga-psa/*` packages instead of `server/src/components`.
- **All server actions under `server/src/lib/actions/**` have been moved into packages** (folder is empty). The public API is now largely `@alga-psa/<module>/actions` exports.
- **Feature packages no longer import `server/src/**` directly** (including dynamic `import('server/src/...')`), keeping module boundaries explicit for NX.
- `@alga-psa/documents` now owns its storage config/types/model primitives needed by other modules (e.g. billing PDF generation).

### What’s In Progress / Not Yet True
- Enterprise Edition packages still have a few **EE entrypoints** that load EE-only components from `ee/server/src/**` (expected until EE modularization is tackled).
- The `@alga-psa/auth` horizontal slice exists, but still mixes low-level server utilities with Next.js UI exports; prefer subpath imports (e.g. `@alga-psa/auth/rbac`) for unit tests and tooling.

### Key Risk We’re Managing
If feature packages keep importing `server/src/**`, module boundaries become implicit again and NX caching/graph value is reduced (everything depends on the Next app).

## Non-Goals

- Microservices architecture (not splitting into separate deployable services)
- Breaking API compatibility
- Rewriting business logic (only restructuring)
- Adding new features during migration
- Migrating to a different framework

## Target Users

- **Developers**: Faster feedback loops, clearer code organization
- **DevOps/CI**: Faster pipelines, better caching
- **Tech Leads**: Clear module ownership, dependency visualization

## Architecture Overview

### Horizontal Slices (Shared Infrastructure)

These modules contain cross-cutting concerns used by multiple features:

| Module | Purpose | Current Location |
|--------|---------|------------------|
| `@alga-psa/core` | Logger, config, secrets, events | `shared/core/`, `shared/events/` |
| `@alga-psa/db` | Database connections, tenant context, models | `shared/db/`, `server/src/lib/db/` |
| `@alga-psa/types` | TypeScript interfaces and types | `server/src/interfaces/`, `shared/types/` |
| `@alga-psa/validation` | Zod schemas, form validation | `server/src/lib/utils/validation.ts`, scattered |
| `@alga-psa/ui` | Shared UI components (internal app UI) | `packages/ui/` (migrated from `server/src/components/ui/`) |
| `@alga-psa/auth` | Authentication, sessions, permissions | `server/src/lib/auth/` |
| `@alga-psa/tenancy` | Tenant settings, branding, slug/domain resolution | `server/src/lib/tenant-client.ts`, `server/src/lib/actions/tenant-*/` |

### Vertical Slices (Feature Modules)

Each feature module contains its own actions, components, and domain logic:

| Module | Features Included | Component Count |
|--------|-------------------|-----------------|
| `@alga-psa/billing` | Invoicing, contracts, payments, credits, tax | 120+ |
| `@alga-psa/clients` | Clients, contacts, companies | 44 |
| `@alga-psa/projects` | Projects, tasks, phases, kanban, dependencies | 50 |
| `@alga-psa/tickets` | Support tickets, categories, SLA | 19 |
| `@alga-psa/scheduling` | Time tracking, timesheets, calendar, dispatch | 45+ |
| `@alga-psa/workflows` | Workflow engine, automation, triggers | 24 |
| `@alga-psa/documents` | Document storage, templates, sharing | 18 |
| `@alga-psa/assets` | Asset tracking, categorization, history | 37 |
| `@alga-psa/surveys` | Survey creation, responses, analytics | 25 |
| `@alga-psa/integrations` | QuickBooks, email, calendar, webhooks | 31+ |
| `@alga-psa/client-portal` | Client-facing portal interface | 42 |

### Module Structure

Each feature module follows this structure:

```
packages/<feature>/
├── src/
│   ├── actions/       # Server actions
│   ├── components/    # React components
│   ├── hooks/         # Custom hooks
│   ├── lib/           # Domain logic, services
│   ├── types/         # Feature-specific types
│   └── index.ts       # Public exports
├── package.json
├── tsconfig.json
└── project.json       # NX project configuration
```

### Dependency Direction

```
                    ┌─────────────────┐
                    │   Next.js App   │
                    │ (server/src/app)│
                    └────────┬────────┘
                             │ imports
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  @alga-psa/     │ │  @alga-psa/     │ │  @alga-psa/     │
│    billing      │ │    projects     │ │    clients      │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │ imports
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  @alga-psa/ui   │ │ @alga-psa/types │ │ @alga-psa/auth  │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │ imports
                    ┌────────┴────────┐
                    ▼                 ▼
           ┌─────────────────┐ ┌─────────────────┐
           │  @alga-psa/db   │ │ @alga-psa/core  │
           └─────────────────┘ └─────────────────┘
```

**Rules**:
1. Feature modules can import horizontal slices
2. Feature modules should NOT import other feature modules directly
3. Cross-feature communication goes through shared types or events
4. Next.js app imports feature modules and composes routes
5. **Desired end-state:** Feature modules should NOT import `server/src/**` directly; server internals must be exposed via horizontal slices (or moved into the owning feature package).

### Temporary Shim Policy (Migration Only)
During migration we may introduce short-lived shims to keep the build moving (e.g., a local module that re-exports a moved function so many call sites don’t need immediate edits). These are allowed only if:
- they are explicitly tracked in `features.json` as debt to remove
- they are not treated as “done” for the underlying migration
- they are removed once the owning horizontal slice / feature module has the real implementation

## Migration Strategy

### Phase 1: Foundation (Horizontal Slices)
1. Initialize NX workspace alongside existing npm workspaces
2. Create `@alga-psa/core` from existing `shared/` package
3. Create `@alga-psa/db` from database utilities
4. Create `@alga-psa/types` from interface files
5. Create `@alga-psa/validation` from validation utilities
6. Create `@alga-psa/ui` as the internal app UI package (keep `@alga-psa/ui-kit` separate for SDK/extension-template consumers)
7. Create `@alga-psa/auth` from auth utilities

### Phase 2: First Feature Module (Proof of Concept)
8. Create `@alga-psa/clients` as first vertical slice
9. Migrate client-related actions, components, and logic
10. Update Next.js routes to use the new module
11. Validate NX caching and affected commands work

### Phase 3: Core Business Features
12. Create `@alga-psa/billing` (largest feature)
13. Create `@alga-psa/projects`
14. Create `@alga-psa/tickets`

### Phase 4: Supporting Features
15. Create `@alga-psa/scheduling`
16. Create `@alga-psa/workflows`
17. Create `@alga-psa/documents`
18. Create `@alga-psa/assets`
19. Create `@alga-psa/surveys`
20. Create `@alga-psa/integrations`
21. Create `@alga-psa/client-portal`

### Phase 5: Optimization
22. Configure NX remote caching
23. Set up affected-based CI pipelines
24. Optimize build and test performance
25. Document module boundaries and contribution guidelines

## Technical Considerations

### Next.js Routes
All Next.js routes remain in `server/src/app/` but become thin shims:

```typescript
// Before: server/src/app/msp/clients/page.tsx
import { ClientsList } from 'server/src/components/clients/ClientsList';
export default function ClientsPage() {
  return <ClientsList />;
}

// After: server/src/app/msp/clients/page.tsx
import { ClientsList } from '@alga-psa/clients';
export default function ClientsPage() {
  return <ClientsList />;
}
```

### Enterprise Edition (EE)
The CE/EE separation pattern is maintained:
- Each feature module can have `oss/` and `ee/` subdirectories
- Webpack/build config swaps implementations based on `EDITION` env var
- Existing pattern in `packages/` provides the template

### Database & Tenant Context
The `@alga-psa/db` module handles:
- Knex configuration
- Tenant context via AsyncLocalStorage
- `createTenantKnex()` function
- `withTransaction()` helper

### Import Aliases
Configure TypeScript path aliases:
```json
{
  "paths": {
    "@alga-psa/core": ["packages/core/src"],
    "@alga-psa/db": ["packages/db/src"],
    "@alga-psa/billing": ["packages/billing/src"],
    // ... etc
  }
}
```

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing functionality | Incremental migration with backwards compatibility |
| Circular dependencies between modules | Strict dependency direction rules, NX boundary checks |
| Build configuration complexity | Use NX generators for consistent setup |
| Developer learning curve | Documentation, examples, team training |
| CI/CD pipeline changes | Phased rollout, parallel pipelines during transition |

## Acceptance Criteria / Definition of Done

### Phase 1 Complete When:
- [ ] NX workspace initialized
- [ ] All 6 horizontal slice modules created
- [ ] Existing code compiles with new module structure
- [ ] `nx graph` shows correct dependency visualization

### Phase 2 Complete When:
- [ ] `@alga-psa/clients` module fully functional
- [ ] Client routes use new module
- [ ] NX caching verified (second build is instant)
- [ ] `nx affected:test` only runs client tests when client code changes

### Full Migration Complete When:
- [ ] All 11 feature modules created and functional
- [ ] All Next.js routes are thin shims
- [ ] No direct imports from `server/src/components/` in routes
- [ ] CI pipeline uses `nx affected` commands
- [ ] Build time reduced by >50% for incremental changes
- [ ] Test time reduced by >50% for incremental changes
- [ ] Documentation complete for module contribution guidelines
