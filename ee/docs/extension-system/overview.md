# Alga PSA Client Extension System - Descriptor Architecture

## Overview

The Alga PSA Client Extension System allows developers to extend and customize the functionality of Alga PSA through a structured, secure, and maintainable API using a **descriptor-based architecture**. This approach eliminates module resolution issues, improves security, and reduces bundle sizes while providing a clear declarative interface for extension development.

## Goals

- Enable third-party developers to extend Alga PSA functionality without modifying core code
- Provide a stable, descriptor-based API that eliminates module import/resolution issues
- Maintain security, performance, and multi-tenancy across all extensions
- Support both Community Edition (CE) and Enterprise Edition (EE) with appropriate feature sets
- Use declarative descriptors instead of React components for better isolation and security
- Reduce extension bundle sizes from ~45kb to ~5kb through descriptor approach

## Core Architecture

### Extension Registry and Lifecycle

The extension system will use a centralized registry that manages the lifecycle of all installed extensions:

- **Registration**: Extensions register their capabilities, permissions, and extension points
- **Initialization**: System initializes extensions with proper context and configuration
- **Activation/Deactivation**: Enable or disable extensions as needed

### Priority Extension Points (Descriptor-Based)

We focus on these high-value extension points using descriptors:

1. **Core UI Extension Points**
   - Navigation menu additions (JSON descriptors)
   - Dashboard widgets (descriptor-based components)
   - Custom standalone pages (declarative page descriptors)

2. **Basic API Extension Points**
   - Simple custom API endpoints (handler modules)
   - Storage service integration
   - Extension context and services

### Security Model

Extensions will operate within a straightforward security model:

- **Basic Permission Model**: Extensions request specific permissions at installation
- **Tenant Isolation**: Extensions operate within tenant boundaries
- **Manual Approval**: Administrator approval before extension activation

## Focused Implementation Plan

### Phase 1: Minimum Viable Extension System

1. **Basic Extension Registry**
   - Create simple extension manifest schema and validation
   - Implement core registry with basic lifecycle management
   - Add tenant-specific extension configuration

2. **Core UI Extension System**
   - Implement extension slots for navigation and dashboard
   - Create basic extension renderer
   - Add error boundary for extension components

3. **Basic Developer Tools**
   - Create simple extension scaffolding tools
   - Build basic extension packaging tool

### Phase 2: Essential Extension Points

1. **Navigation Extensions**
   - Implement navigation extension points
   - Create navigation item renderer
   - Update main layout to include extension nav items

2. **Dashboard Widgets**
   - Implement dashboard extension slots
   - Create dashboard widget renderer
   - Update dashboard to include extension widgets

3. **Custom Pages**
   - Implement custom page extension points
   - Create dynamic route handling for extension pages
   - Add basic permission checking for custom pages

4. **Basic API Endpoints**
   - Implement simple custom endpoint registration
   - Create basic endpoint request handler
   - Add permission checking for endpoints

## Technical Implementation Details

### Descriptor-Based Extension Architecture

```typescript
// Core descriptor interface
export interface BaseDescriptor {
  id?: string;
  type: string;                               // Component type or HTML element
  props?: Record<string, any>;               // Properties to pass to component
  children?: (Descriptor | string | number)[];  // Child descriptors or content
  handlers?: Record<string, string>;          // Event handler mapping
}

// Extension manifest (simplified for descriptors)
export interface AlgaExtensionManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: { name: string; email: string };
  permissions: string[];
  tenantMode: 'all' | 'specific' | 'none';
  
  // Descriptor-based components
  components: ComponentDefinition[];
  routes?: RouteDefinition[];
  settings?: SettingDefinition[];
}

// Extension context provided to descriptors
export interface ExtensionContext {
  navigation: NavigationService;
  api: ApiService;
  storage: StorageService;
  ui: UIService;
  tenantId: string;
  user: UserInfo;
}
```

### Descriptor-Based UI Components

```typescript
// Navigation descriptor example
{
  "type": "button",
  "props": {
    "className": "nav-item"
  },
  "handlers": {
    "module": "handlers/navigation.js",
    "onClick": "navigateToPage"
  },
  "children": ["Menu Item"]
}

// Page descriptor example
{
  "type": "page",
  "meta": {
    "title": "Extension Page",
    "description": "Custom extension page"
  },
  "content": {
    "type": "div",
    "props": { "className": "page-container" },
    "children": [
      { "type": "h1", "children": ["Page Title"] },
      { "type": "DataGrid", "props": { "data": "{{agreements}}" } }
    ]
  },
  "handlers": {
    "module": "handlers/pageHandlers"
  }
}

// Handler module example
export function navigateToPage(event, context) {
  event.preventDefault();
  context.navigation.navigate('/extension/page');
}

// Descriptor renderer component
const DescriptorRenderer: React.FC<{
  descriptor: BaseDescriptor;
  handlers: Record<string, Function>;
  context: ExtensionContext;
  data?: any;
}> = ({ descriptor, handlers, context, data }) => {
  // Safely render descriptor with security validation
  const Component = getSecureComponent(descriptor.type);
  const safeProps = sanitizeProps(descriptor.props);
  
  return (
    <Component
      {...safeProps}
      {...bindEventHandlers(descriptor.handlers, handlers, context)}
    >
      {renderChildren(descriptor.children, handlers, context, data)}
    </Component>
  );
};
```

### API Extension System (Simplified)

```typescript
// Custom Endpoint Extension (simplified)
export interface APIEndpointExtension {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  handler: (req: ExtensionRequest, res: ExtensionResponse) => Promise<void>;
  permissions?: string[];
}

// Simple implementation in Next.js API routes
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { extensionId, path } = req.query;
  
  // Get extension and check if it's active
  const extension = extensionRegistry.getExtension(extensionId as string);
  if (!extension || !extension.isActive) {
    return res.status(404).json({ error: 'Extension not found or inactive' });
  }
  
  // Find matching endpoint
  const endpoint = extension.findEndpoint(path as string[], req.method as string);
  if (!endpoint) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  
  // Check permissions
  const hasPermission = await checkExtensionPermissions(extension, endpoint, req);
  if (!hasPermission) {
    return res.status(403).json({ error: 'Permission denied' });
  }
  
  // Execute endpoint handler
  try {
    await endpoint.handler(
      createExtensionRequest(req, extension),
      createExtensionResponse(res, extension)
    );
  } catch (error) {
    logger.error('Extension endpoint error', { extensionId, path, error });
    return res.status(500).json({ error: 'Extension endpoint error' });
  }
}
```

## Security Considerations (Descriptor-Based)

1. **Descriptor Security Model**
   - Only whitelisted component types and HTML elements allowed
   - Props sanitization prevents XSS and injection attacks
   - No direct React/JavaScript execution in descriptors

2. **Handler Module Security**
   - Handler modules loaded through secure blob URLs
   - Limited API surface through ExtensionContext
   - Memory management with automatic cleanup

3. **Data Access Controls**
   - Extensions operate within tenant data boundaries
   - Row-level security policies apply to extension queries
   - Storage service provides tenant-isolated data access

4. **Manual Review Process**
   - Administrator approval before extension activation
   - Descriptor validation at load time
   - Runtime security checks for all user interactions

## Extension Development Experience (Descriptor-Based)

1. **Descriptor Development Tools**
   - JSON schema validation for descriptors
   - Descriptor editor with live preview
   - Build system for handler modules
   - Extension packaging and validation

2. **Development Benefits**
   - No React imports or complex module resolution
   - Smaller bundle sizes (~5kb vs ~45kb)
   - Faster development cycle with descriptor hot-reload
   - Clear separation between UI structure and behavior

3. **Documentation**
   - Descriptor schema reference
   - Component registry documentation
   - Handler development guide
   - Migration guide from React components

## Future Vision

While this document focuses on the initial high-value implementation, our long-term vision includes:

1. **Advanced UI Integration**
   - Entity page extensions
   - Form field customizations
   - Context menu additions

2. **Enhanced API Capabilities**
   - API middleware
   - Custom authentication providers
   - Advanced security features

3. **Workflow & Data Extensions**
   - Custom workflow actions and triggers
   - Custom fields for entities
   - Custom reports and data exports

4. **Advanced Features**
   - Extension marketplace
   - Advanced developer tools
   - Analytics and monitoring

By focusing first on the core elements that provide the most immediate value, we can deliver a useful extension system quickly while setting the foundation for these advanced capabilities in the future.