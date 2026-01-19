# NX Monorepo Modularization - Scratchpad

---
## ⚠️ CRITICAL INSTRUCTION FOR CLAUDE ⚠️

**DO NOT CHEAT.** When implementing features:

0. **Work in large chunks before lint/build.** Prefer moving a whole coherent slice (e.g. an entire folder or feature) and fixing imports broadly. Only run lint/tests/build at the end of a large unit of work (or when truly blocked). Constant lint/build cycles are too expensive and slow the migration dramatically.
1. **Actually move/copy the files** - don't just create re-exports from the old location
2. **Update imports in the moved files** - fix relative imports to work in new location
3. **Update consumers** - change imports in files that use the moved code
4. **If you defer work**, add a NEW feature entry to features.json for that deferred work
5. **Only mark "implemented": true** when the actual migration is complete, not just scaffolding

If you have the choice between an easy path (re-exports) and the right path (actual migration),
**ALWAYS choose the right path**. If you need to defer harder work to later iterations,
add explicit new features to track that work - don't just drop it or pretend it's done.

### Temporary Shim Exception (Migration Only)
If a “shim” is required to keep work moving (e.g. to avoid editing dozens of call sites immediately), it must be:
- treated as temporary and minimal (no long-lived architecture)
- tracked explicitly in `features.json` (with a removal task)
- removed once the owning package/horizontal slice has the real implementation

---

## Analysis Summary (2026-01-15)

### Current Codebase Metrics
- **Total TypeScript/TSX files**: ~2,300+
- **Components**: 777 files across 42 domain directories
- **Lib (actions, models, services, utils)**: 685 files
- **API Routes**: 510 files
- **Interfaces**: 52 files

### Existing Modular Patterns
The codebase already uses npm workspaces with this structure:
```json
"workspaces": [
  "server",
  "ee/server",
  "services/workflow-worker",
  "services/imap-service",
  "shared",
  "packages/*",
  "sdk/*"
]
```

### Existing Packages (15 total)
Located in `/packages/`:
1. `product-auth-ee` - Enterprise auth
2. `product-billing` - Billing features
3. `product-chat` - Chat functionality
4. `product-client-portal-domain` - Client portal domain logic
5. `product-email-domains` - Email domain management (consolidated into `@alga-psa/integrations/email`)
6. `product-email-providers` - Email provider integrations (consolidated into `@alga-psa/integrations/email`)
7. `product-email-settings` - Email configuration (consolidated into `@alga-psa/integrations/email`)
8. `product-ext-proxy` - Extension proxy
9. `product-extension-actions` - Extension server actions
10. `product-extension-initialization` - Extension init
11. `product-extensions-pages` - Extension pages
12. `product-extensions` - Core extensions
13. `product-settings-extensions` - Settings extensions
14. `product-workflows` - Workflow engine
15. `ui-kit` - UI component library

### Shared Library Structure
`@alga-psa/shared` exports:
- `./types` - Type definitions
- `./core` - Logger, secret provider
- `./db` - Database utilities, admin, connection
- `./events/publisher.js` - Event publishing
- `./utils/encryption.js` - Encryption utilities
- `./workflow` - Workflow core, persistence, streams
- `./models/*` - Shared models (client, contact, tag, ticket, user)
- `./extensions/*` - Extension domain, installs, types

---

## Identified Feature Domains

### Large Domains (>30 component files)
| Domain | Files | Notes |
|--------|-------|-------|
| billing-dashboard | 120 | Invoices, contracts, payments, credits |
| settings | 86 | System configuration |
| ui | 81 | Shared UI components |
| projects | 50 | Project management, kanban, tasks |
| client-portal | 42 | Client-facing portal |
| assets | 37 | Asset management |
| time-management | 32 | Time tracking, timesheets |
| clients | 32 | Client profiles |

### Medium Domains (10-30 files)
- surveys (25), workflows (24), user-activities (21)
- tickets (19), documents (18), contacts (12)
- technician-dispatch (13), auth (12), layout (11)
- integrations (11)

---

## Proposed Module Architecture

### Horizontal Slices (Shared Infrastructure)
1. **@alga-psa/core** - Existing shared package, enhance with:
   - Logger, config, secrets
   - Event publisher
   - Encryption utilities

2. **@alga-psa/db** - Database layer
   - Knex configuration
   - Tenant context management
   - Connection pooling
   - Base model patterns

3. **@alga-psa/types** - Type definitions
   - All interface files
   - Shared types across features

4. **@alga-psa/validation** - Validation logic
   - Zod schemas
   - Form validation utilities
   - Business rule validators

5. **@alga-psa/ui** - UI component library
   - Enhance existing ui-kit
   - All shared UI components

6. **@alga-psa/auth** - Authentication
   - Auth strategies
   - Session management
   - Permission utilities

### Vertical Slices (Feature Modules)
1. **@alga-psa/billing** - Billing & Contracts
   - Invoicing
   - Contracts/contract lines
   - Payments
   - Credits
   - Tax management

2. **@alga-psa/clients** - Client Management
   - Client profiles
   - Contacts
   - Companies
   - Client relationships

3. **@alga-psa/projects** - Project Management
   - Projects
   - Tasks/phases
   - Kanban boards
   - Dependencies
   - Resource allocation

4. **@alga-psa/tickets** - Ticket/Issue Tracking
   - Support tickets
   - Categories
   - SLA management

5. **@alga-psa/scheduling** - Scheduling & Time
   - Time tracking
   - Timesheets
   - Calendar
   - Technician dispatch
   - Schedule entries

6. **@alga-psa/workflows** - Workflow Automation
   - Workflow engine
   - Triggers
   - Actions
   - Automation rules

7. **@alga-psa/documents** - Document Management
   - Document storage
   - Templates
   - Sharing

8. **@alga-psa/assets** - Asset Management
   - Asset tracking
   - Categorization
   - Service history

9. **@alga-psa/surveys** - Surveys
   - Survey creation
   - Responses
   - Analytics

10. **@alga-psa/integrations** - Third-party Integrations
    - QuickBooks
    - Email providers
    - Calendar providers
    - Webhooks

11. **@alga-psa/client-portal** - Client Portal
    - Portal UI
    - Portal-specific features
    - External access

---

## Key Decisions

### Decision 1: NX vs Enhanced npm Workspaces
**Decision**: Use NX
**Rationale**:
- Existing npm workspaces show modular thinking is established

### Note: Vitest + Workspace Resolution (2026-01-15)
Some dev/test setups may not have newly-added `@alga-psa/*` workspace packages linked into `node_modules`. For Vitest runs from the repo root, add explicit Vite/Vitest aliases (in `server/vitest.config.ts`) pointing `@alga-psa/*` imports to `packages/*/src` to keep unit tests runnable without reinstalling dependencies.

### Note: Root tsconfig.json (2026-01-15)
Several `packages/*/tsconfig.json` files extend `../../tsconfig.json`. Ensure `tsconfig.json` exists at the repo root and extends `tsconfig.base.json` so those package configs work and editors/tools pick up the shared path aliases.

### Note: DB tenant context (2026-01-15)
The `@alga-psa/db` package now owns tenant context via `AsyncLocalStorage` (`runWithTenant`, `getTenantContext`) and exports `createTenantKnex()`. The server-side `server/src/lib/db/index.tsx` continues to handle request/session/header tenant resolution but delegates context storage to `@alga-psa/db`.

### Note: Vitest coverage temp dir (2026-01-15)
Vitest v8 coverage writes a temp directory under `server/coverage/.tmp`. Ensure it exists during test runs (created in `server/src/test/setup.ts`) to avoid occasional `ENOENT` errors when running multiple targeted tests.

### Note: Nx project.json coverage (2026-01-15)
Many `packages/*` were created without `project.json`, which prevented them from being first-class Nx projects. Added `project.json` files for all new `@alga-psa/*` packages (and `packages/ui-kit`) so `nx graph`, caching, and affected commands can reason about them.
- NX adds: computation caching, affected commands, dependency graph visualization
- Better for large codebase with 2300+ files
- Enables parallel builds and test optimization

### Note: UI package split (2026-01-16)
The existing `packages/ui-kit` is used by SDK/extension template consumers and should remain Tailwind-free to avoid breaking external usage. The app/server UI components from `server/src/components/ui` (Tailwind + Radix heavy) were migrated into a new internal package `packages/ui` (`@alga-psa/ui`), and server consumers were updated to import from `@alga-psa/ui`.

### Decision 2: Module Boundaries
**Decision**: Feature-based vertical slices over layer-based
**Rationale**:
- Aligns with existing component organization
- Enables independent deployment/testing
- Clear ownership boundaries
- Reduces cross-team conflicts

### Decision 3: Next.js Routes Location
**Decision**: Keep all routes in single `server/` project
**Rationale**:
- Next.js requirement - App Router needs single entry
- Routes become thin shims calling into feature modules
- API routes can delegate to feature modules

### Decision 4: Migration Strategy
**Decision**: Incremental, bottom-up
**Rationale**:
- Start with horizontal slices (already partially exist in `shared/`)
- Add vertical slices one feature at a time
- Maintain backwards compatibility during migration
- Can deploy incrementally

---

## Technical Constraints

1. **Next.js App Router**: All routes must remain in single project
2. **CitusDB**: Tenant column requirements affect data layer design
3. **Enterprise Edition**: CE/EE code separation must be maintained
4. **Existing Workspaces**: Must migrate, not break existing package structure

---

## Commands & References

### Useful Commands
```bash
# Current workspace structure
npm ls --workspaces

# Check package dependencies
npm -w server ls

# Run tests for specific workspace
npm -w server test
```

### Key File Paths
- Root package.json: `/package.json`
- Server package.json: `/server/package.json`
- Shared exports: `/shared/package.json`
- Coding standards: `/docs/AI_coding_standards.md`

---

## Open Questions

1. **Billing + Contracts**: Should these be one module or separate?
   - Current thinking: Combined as `@alga-psa/billing` (they're tightly coupled)

2. **Email modules**: Consolidated into `@alga-psa/integrations/email` (formerly `product-email-domains`, `product-email-providers`, `product-email-settings`).

3. **Extension packages**: 7 extension-related packages - keep as-is or consolidate?

4. **UI components**: Current ui-kit is minimal - expand or keep ui in each feature?
   - Recommendation: Expand ui-kit as `@alga-psa/ui` for all shared components

---

## Migration Order (Proposed)

### Phase 1: Foundation
1. Initialize NX workspace
2. Migrate `shared/` to `@alga-psa/core`, `@alga-psa/db`, `@alga-psa/types`
3. Create `@alga-psa/validation` from existing validation utilities
4. Expand `ui-kit` to `@alga-psa/ui`

### Phase 2: Infrastructure Features
5. Create `@alga-psa/auth` from auth actions/lib
6. Create `@alga-psa/integrations` (consolidate email packages + integrations)

### Phase 3: Core Business Features
7. Create `@alga-psa/clients` (clients + contacts)
8. Create `@alga-psa/billing` (invoicing + contracts)
9. Create `@alga-psa/projects`
10. Create `@alga-psa/tickets`

### Phase 4: Supporting Features
11. Create `@alga-psa/scheduling` (time + dispatch + calendar)
12. Create `@alga-psa/workflows`
13. Create `@alga-psa/documents`
14. Create `@alga-psa/assets`
15. Create `@alga-psa/surveys`
16. Create `@alga-psa/client-portal`

### Phase 5: Optimization
17. Configure NX caching
18. Set up affected commands for CI
19. Optimize build pipeline

---

## Implementation Notes (2026-01-16)

- **@alga-psa/types interface migration**: synced `server/src/interfaces` into `packages/types/src/interfaces`, removed duplicate/stub interface files that caused resolution ambiguity, fixed self-imports inside the types package, and added tests to validate the barrel exports. Inbound email types are exported under `Inbound*` aliases to avoid name collisions with outbound email types.
- **NX graph/tests**: `NX_DAEMON=false` avoids the earlier nx command hangs; added an integration test at `tools/nx-tests/nxWorkspace.test.ts` to validate `nx show projects`, `nx graph --file`, and generator dry-run.
- **Module boundaries**: added ESLint rule `custom-rules/no-feature-to-feature-imports` to prevent `packages/<feature>` vertical packages from importing other vertical packages via `@alga-psa/*` (validated in `tools/nx-tests/moduleBoundaries.test.ts`). `nx lint` is currently too memory-hungry (heap OOM) to use as an enforcement test in this environment.
- **npm workspace protocol**: removed `workspace:*` dependency specifiers from `packages/*/package.json` (replaced with `*`) because npm cannot install/update dependencies when `workspace:` protocol is used.
- **NX caching + affected**: added `npm run test:nx` (vitest config for `tools/nx-tests`) including a cache verification test (`nxCache.test.ts`) and an affected-project selection test (`nxAffected.test.ts`); added `npm run affected:test` and `npm run affected:build` scripts; updated `.github/workflows/typecheck.yml` to run `nx affected -t build`/`test`.
- **@alga-psa/clients vertical slice**: migrated client/contacts actions + components into `packages/clients` and updated the `/msp/clients` + `/msp/contacts` routes to import from `@alga-psa/clients` (and actions from `@alga-psa/clients/actions`); `server npm run build` passes after import rewiring.
- **Tax + client type alignment**: resolved an `ITaxRate` export collision by selectively exporting tax interfaces from `@alga-psa/types` (including `ITaxRateDetails` alias). Also aligned client/contacts typing by using `@alga-psa/types` in key action/components and allowing `client.properties` to be nullable where DB can return null.

---

## Implementation Notes (2026-01-18)

### server/src import cleanup (packages)
- Verified no remaining `from 'server/src'` or `import('server/src/...')` usages under `packages/**`.

### Documents storage self-containment
- Added missing documents storage primitives under `packages/documents/src/`:
  - `config/storage.ts` (env/secret-driven storage config + validation)
  - `types/storage.ts` (provider + file store types)
  - `models/storage.ts` (`FileStoreModel` without `BaseModel`; tenant resolved via `requireTenantId`)
- Rewired documents storage imports to stay within `packages/documents/src/**` (avoids importing files outside the package `src/` root).
- Removed `@alga-psa/users/actions` dependency from documents storage to avoid pulling incomplete user avatar utilities into core storage logic.

### Business-logic tests added
- Scheduling: `packages/scheduling/tests/timePeriodSuggester.test.ts` (run `npm -w packages/scheduling test`)
- Documents: `packages/documents/tests/storageConfig.test.ts` (run `npm -w packages/documents test`)
- Auth: adjusted `packages/auth/src/lib/exports.test.ts` to validate RBAC behavior via the subpath export `@alga-psa/auth/rbac` (keeps the test focused and avoids pulling Next.js UI modules).

### Known tooling limitation (out of scope here)
- `tsc --noEmit` in many packages currently fails with `rootDir`/project-reference issues when TypeScript path aliases pull in other package sources (example: importing `@alga-psa/tenancy/actions` from another package). Unit tests via Vitest are still runnable and used for verification.
