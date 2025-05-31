# Extension Registry Implementation

This document outlines the implementation of the Extension Registry, the core component responsible for managing the lifecycle of extensions in Alga PSA.

## Overview

The Extension Registry manages:
- Loading and registering extensions
- Initializing extensions with proper context
- Managing extension lifecycle (enable, disable, update)
- Providing access to extension capabilities
- Enforcing security and isolation boundaries

## Core Implementation

### Directory Structure

```
server/
└── src/
    └── lib/
        └── extensions/
            ├── index.ts                   # Main exports
            ├── registry.ts                # Extension registry
            ├── validator.ts               # Manifest validator
            ├── context.ts                 # Extension context
            ├── sandbox.ts                 # Execution sandbox
            ├── storage.ts                 # Extension storage
            └── ui/
                ├── ExtensionSlot.tsx      # UI extension point
                ├── ExtensionRenderer.tsx  # Component renderer
                └── ExtensionProvider.tsx  # Context provider
```

### Extension Registry Implementation

```typescript
// server/src/lib/extensions/registry.ts

import { z } from 'zod';
import { validateManifest } from './validator';
import { createExtensionContext } from './context';
import { TenantContext } from '../tenant';
import { logger } from '../utils/logger';
import { db } from '../db';

/**
 * Extension Status enum
 */
export enum ExtensionStatus {
  REGISTERED = 'registered',
  INITIALIZED = 'initialized',
  ACTIVE = 'active',
  DISABLED = 'disabled',
  ERROR = 'error',
}

/**
 * Extension record stored in database
 */
export interface ExtensionRecord {
  id: string;
  tenant_id: string | null;
  name: string;
  version: string;
  manifest: any;
  status: ExtensionStatus;
  error?: string;
  settings?: any;
  installed_at: Date;
  updated_at: Date;
}

/**
 * Runtime extension instance
 */
export interface ExtensionInstance {
  id: string;
  tenantId: string | null;
  name: string;
  version: string;
  manifest: any;
  status: ExtensionStatus;
  error?: string;
  api: any; // The extension's exposed API
  dispose: () => Promise<void>; // Function to clean up resources
}

/**
 * Extension Registry class
 */
export class ExtensionRegistry {
  private instances: Map<string, ExtensionInstance> = new Map();
  private tenantExtensions: Map<string, Set<string>> = new Map();
  private systemExtensions: Set<string> = new Set();
  
  /**
   * Initialize the extension registry
   */
  async initialize() {
    logger.info('Initializing extension registry');
    await this.loadRegisteredExtensions();
  }
  
  /**
   * Load all registered extensions from the database
   */
  private async loadRegisteredExtensions() {
    try {
      const extensions = await db('extensions')
        .select('*')
        .where('status', 'not in', [ExtensionStatus.ERROR, ExtensionStatus.DISABLED]);
      
      logger.info(`Loading ${extensions.length} extensions`);
      
      for (const extension of extensions) {
        try {
          await this.loadExtension(extension);
        } catch (error) {
          logger.error(`Failed to load extension ${extension.id}`, { error });
          await this.markExtensionError(extension.id, String(error));
        }
      }
    } catch (error) {
      logger.error('Failed to load registered extensions', { error });
    }
  }
  
  /**
   * Load a single extension
   */
  private async loadExtension(record: ExtensionRecord) {
    const manifest = record.manifest;
    
    try {
      // Validate manifest
      validateManifest(manifest);
      
      // Determine extension type (system or tenant)
      const isTenantExtension = record.tenant_id !== null;
      
      // Import the extension module
      const extensionModule = await this.importExtensionModule(record.id, manifest.main);
      
      // Create extension context
      const context = await createExtensionContext(record.tenant_id, manifest.permissions);
      
      // Initialize the extension
      const api = await extensionModule.initialize(context);
      
      // Register the extension instance
      const instance: ExtensionInstance = {
        id: record.id,
        tenantId: record.tenant_id,
        name: record.name,
        version: record.version,
        manifest,
        status: ExtensionStatus.INITIALIZED,
        api,
        dispose: async () => {
          try {
            await extensionModule.deactivate();
          } catch (error) {
            logger.error(`Error during extension disposal: ${record.id}`, { error });
          }
        },
      };
      
      // Store instance
      this.instances.set(record.id, instance);
      
      // Add to tenant or system registry
      if (isTenantExtension && record.tenant_id) {
        if (!this.tenantExtensions.has(record.tenant_id)) {
          this.tenantExtensions.set(record.tenant_id, new Set());
        }
        this.tenantExtensions.get(record.tenant_id)!.add(record.id);
      } else {
        this.systemExtensions.add(record.id);
      }
      
      // Mark as active
      await this.updateExtensionStatus(record.id, ExtensionStatus.ACTIVE);
      
      logger.info(`Extension loaded: ${record.id} (${record.version})`);
    } catch (error) {
      logger.error(`Failed to load extension ${record.id}`, { error });
      await this.markExtensionError(record.id, String(error));
      throw error;
    }
  }
  
  /**
   * Import an extension module
   */
  private async importExtensionModule(extensionId: string, mainPath: string) {
    // Implementation will depend on how extensions are stored and loaded
    // This is a placeholder for the actual implementation
    
    // For example:
    // return import(`/path/to/extensions/${extensionId}/${mainPath}`);
    
    // For development, we might use dynamic import:
    return {
      initialize: async (context: any) => {
        logger.info(`Initializing extension ${extensionId}`);
        return { /* extension API */ };
      },
      deactivate: async () => {
        logger.info(`Deactivating extension ${extensionId}`);
      },
    };
  }
  
  /**
   * Update extension status in database
   */
  private async updateExtensionStatus(extensionId: string, status: ExtensionStatus) {
    await db('extensions')
      .where('id', extensionId)
      .update({
        status,
        updated_at: new Date(),
      });
    
    // Update in-memory instance if exists
    const instance = this.instances.get(extensionId);
    if (instance) {
      instance.status = status;
    }
  }
  
  /**
   * Mark an extension as having an error
   */
  private async markExtensionError(extensionId: string, errorMessage: string) {
    await db('extensions')
      .where('id', extensionId)
      .update({
        status: ExtensionStatus.ERROR,
        error: errorMessage,
        updated_at: new Date(),
      });
    
    // Update in-memory instance if exists
    const instance = this.instances.get(extensionId);
    if (instance) {
      instance.status = ExtensionStatus.ERROR;
      instance.error = errorMessage;
    }
  }
  
  /**
   * Get all extensions for a tenant
   */
  getExtensionsForTenant(tenantId: string): ExtensionInstance[] {
    const extensions: ExtensionInstance[] = [];
    
    // Add system-wide extensions
    for (const extensionId of this.systemExtensions) {
      const instance = this.instances.get(extensionId);
      if (instance && instance.status === ExtensionStatus.ACTIVE) {
        extensions.push(instance);
      }
    }
    
    // Add tenant-specific extensions
    const tenantExtensionIds = this.tenantExtensions.get(tenantId);
    if (tenantExtensionIds) {
      for (const extensionId of tenantExtensionIds) {
        const instance = this.instances.get(extensionId);
        if (instance && instance.status === ExtensionStatus.ACTIVE) {
          extensions.push(instance);
        }
      }
    }
    
    return extensions;
  }
  
  /**
   * Get an extension by ID
   */
  getExtension(extensionId: string, tenantId?: string): ExtensionInstance | undefined {
    const instance = this.instances.get(extensionId);
    
    // Check if extension exists and is active
    if (!instance || instance.status !== ExtensionStatus.ACTIVE) {
      return undefined;
    }
    
    // Check tenant access
    if (tenantId && instance.tenantId && instance.tenantId !== tenantId) {
      return undefined;
    }
    
    return instance;
  }
  
  /**
   * Install a new extension
   */
  async installExtension(
    manifest: any, 
    files: { [path: string]: Buffer }, 
    tenantId: string | null = null
  ): Promise<string> {
    try {
      // Validate manifest
      validateManifest(manifest);
      
      // Check if extension already exists
      const existing = await db('extensions')
        .where('id', manifest.id)
        .andWhere('tenant_id', tenantId)
        .first();
      
      if (existing) {
        throw new Error(`Extension ${manifest.id} already exists for this tenant`);
      }
      
      // Store extension files
      await this.storeExtensionFiles(manifest.id, files);
      
      // Record in database
      const [extensionId] = await db('extensions').insert({
        id: manifest.id,
        tenant_id: tenantId,
        name: manifest.name,
        version: manifest.version,
        manifest,
        status: ExtensionStatus.REGISTERED,
        installed_at: new Date(),
        updated_at: new Date(),
      });
      
      // Load the extension
      await this.loadExtension({
        id: manifest.id,
        tenant_id: tenantId,
        name: manifest.name,
        version: manifest.version,
        manifest,
        status: ExtensionStatus.REGISTERED,
        installed_at: new Date(),
        updated_at: new Date(),
      });
      
      return manifest.id;
    } catch (error) {
      logger.error(`Failed to install extension`, { error, manifest });
      throw error;
    }
  }
  
  /**
   * Store extension files
   */
  private async storeExtensionFiles(extensionId: string, files: { [path: string]: Buffer }) {
    // Implementation depends on how extensions are stored
    // This is a placeholder for the actual implementation
    logger.info(`Storing files for extension ${extensionId}`);
  }
  
  /**
   * Uninstall an extension
   */
  async uninstallExtension(extensionId: string, tenantId: string | null = null): Promise<void> {
    const instance = this.instances.get(extensionId);
    
    // Check tenant access
    if (tenantId && instance?.tenantId && instance.tenantId !== tenantId) {
      throw new Error('Access denied: Cannot uninstall extension from another tenant');
    }
    
    // Disable the extension
    await this.disableExtension(extensionId);
    
    // Clean up extension files
    await this.removeExtensionFiles(extensionId);
    
    // Remove from database
    await db('extensions')
      .where('id', extensionId)
      .andWhere('tenant_id', tenantId)
      .delete();
    
    // Remove from in-memory registry
    this.instances.delete(extensionId);
    
    // Remove from tenant map if applicable
    if (tenantId && this.tenantExtensions.has(tenantId)) {
      this.tenantExtensions.get(tenantId)!.delete(extensionId);
    } else {
      this.systemExtensions.delete(extensionId);
    }
    
    logger.info(`Extension uninstalled: ${extensionId}`);
  }
  
  /**
   * Remove extension files
   */
  private async removeExtensionFiles(extensionId: string) {
    // Implementation depends on how extensions are stored
    // This is a placeholder for the actual implementation
    logger.info(`Removing files for extension ${extensionId}`);
  }
  
  /**
   * Enable an extension
   */
  async enableExtension(extensionId: string, tenantId: string | null = null): Promise<void> {
    // Check if extension exists
    const extension = await db('extensions')
      .where('id', extensionId)
      .andWhere('tenant_id', tenantId)
      .first();
    
    if (!extension) {
      throw new Error(`Extension ${extensionId} not found`);
    }
    
    // Load the extension if not already loaded
    if (!this.instances.has(extensionId)) {
      await this.loadExtension(extension);
    }
    
    // Update status
    await this.updateExtensionStatus(extensionId, ExtensionStatus.ACTIVE);
    
    logger.info(`Extension enabled: ${extensionId}`);
  }
  
  /**
   * Disable an extension
   */
  async disableExtension(extensionId: string): Promise<void> {
    const instance = this.instances.get(extensionId);
    
    if (instance) {
      // Call dispose function
      await instance.dispose();
      
      // Update status
      await this.updateExtensionStatus(extensionId, ExtensionStatus.DISABLED);
      
      logger.info(`Extension disabled: ${extensionId}`);
    }
  }
  
  /**
   * Update an extension
   */
  async updateExtension(
    extensionId: string, 
    manifest: any, 
    files: { [path: string]: Buffer }, 
    tenantId: string | null = null
  ): Promise<void> {
    try {
      // Check if extension exists
      const extension = await db('extensions')
        .where('id', extensionId)
        .andWhere('tenant_id', tenantId)
        .first();
      
      if (!extension) {
        throw new Error(`Extension ${extensionId} not found`);
      }
      
      // Validate manifest
      validateManifest(manifest);
      
      // Disable current instance
      await this.disableExtension(extensionId);
      
      // Update files
      await this.removeExtensionFiles(extensionId);
      await this.storeExtensionFiles(extensionId, files);
      
      // Update database record
      await db('extensions')
        .where('id', extensionId)
        .andWhere('tenant_id', tenantId)
        .update({
          name: manifest.name,
          version: manifest.version,
          manifest,
          status: ExtensionStatus.REGISTERED,
          updated_at: new Date(),
        });
      
      // Load updated extension
      const updatedExtension = await db('extensions')
        .where('id', extensionId)
        .andWhere('tenant_id', tenantId)
        .first();
      
      await this.loadExtension(updatedExtension);
      
      logger.info(`Extension updated: ${extensionId} to version ${manifest.version}`);
    } catch (error) {
      logger.error(`Failed to update extension ${extensionId}`, { error });
      throw error;
    }
  }
  
  /**
   * Dispose all extensions
   * Used during system shutdown
   */
  async disposeAll(): Promise<void> {
    logger.info('Disposing all extensions');
    
    const promises = Array.from(this.instances.values()).map(async (instance) => {
      try {
        await instance.dispose();
      } catch (error) {
        logger.error(`Error disposing extension ${instance.id}`, { error });
      }
    });
    
    await Promise.all(promises);
    
    this.instances.clear();
    this.tenantExtensions.clear();
    this.systemExtensions.clear();
    
    logger.info('All extensions disposed');
  }
}

// Export singleton instance
export const extensionRegistry = new ExtensionRegistry();
```

### Extension Context Factory

```typescript
// server/src/lib/extensions/context.ts

import { ApiClient } from '../api/client';
import { ExtensionLogger } from './logger';
import { ExtensionStorage } from './storage';
import { ExtensionEventBus } from './events';
import { ExtensionUIComponents } from './ui/components';

/**
 * Extension context provided at initialization
 */
export interface ExtensionContext {
  /**
   * Current tenant ID or null for system-wide extensions
   */
  tenantId: string | null;
  
  /**
   * API client with extension's permissions
   */
  apiClient: ApiClient;
  
  /**
   * Logging facility for the extension
   */
  logger: ExtensionLogger;
  
  /**
   * Extension-specific storage
   */
  storage: ExtensionStorage;
  
  /**
   * Event subscription/publishing
   */
  events: ExtensionEventBus;
  
  /**
   * UI component library
   */
  uiComponents: ExtensionUIComponents;
}

/**
 * Create an extension context for a given tenant and permissions
 */
export async function createExtensionContext(
  tenantId: string | null,
  permissions: any
): Promise<ExtensionContext> {
  // Create API client with appropriate permissions
  const apiClient = new ApiClient({
    tenantId,
    permissions,
  });
  
  // Create logger instance for this extension
  const logger = new ExtensionLogger(tenantId);
  
  // Create storage instance
  const storage = new ExtensionStorage(tenantId);
  
  // Create event bus instance
  const events = new ExtensionEventBus(tenantId);
  
  // Create UI components instance
  const uiComponents = new ExtensionUIComponents();
  
  return {
    tenantId,
    apiClient,
    logger,
    storage,
    events,
    uiComponents,
  };
}
```

### UI Extension Slot Component

```tsx
// server/src/lib/extensions/ui/ExtensionSlot.tsx

import React, { useContext, useEffect, useState } from 'react';
import { ExtensionContext } from '../context';
import { TenantContext } from '../../context/TenantContext';
import { extensionRegistry } from '../registry';
import { ExtensionRenderer } from './ExtensionRenderer';

export interface ExtensionSlotProps {
  /**
   * Name of the extension slot
   */
  slotName: string;
  
  /**
   * Type of entity if this is an entity-specific slot
   */
  entityType?: 'company' | 'contact' | 'ticket' | 'project' | 'invoice' | 'asset';
  
  /**
   * Entity ID if this is an entity-specific slot
   */
  entityId?: string;
  
  /**
   * Additional context data to pass to the extension
   */
  context?: Record<string, any>;
  
  /**
   * CSS className for the slot container
   */
  className?: string;
}

/**
 * Extension Slot Component
 * 
 * Renders UI extensions registered for a specific slot
 */
export const ExtensionSlot: React.FC<ExtensionSlotProps> = ({
  slotName,
  entityType,
  entityId,
  context = {},
  className,
}) => {
  const { tenant } = useContext(TenantContext);
  const [extensions, setExtensions] = useState<any[]>([]);
  
  useEffect(() => {
    if (!tenant?.id) return;
    
    // Get all extensions for this tenant
    const tenantExtensions = extensionRegistry.getExtensionsForTenant(tenant.id);
    
    // Filter extensions that implement this slot
    const slotExtensions = tenantExtensions.filter((ext) => {
      // Check if the extension has UI extension points
      if (!ext.manifest.extensionPoints?.ui) {
        return false;
      }
      
      // Different slot types are in different arrays
      let matchingComponents: any[] = [];
      
      switch (slotName) {
        case 'navigation':
          matchingComponents = ext.manifest.extensionPoints.ui.navItems || [];
          break;
        case 'dashboard':
          matchingComponents = ext.manifest.extensionPoints.ui.dashboardWidgets || [];
          break;
        case 'entityPage':
          matchingComponents = (ext.manifest.extensionPoints.ui.entityPages || [])
            .filter((ep: any) => !entityType || ep.entityType === entityType);
          break;
        case 'actionMenu':
          matchingComponents = (ext.manifest.extensionPoints.ui.actionMenus || [])
            .filter((ep: any) => !entityType || ep.entityType === entityType);
          break;
        default:
          return false;
      }
      
      return matchingComponents.length > 0;
    });
    
    setExtensions(slotExtensions);
  }, [tenant?.id, slotName, entityType]);
  
  if (!extensions.length) {
    return null;
  }
  
  return (
    <div className={className}>
      {extensions.map((extension) => (
        <ExtensionRenderer
          key={extension.id}
          extension={extension}
          slotName={slotName}
          entityType={entityType}
          entityId={entityId}
          context={context}
        />
      ))}
    </div>
  );
};
```

### Extension Renderer Component

```tsx
// server/src/lib/extensions/ui/ExtensionRenderer.tsx

import React, { useState, useEffect } from 'react';
import { ErrorBoundary } from '../ErrorBoundary';

interface ExtensionRendererProps {
  extension: any;
  slotName: string;
  entityType?: string;
  entityId?: string;
  context?: Record<string, any>;
}

/**
 * Extension Renderer Component
 * 
 * Renders an extension's UI component in a sandboxed environment
 */
export const ExtensionRenderer: React.FC<ExtensionRendererProps> = ({
  extension,
  slotName,
  entityType,
  entityId,
  context = {},
}) => {
  const [Component, setComponent] = useState<React.ComponentType<any> | null>(null);
  const [error, setError] = useState<Error | null>(null);
  
  useEffect(() => {
    // Find the appropriate component based on slot and entity type
    const findComponent = async () => {
      try {
        let componentPath = '';
        let componentProps = {};
        
        switch (slotName) {
          case 'navigation':
            const navItem = extension.manifest.extensionPoints.ui.navItems?.find(
              (item: any) => true // We're rendering all nav items
            );
            componentPath = navItem?.component || '';
            componentProps = { navItem };
            break;
            
          case 'dashboard':
            const widget = extension.manifest.extensionPoints.ui.dashboardWidgets?.find(
              (item: any) => true // We're rendering all dashboard widgets
            );
            componentPath = widget?.component || '';
            componentProps = { widget };
            break;
            
          case 'entityPage':
            const page = extension.manifest.extensionPoints.ui.entityPages?.find(
              (item: any) => !entityType || item.entityType === entityType
            );
            componentPath = page?.component || '';
            componentProps = { page, entityId };
            break;
            
          case 'actionMenu':
            const menuItem = extension.manifest.extensionPoints.ui.actionMenus?.find(
              (item: any) => !entityType || item.entityType === entityType
            );
            componentPath = menuItem?.component || '';
            componentProps = { menuItem, entityId };
            break;
        }
        
        if (!componentPath) {
          throw new Error(`No component found for slot ${slotName}`);
        }
        
        // Load the component
        // This is a placeholder - actual implementation depends on how extensions are loaded
        const ExtensionComponent = await import(
          `/extensions/${extension.id}/${componentPath}`
        );
        
        setComponent(() => (props: any) => (
          <ExtensionComponent.default 
            {...props} 
            {...componentProps}
            context={{
              ...context,
              entityType,
              entityId,
            }}
          />
        ));
      } catch (err) {
        console.error(`Error loading extension component: ${extension.id}`, err);
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    };
    
    findComponent();
  }, [extension.id, slotName, entityType, entityId]);
  
  if (error) {
    return (
      <div className="extension-error">
        <p>Error loading extension: {extension.name}</p>
        <p className="extension-error-message">{error.message}</p>
      </div>
    );
  }
  
  if (!Component) {
    return <div className="extension-loading">Loading {extension.name}...</div>;
  }
  
  return (
    <ErrorBoundary
      fallback={(error) => (
        <div className="extension-error">
          <p>Error in extension: {extension.name}</p>
          <p className="extension-error-message">{error.message}</p>
        </div>
      )}
    >
      <div className="extension-container" data-extension-id={extension.id}>
        <Component />
      </div>
    </ErrorBoundary>
  );
};
```

## Database Schema

Extensions will require the following database tables:

### Extensions Table

```sql
CREATE TABLE extensions (
  id VARCHAR(255) NOT NULL,
  tenant UUID NULL,
  name VARCHAR(255) NOT NULL,
  version VARCHAR(50) NOT NULL,
  manifest JSONB NOT NULL,
  status VARCHAR(50) NOT NULL,
  error TEXT NULL,
  settings JSONB NULL,
  installed_at TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
  PRIMARY KEY (id, tenant),
  CONSTRAINT fk_tenant FOREIGN KEY (tenant) REFERENCES tenants(tenant)
);

CREATE INDEX idx_extensions_tenant ON extensions(tenant);
CREATE INDEX idx_extensions_status ON extensions(status);
```

### Extension Data Table

```sql
CREATE TABLE extension_data (
  extension_id VARCHAR(255) NOT NULL,
  tenant UUID NULL,
  key VARCHAR(255) NOT NULL,
  value JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
  PRIMARY KEY (extension_id, tenant, key),
  CONSTRAINT fk_extension FOREIGN KEY (extension_id, tenant) REFERENCES extensions(id, tenant)
);

CREATE INDEX idx_extension_data_extension ON extension_data(extension_id, tenant);
```

## Security Considerations

The registry implements the following security measures:

1. **Tenant Isolation**
   - Extensions are scoped to specific tenants
   - System-wide extensions are carefully reviewed
   - Extension storage is isolated by tenant

2. **Permissions Enforcement**
   - Extensions can only access APIs they declare permissions for
   - User permissions are checked before rendering UI extensions
   - Tenant admin approval required for sensitive operations

3. **Resource Limiting**
   - CPU time limits for extension code execution
   - Memory limits to prevent excessive resource usage
   - Rate limiting for API calls

4. **Error Isolation**
   - Extensions run in error boundaries to prevent crashing the main app
   - Failed extensions are disabled automatically
   - Error reporting with detailed context

## Next Implementation Steps

1. **Manifest Validation Service**
   - Implement Zod schema validation
   - Add version compatibility checking
   - Create security review process for sensitive permissions

2. **Extension Storage System**
   - Implement key-value storage for extensions
   - Add tenant isolation for extension data
   - Create storage quota management

3. **Extension UI Framework**
   - Build ExtensionSlot component
   - Implement component loading system
   - Create UI component library for extensions

4. **API Extension System**
   - Create middleware system for request/response interception
   - Implement custom endpoint registration
   - Add permission checking for API access