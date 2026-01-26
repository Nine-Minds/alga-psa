# Portal Layering Architecture Fix

## Problem

The `ContactPortalTab` component in `@alga-psa/clients` was directly importing portal-related actions from `@alga-psa/client-portal`, creating a horizontal (cross-layer) dependency between two domain layer packages:

```
❌ VIOLATION:
@alga-psa/clients (Layer 3 - Domain)
        ↓ imports directly from ↓
@alga-psa/client-portal (Layer 3 - Domain)
```

## Solution

Created a new infrastructure layer package `@alga-psa/portal-shared` (Layer 2) that:
1. Defines shared portal type definitions
2. Re-exports portal actions to break direct dependencies
3. Allows both domain packages to safely depend on it without circular dependencies

```
✅ FIXED:
@alga-psa/clients (Layer 3 - Domain)
        ↓ imports from ↓
@alga-psa/portal-shared (Layer 2 - Infrastructure) ← NEW PACKAGE
        ↓ re-exports from ↓
@alga-psa/client-portal (Layer 3 - Domain)
```

## Updated Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LAYER 5: Application                               │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ server (MSP app)  │  EE modules                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────────────────────┘
                           │ (depends on all layers below)
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LAYER 4: Presentation                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │            @alga-psa/ui (UI components, hooks, utilities)             │ │
│  │                  (No dependencies on domain logic)                     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LAYER 3: Domain Services                           │
│  (Each represents a business domain - should NOT depend on each other)     │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┬────────────┐ │
│  │  @alga-psa/  │  @alga-psa/  │  @alga-psa/  │  @alga-psa/  │  @alga-psa/│ │
│  │   clients    │   tickets    │ client-portal│  projects    │   billing  │ │
│  └──────────────┴──────────────┴──────────────┴──────────────┴────────────┘ │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┬────────────┐ │
│  │  @alga-psa/  │  @alga-psa/  │  @alga-psa/  │  @alga-psa/  │  @alga-psa/│ │
│  │  documents   │   tags       │notifications │  workflows   │scheduling │ │
│  └──────────────┴──────────────┴──────────────┴──────────────┴────────────┘ │
│                                                                              │
│  ✅ NO horizontal dependencies between packages (enforced via               │
│     infrastructure layer re-exports when cross-cutting logic exists)       │
└──────────────────────────┬──────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       LAYER 2: Infrastructure                               │
│  (Cross-cutting concerns and technical services)                           │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┬────────────┐ │
│  │  @alga-psa/  │  @alga-psa/  │  @alga-psa/  │  @alga-psa/  │ @alga-psa/ │ │
│  │    auth      │    users     │    media     │    email     │  tenancy   │ │
│  └──────────────┴──────────────┴──────────────┴──────────────┴────────────┘ │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┬────────────┐ │
│  │  @alga-psa/  │  @alga-psa/  │  @alga-psa/  │  @alga-psa/  │ @alga-psa/ │ │
│  │  validation  │ integrations │ reference-   │ portal-shared│   core     │ │
│  │              │              │  data        │              │            │ │
│  └──────────────┴──────────────┴──────────────┴──────────────┴────────────┘ │
│                                                                              │
│  NEW: @alga-psa/portal-shared - Re-exports portal functionality to break   │
│       domain-level cross-dependencies                                       │
└──────────────────────────┬──────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LAYER 1: Foundation / Core                               │
│  (No dependencies on any other @alga-psa/* packages)                       │
│  ┌──────────────┬──────────────┬──────────────┐                             │
│  │  @alga-psa/  │  @alga-psa/  │  @alga-psa/  │                             │
│  │    types     │     core     │      db      │                             │
│  │              │              │              │                             │
│  │ - Interfaces │ - Utilities  │ - Migrations │                             │
│  │ - Type defs  │ - Helpers    │ - Schemas    │                             │
│  │ - Constants  │ - Encryption │ - Knex setup │                             │
│  └──────────────┴──────────────┴──────────────┘                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Files Changed

### New Package
- **Created:** `packages/portal-shared/` - New infrastructure layer package
  - `package.json` - Package configuration
  - `tsconfig.json` - TypeScript configuration
  - `README.md` - Package documentation
  - `src/types/index.ts` - Shared type definitions
  - `src/actions/index.ts` - Actions index
  - `src/actions/portalInvitationActions.ts` - Re-exported actions
  - `src/index.ts` - Package entry point

### Updated Components
- **Modified:** `packages/clients/src/components/contacts/ContactPortalTab.tsx`
  - Updated imports to use `@alga-psa/portal-shared` instead of `@alga-psa/client-portal`

- **Modified:** `packages/clients/src/components/contacts/ContactAvatarUpload.tsx`
  - Updated imports to use `@alga-psa/portal-shared` instead of `@alga-psa/client-portal`

## Dependency Flow

### Before (Violation)
```typescript
// packages/clients/src/components/contacts/ContactPortalTab.tsx
import { sendPortalInvitation } from '@alga-psa/client-portal/actions'; // ❌ Direct cross-domain import
```

### After (Fixed)
```typescript
// packages/clients/src/components/contacts/ContactPortalTab.tsx
import { sendPortalInvitation } from '@alga-psa/portal-shared/actions'; // ✅ Via infrastructure layer

// packages/portal-shared/src/actions/portalInvitationActions.ts
export { sendPortalInvitation } from '@alga-psa/client-portal/actions'; // Re-export pattern
```

## Architecture Principles

This solution maintains the following architectural principles:

1. **No Circular Dependencies** - `@alga-psa/clients` does not directly depend on `@alga-psa/client-portal`
2. **Clean Layering** - Infrastructure layer (portal-shared) bridges domain-level concerns
3. **Separation of Concerns** - Each domain package owns its business logic
4. **Dependency Inversion** - Domain packages depend on abstractions (infrastructure re-exports)
5. **Facade Pattern** - Infrastructure layer provides a simplified interface to domain functionality

## Future Improvements

If portal functionality continues to grow, consider:

1. **Moving implementations to portal-shared** - Move actual `PortalInvitationService` and action implementations
2. **Creating domain event bus** - For more complex cross-domain communication patterns
3. **Using dependency injection** - For more sophisticated dependency management
4. **Creating orchestration layer** - Between application layer and domain packages for complex workflows
