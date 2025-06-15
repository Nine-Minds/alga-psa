# Extension API Routing Guide

This guide explains how to implement and use the dynamic API routing system for Alga PSA extensions.

## Overview

The extension system supports dynamic API routing that allows extensions to provide custom API endpoints without hardcoding extension IDs. This is accomplished through Next.js dynamic routing patterns.

## Dynamic Extension API Pattern

### Route Structure

Extensions can provide API endpoints using the following pattern:

```
/api/extensions/[extensionId]/{endpoint-path}
```

Where:
- `[extensionId]` is the dynamic extension identifier (UUID)
- `{endpoint-path}` is the custom endpoint path defined by the extension

### Example Routes

```
/api/extensions/63a7a0dc-7836-4a5f-aa08-ecdb31b064b5/agreements
/api/extensions/63a7a0dc-7836-4a5f-aa08-ecdb31b064b5/agreements/agr-001
/api/extensions/63a7a0dc-7836-4a5f-aa08-ecdb31b064b5/statements
/api/extensions/63a7a0dc-7836-4a5f-aa08-ecdb31b064b5/sync
```

## Implementation

### 1. Creating API Route Files

Create API routes in the following directory structure:

```
server/src/app/api/extensions/[extensionId]/
├── agreements/
│   ├── route.ts
│   └── [id]/
│       └── route.ts
├── statements/
│   ├── route.ts
│   └── [id]/
│       ├── route.ts
│       └── charges/
│           └── route.ts
└── sync/
    └── route.ts
```

### 2. Route Handler Implementation

Each route handler receives the `extensionId` as a parameter:

```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: { extensionId: string } }
) {
  try {
    const { extensionId } = params;
    
    console.log(`[API] Extension ID: ${extensionId}`);
    
    // Your API logic here
    // In a real implementation, you would:
    // 1. Validate the extension ID
    // 2. Check user permissions for this extension
    // 3. Fetch/process data based on extension configuration
    
    return NextResponse.json({
      success: true,
      data: [], // Your data here
      meta: {
        extensionId
      }
    });
  } catch (error) {
    console.error('Error in API endpoint:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Operation failed' 
      },
      { status: 500 }
    );
  }
}
```

### 3. Descriptor Configuration

In your extension descriptors, use template variables for dynamic endpoints:

```json
{
  "type": "table",
  "data": {
    "key": "agreements",
    "source": "api",
    "endpoint": "/api/extensions/{{extensionId}}/agreements"
  }
}
```

### 4. Handler Implementation

In your TypeScript handlers, use the extension context for API calls:

```typescript
export async function refreshData(event: MouseEvent, context: HandlerContext) {
  try {
    // Use dynamic extension ID from context
    const response = await context.api.post(`/api/extensions/${context.extension.id}/sync`, {
      syncData: true
    });

    if (response.data.success) {
      context.ui.toast('Data refreshed successfully', 'success');
      if (context.table) {
        context.table.refresh();
      }
    }
  } catch (error) {
    console.error('Failed to refresh data:', error);
    context.ui.toast('Failed to refresh data', 'error');
  }
}
```

## Template Variable Substitution

### Available Variables

The extension system automatically substitutes the following template variables:

- `{{extensionId}}` - The current extension's UUID
- `{{params.id}}` - URL parameter (for detail routes)
- `{{params.*}}` - Any URL parameter
- `{{row.*}}` - Table row data (in table cell descriptors)

### Substitution Process

1. **Endpoint URLs**: Template variables in API endpoints are substituted before making requests
2. **Table Cells**: Template variables in table cell descriptors are substituted with row data
3. **Handler Parameters**: Template variables in handler params are substituted with context data

### Expression Evaluation

The system supports complex JavaScript expressions in templates:

```json
{
  "type": "Badge",
  "props": {
    "variant": "{{row.status === 'active' ? 'success' : row.status === 'pending' ? 'warning' : 'secondary'}}"
  },
  "children": ["{{row.status}}"]
}
```

```json
{
  "type": "span",
  "children": ["{{row.currency}} {{row.amount.toLocaleString()}}"]
}
```

## Security Considerations

### 1. Extension ID Validation

Always validate extension IDs in your API routes:

```typescript
// Validate UUID format
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!uuidRegex.test(extensionId)) {
  return NextResponse.json({ error: 'Invalid extension ID' }, { status: 400 });
}
```

### 2. Permission Checking

Implement proper permission checks:

```typescript
// Check if user has access to this extension
const hasAccess = await checkExtensionPermissions(userId, extensionId);
if (!hasAccess) {
  return NextResponse.json({ error: 'Access denied' }, { status: 403 });
}
```

### 3. Input Sanitization

Sanitize all input parameters:

```typescript
import { z } from 'zod';

const schema = z.object({
  name: z.string().max(100),
  status: z.enum(['active', 'inactive', 'pending'])
});

const validatedData = schema.parse(requestBody);
```

## Error Handling

### Standard Error Response Format

Use consistent error response formats:

```typescript
interface ErrorResponse {
  success: false;
  error: string;
  code?: string;
  details?: any;
}

interface SuccessResponse<T> {
  success: true;
  data: T;
  meta?: {
    extensionId: string;
    total?: number;
    page?: number;
  };
}
```

### Error Types

Handle common error scenarios:

```typescript
// Not found
return NextResponse.json(
  { success: false, error: 'Resource not found' },
  { status: 404 }
);

// Validation error
return NextResponse.json(
  { success: false, error: 'Invalid input', details: validationErrors },
  { status: 400 }
);

// Server error
return NextResponse.json(
  { success: false, error: 'Internal server error' },
  { status: 500 }
);
```

## Testing

### 1. Unit Testing Routes

```typescript
import { GET } from './route';
import { NextRequest } from 'next/server';

describe('Extension API Route', () => {
  it('should return data for valid extension ID', async () => {
    const request = new NextRequest('http://localhost/api/extensions/test-id/agreements');
    const params = { extensionId: 'test-extension-id' };
    
    const response = await GET(request, { params });
    const data = await response.json();
    
    expect(data.success).toBe(true);
    expect(data.meta.extensionId).toBe('test-extension-id');
  });
});
```

### 2. Integration Testing

Test the complete flow from descriptor to API:

```typescript
// Test template substitution
const descriptor = {
  endpoint: "/api/extensions/{{extensionId}}/agreements"
};

const substituted = substituteTemplate(descriptor.endpoint, {
  extensionId: 'test-id'
});

expect(substituted).toBe('/api/extensions/test-id/agreements');
```

## Best Practices

1. **Consistent Naming**: Use consistent endpoint naming conventions
2. **Version Management**: Include API versioning for future compatibility
3. **Pagination**: Implement pagination for list endpoints
4. **Caching**: Add appropriate caching headers
5. **Logging**: Include comprehensive logging for debugging
6. **Documentation**: Document all endpoints with OpenAPI/Swagger

## Migration from Static Routes

If you have existing static routes (e.g., `/api/extensions/softwareone/`), you can maintain them for backward compatibility while implementing the dynamic pattern for new features.

The dynamic routing system is designed to coexist with static routes, allowing for gradual migration.