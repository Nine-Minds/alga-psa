# @alga-psa/portal-shared

Shared infrastructure for client portal functionality.

## Purpose

This package is an **Infrastructure Layer (Layer 2)** component that provides:

- Type definitions for portal invitation management
- Re-exports of portal-related actions from `@alga-psa/client-portal`
- A shared interface that multiple domain packages can depend on without creating cross-layer dependencies

## Architecture

### Layering Solution

This package solves a layering violation where domain packages (`@alga-psa/clients` and `@alga-psa/client-portal`) were directly depending on each other.

**Before (Violation):**
```
@alga-psa/clients (Layer 3 - Domain)
        ↓ imports from ↓
@alga-psa/client-portal (Layer 3 - Domain)  ❌ Horizontal dependency!
```

**After (Fixed):**
```
@alga-psa/clients (Layer 3 - Domain)
        ↓ imports from ↓
@alga-psa/portal-shared (Layer 2 - Infrastructure)
        ↓ re-exports from ↓
@alga-psa/client-portal (Layer 3 - Domain)  ✅ Vertical dependency!
```

## Exports

### Types

```typescript
import type {
  SendInvitationResult,
  VerifyTokenResult,
  CompleteSetupResult,
  InvitationHistoryItem,
  CreateClientPortalUserParams,
} from '@alga-psa/portal-shared/types';
```

### Actions

```typescript
import {
  sendPortalInvitation,
  getPortalInvitations,
  revokePortalInvitation,
  verifyPortalToken,
  completePortalSetup,
  createClientPortalUser,
  uploadContactAvatar,
  deleteContactAvatar,
  updateClientUser,
} from '@alga-psa/portal-shared/actions';
```

## Dependencies

This package depends on:
- `@alga-psa/types` - Type definitions
- `@alga-psa/core` - Shared utilities
- `@alga-psa/db` - Database infrastructure
- `@alga-psa/email` - Email services
- `@alga-psa/tenancy` - Tenant management

And re-exports from:
- `@alga-psa/client-portal` - Portal functionality implementation

## Usage

Both domain packages can safely import from portal-shared without creating circular dependencies:

```typescript
// In @alga-psa/clients
import { sendPortalInvitation } from '@alga-psa/portal-shared/actions';

// In @alga-psa/client-portal
import type { InvitationHistoryItem } from '@alga-psa/portal-shared/types';
```

## Implementation Note

The actual implementations of these functions are in `@alga-psa/client-portal`. This package simply re-exports them to break the direct dependency chain between domain layers.

In the future, if portal functionality needs to be shared more extensively, the implementations can be moved into this package directly.
