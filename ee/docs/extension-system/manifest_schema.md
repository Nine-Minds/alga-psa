# Alga PSA Extension Manifest Schema - 80/20 Approach

## Overview

The extension manifest is a JSON file (`alga-extension.json`) that defines the metadata, capabilities, permissions, and extension points for an Alga PSA extension. This document outlines the focused schema for the 80/20 implementation approach.

## Core Schema

```typescript
interface AlgaExtensionManifest {
  /**
   * Unique identifier for the extension, following reverse domain notation
   * Example: "com.example.my-extension"
   */
  id: string;
  
  /**
   * Display name of the extension shown in the UI
   */
  name: string;
  
  /**
   * Semantic version of the extension
   * Must follow semver: major.minor.patch
   */
  version: string;
  
  /**
   * Detailed description of the extension's functionality
   */
  description: string;
  
  /**
   * Author information
   */
  author: {
    name: string;
    email?: string;
    url?: string;
  };
  
  /**
   * Minimum Alga PSA version required for this extension
   */
  minAppVersion: string;
  
  /**
   * Which edition(s) this extension is compatible with
   */
  editions: ('community' | 'enterprise')[];
  
  /**
   * How this extension interacts with tenants
   * - 'all': Works across all tenants (admin-level extension)
   * - 'specific': Must be enabled per-tenant
   * - 'none': System-level extension with no tenant context
   */
  tenantMode: 'all' | 'specific' | 'none';
  
  /**
   * Main entry point for the extension
   * Path is relative to the extension's root directory
   */
  main: string;
  
  /**
   * Permissions required by this extension
   */
  permissions: {
    /**
     * API access permissions
     * Follows format: "resource:action"
     * Example: "companies:read", "invoices:write"
     */
    api?: string[];
    
    /**
     * UI areas this extension can modify
     */
    ui?: {
      /**
       * Areas where the extension can add navigation items
       */
      navigation?: ('main')[];
      
      /**
       * Dashboard areas the extension can add widgets to
       */
      dashboards?: ('main')[];
    };
    
    /**
     * Role-based access control integration
     */
    rbac?: {
      /**
       * Custom permissions defined by this extension
       */
      permissions?: {
        /**
         * Unique identifier for this permission within the extension
         */
        id: string;
        
        /**
         * Optional sub-resource name (extension ID is used as the main resource)
         */
        resource?: string;
        
        /**
         * Permission action (e.g., "view", "manage", "edit")
         */
        action: string;
        
        /**
         * Human-readable description of this permission
         */
        description: string;
        
        /**
         * Optional list of role names that should be granted this permission by default
         */
        defaultRoles?: string[];
      }[];
    };
  };
  
  /**
   * Extension points this extension implements
   */
  extensionPoints: {
    /**
     * UI extension points
     */
    ui?: {
      /**
       * Navigation menu items
       */
      navItems?: {
        id: string;
        displayName: string;
        icon: string;  // Icon identifier or URL to SVG
        position?: number;  // Ordering hint
        component: string;  // Path to component relative to extension root
        permissions?: string[];  // Required user permissions to see this item
      }[];
      
      /**
       * Dashboard widgets
       */
      dashboardWidgets?: {
        id: string;
        displayName: string;
        description: string;
        defaultWidth: 'small' | 'medium' | 'large';
        defaultHeight: 'small' | 'medium' | 'large';
        component: string;
        permissions?: string[];
      }[];
      
      /**
       * Custom pages
       */
      pages?: {
        id: string;
        path: string;  // URL path for the page
        displayName: string;
        component: string;
        permissions?: string[];
      }[];
    };
    
    /**
     * API extension points
     */
    api?: {
      /**
       * Custom API endpoints
       */
      endpoints?: {
        id: string;
        path: string;
        method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
        handler: string;  // Path to handler relative to extension root
        permissions?: string[];
      }[];
    };
  };
  
  /**
   * Basic configuration schema for the extension
   */
  configurationSchema?: object;  // JSON Schema for configuration options
  
  /**
   * Default configuration values
   */
  defaultConfiguration?: object;
}
```

## Example Extension Manifest (80/20 Approach)

### Simple Dashboard and Navigation Extension

```json
{
  "id": "com.example.ticket-helper",
  "name": "Ticket Helper",
  "version": "1.0.0",
  "description": "Helps manage tickets more efficiently",
  "author": {
    "name": "Example, Inc.",
    "email": "extensions@example.com",
    "url": "https://example.com"
  },
  "minAppVersion": "1.5.0",
  "editions": ["community", "enterprise"],
  "tenantMode": "specific",
  "main": "dist/index.js",
  "permissions": {
    "api": ["tickets:read"],
    "ui": {
      "navigation": ["main"],
      "dashboards": ["main"]
    },
    "rbac": {
      "permissions": [
        {
          "id": "view-dashboard",
          "action": "view",
          "description": "View the ticket summary dashboard",
          "defaultRoles": ["admin", "manager", "technician"]
        },
        {
          "id": "manage-settings",
          "action": "manage",
          "description": "Configure the extension settings",
          "defaultRoles": ["admin"]
        },
        {
          "id": "export-data",
          "resource": "reports",
          "action": "export",
          "description": "Export ticket data from the extension",
          "defaultRoles": ["admin", "manager"]
        }
      ]
    }
  },
  "extensionPoints": {
    "ui": {
      "navItems": [
        {
          "id": "ticket-helper-nav",
          "displayName": "Ticket Helper",
          "icon": "tool",
          "component": "dist/components/TicketHelperNav.js",
          "permissions": ["view_tickets"]
        }
      ],
      "dashboardWidgets": [
        {
          "id": "ticket-summary",
          "displayName": "Ticket Summary",
          "description": "Shows a summary of recent tickets",
          "defaultWidth": "medium",
          "defaultHeight": "medium",
          "component": "dist/components/TicketSummaryWidget.js",
          "permissions": ["view_tickets"]
        }
      ],
      "pages": [
        {
          "id": "ticket-tools",
          "path": "/ticket-tools",
          "displayName": "Ticket Tools",
          "component": "dist/pages/TicketToolsPage.js",
          "permissions": ["view_tickets"]
        }
      ]
    },
    "api": {
      "endpoints": [
        {
          "id": "ticket-stats",
          "path": "stats",
          "method": "GET",
          "handler": "dist/api/getStats.js",
          "permissions": ["tickets:read"]
        }
      ]
    }
  },
  "configurationSchema": {
    "type": "object",
    "properties": {
      "refreshInterval": {
        "type": "number",
        "title": "Data refresh interval (minutes)",
        "default": 5
      }
    }
  },
  "defaultConfiguration": {
    "refreshInterval": 5
  }
}
```

## Core Validation Rules

1. **ID Format**
   - Must follow reverse domain notation
   - Only lowercase alphanumeric characters, dots, and hyphens
   - Must be unique across all installed extensions

2. **Version Format**
   - Must follow semantic versioning (major.minor.patch)

3. **Permissions**
   - Must be valid and recognized by the system
   - Should follow least-privilege principle

4. **Component Paths**
   - Must be valid paths relative to the extension's root directory
   - Files must exist and be of the correct type

5. **Tenant Mode**
   - Admin approval required for 'all' mode

## Next Steps for Implementation (80/20 Focus)

1. Create a basic extension manifest validator service
2. Implement a minimal extension loading and initialization system
3. Define the core extension SDK package for developers
4. Build a simple extension administration UI in the Alga PSA admin panel
5. Create basic extension scaffolding tools for developers

## Future Expansion

This manifest schema represents the core requirements for the 80/20 implementation. In future versions, the schema will expand to include:

1. **Advanced Security**
   - Extension signing and verification
   - Trust levels and certificate management
   - Resource limits and monitoring

2. **Enhanced Extension Points**
   - Entity page extensions
   - Form field customizations
   - Action menu integrations
   - API middleware

3. **Advanced Features**
   - Workflow integrations (actions, triggers, forms)
   - Data extensions (custom fields, reports, exports)
   - Marketplace integration

By starting with this focused schema, we can deliver value quickly while maintaining a clear path for future expansion.