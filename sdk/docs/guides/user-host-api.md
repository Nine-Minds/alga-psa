# User Host API Guide

This guide explains how to use the `cap:user.read` capability to access current user information in your extension.

## Overview

The User Host API allows extensions to retrieve information about the currently authenticated user making the request. This is useful for:

- **Personalization**: Customize responses based on the user's identity
- **Audit logging**: Track which user triggered an action
- **Authorization**: Make decisions based on user type (MSP vs client)
- **Multi-tenant awareness**: Access tenant and client context

## Prerequisites

The `cap:user.read` capability is included in the default capabilities for all extensions, so you don't need to explicitly declare it. However, if you're customizing capabilities, ensure it's included:

```json
{
  "capabilities": ["cap:user.read", "cap:log.emit"]
}
```

## API Reference

### UserHost Interface

```typescript
interface UserHost {
  getUser(): Promise<UserData>;
}
```

### Types

```typescript
interface UserData {
  /** Tenant ID the user belongs to */
  tenantId: string;
  /** Client/company name */
  clientName: string;
  /** Unique user identifier */
  userId: string;
  /** User's email address */
  userEmail: string;
  /** User's display name */
  userName: string;
  /** User type: "internal" (MSP staff) or "client" (client portal user) */
  userType: string;
}

type UserError = 'not-available' | 'not-allowed';
```

## Usage Examples

### Basic Usage

```typescript
try {
  const user = await host.user.getUser();
  console.log(`Request from: ${user.userName} (${user.userEmail})`);
  console.log(`User type: ${user.userType}`);
} catch (err) {
  // User info not available (e.g., service-to-service call)
  console.log('No user context available');
}
```

### Conditional Logic Based on User Type

```typescript
const user = await host.user.getUser();

if (user.userType === 'internal') {
  // MSP staff - show full data
  return jsonResponse({
    data: allRecords,
    canEdit: true
  });
} else {
  // Client portal user - show filtered data
  return jsonResponse({
    data: filteredRecords,
    canEdit: false
  });
}
```

### Including User Info in Responses

```typescript
export async function handler(request: ExecuteRequest, host: HostBindings): Promise<ExecuteResponse> {
  let user = null;
  try {
    user = await host.user.getUser();
  } catch {
    // Continue without user info
  }

  return jsonResponse({
    ok: true,
    message: 'Hello from extension',
    user: user ? {
      name: user.userName,
      email: user.userEmail,
      type: user.userType,
    } : null,
  });
}
```

## Setting Up Host Bindings

To use the User API (or any host capability), your extension needs a wrapper that imports the WIT functions. Create an `index.ts` that builds the `HostBindings` object:

```typescript
// src/index.ts
import { handler as userHandler } from './handler-impl.js';
import { ExecuteRequest, ExecuteResponse, HostBindings } from '@alga-psa/extension-runtime';

// Import WIT functions (these are resolved at runtime by jco)
// @ts-ignore
import { getUser } from 'alga:extension/user';
// @ts-ignore
import { logInfo, logWarn, logError } from 'alga:extension/logging';
// @ts-ignore
import { getContext } from 'alga:extension/context';
// ... other imports as needed

// Build the HostBindings object
const host: HostBindings = {
  context: {
    get: async () => getContext(),
  },
  logging: {
    info: async (msg: string) => logInfo(msg),
    warn: async (msg: string) => logWarn(msg),
    error: async (msg: string) => logError(msg),
  },
  user: {
    getUser: async () => getUser(),
  },
  // ... other bindings
};

// Export WIT-compatible handler
export async function handler(request: ExecuteRequest): Promise<ExecuteResponse> {
  return userHandler(request, host);
}
```

## Build Configuration

When using WIT imports, your build must mark them as external. Add a custom build script to `package.json`:

```json
{
  "scripts": {
    "build:backend": "esbuild src/index.ts --bundle --format=esm --platform=neutral --outfile=dist/js/index.js --external:alga:extension/secrets --external:alga:extension/http --external:alga:extension/storage --external:alga:extension/logging --external:alga:extension/ui-proxy --external:alga:extension/context --external:alga:extension/user",
    "build:component": "jco componentize dist/js/index.js --wit ./wit/extension-runner.wit --world-name runner --disable all --out dist/main.wasm",
    "build": "npm run build:backend && npm run build:component"
  },
  "devDependencies": {
    "@bytecodealliance/jco": "^1.8.0",
    "esbuild": "^0.20.0"
  }
}
```

## WIT Definition

Ensure your `wit/extension-runner.wit` includes the user interface:

```wit
record user-data {
    tenant-id: string,
    client-name: string,
    user-id: string,
    user-email: string,
    user-name: string,
    user-type: string,
}

enum user-error {
    not-available,
    not-allowed,
}

interface user {
    get-user: func() -> result<user-data, user-error>;
}

world runner {
    // ... other imports
    import user;

    export handler: func(request: execute-request) -> execute-response;
}
```

## Error Handling

The `getUser()` function can throw errors in these cases:

| Error | Cause |
|-------|-------|
| `not-available` | No user session (e.g., service-to-service call, scheduled task) |
| `not-allowed` | The `cap:user.read` capability was not granted |

Always wrap `getUser()` in a try-catch:

```typescript
let userName = 'Anonymous';
try {
  const user = await host.user.getUser();
  userName = user.userName;
} catch (err) {
  await host.logging.info('No user context available for this request');
}
```

## When User Info Is Not Available

User information is extracted from the session. It will be `null` or throw `not-available` in these scenarios:

- **Scheduled task invocations**: Tasks run by the scheduler don't have a user session
- **Service-to-service calls**: API calls using `x-alga-tenant` header instead of session
- **Webhook callbacks**: External systems calling your extension endpoints

Design your extension to handle both authenticated and unauthenticated contexts gracefully.

## Security Notes

- User data is read-only; extensions cannot modify user information
- The `cap:user.read` capability is granted by default but can be revoked
- User IDs are tenant-scoped and may differ across tenants
- Do not expose sensitive user information to client-side code

## See Also

- [Scheduler Host API Guide](./scheduler-host-api.md)
- [Sample Client Portal Extension](../../../ee/extensions/samples/client-portal-test/)
- [Extension Runtime Reference](../../extension-runtime/)
