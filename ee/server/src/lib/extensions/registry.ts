/**
 * Extension Registry Service
 * 
 * This service manages extension registration, initialization, and lifecycle.
 */
import { createTenantKnex } from '@/lib/db';
import logger from '@alga-psa/core/logger';
import { ExtensionStorageService } from './storage/storageService';
import {
  Extension,
  ExtensionManifest,
  ExtensionContext,
  ExtensionComponentType,
  ExtensionComponentDefinition,
  ExtensionInitOptions,
  ExtensionRegistry as IExtensionRegistry
} from './types';
import { validateManifestV2 } from './schemas/manifest-v2.schema';
import {
  ExtensionError,
  ExtensionNotFoundError,
  ExtensionValidationError,
  ExtensionDisabledError,
  ExtensionPermissionError,
  ExtensionDependencyError,
  ExtensionComponentNotFoundError
} from './errors';

/**
 * Extension Registry Service implementation
 */
export class ExtensionRegistry implements IExtensionRegistry {
  private storage: Map<string, ExtensionStorageService> = new Map();
  private knex: any;

  constructor(knexInstance: any) {
    this.knex = knexInstance;
  }

  /**
   * Register a new extension with the system
   */
  async registerExtension(
    manifest: ExtensionManifest,
    options: ExtensionInitOptions
  ): Promise<Extension> {
    // Validate against Manifest v2
    const v2 = validateManifestV2(manifest);
    if (!v2.valid) {
      throw new ExtensionValidationError(
        'Invalid extension manifest (v2)',
        (v2.errors || []).map((msg) => ({ path: '', message: msg }))
      );
    }

    // Check for existing extension with the same name
    const existingExtension = await this.getExtensionByName(
      manifest.name,
      options
    );

    if (existingExtension) {
      // Update existing extension
      const [updated] = await this.knex('extensions')
        .where({
          id: existingExtension.id,
          tenant_id: options.tenant_id
        })
        .update({
          version: manifest.version,
          description: manifest.description || null,
          manifest: JSON.stringify(manifest),
          updated_at: new Date()
        })
        .returning('*');

      // Update permissions
      const permissionsArray = this.extractPermissionsArray(manifest.permissions);
      await this.updateExtensionPermissions(updated.id, permissionsArray);

      return {
        ...updated,
        manifest: manifest
      };
    }

    // Create new extension
    const [extension] = await this.knex('extensions')
      .insert({
        tenant_id: options.tenant_id,
        name: manifest.name,
        description: manifest.description || null,
        version: manifest.version,
        manifest: JSON.stringify(manifest),
        is_enabled: manifest.autoEnable || false // Use autoEnable from manifest
      })
      .returning('*');

    // Register permissions
    const permissionsArray = this.extractPermissionsArray(manifest.permissions);
    if (permissionsArray.length > 0) {
      await this.updateExtensionPermissions(extension.id, permissionsArray);
    }

    return {
      ...extension,
      manifest: manifest
    };
  }

  /**
   * Get an extension by its ID
   */
  async getExtension(
    id: string,
    options: ExtensionInitOptions
  ): Promise<Extension | null> {
    const extension = await this.knex('extensions')
      .where({
        id,
        tenant_id: options.tenant_id
      })
      .first();

    if (!extension) {
      return null;
    }

    return {
      ...extension,
      manifest: extension.manifest
    };
  }

  /**
   * Get an extension by its name
   */
  async getExtensionByName(
    name: string,
    options: ExtensionInitOptions
  ): Promise<Extension | null> {
    const extension = await this.knex('extensions')
      .where({
        name,
        tenant_id: options.tenant_id
      })
      .first();

    if (!extension) {
      return null;
    }

    return {
      ...extension,
      manifest: extension.manifest
    };
  }

  /**
   * List all extensions for a tenant
   */
  async listExtensions(
    options: ExtensionInitOptions
  ): Promise<Extension[]> {
    const extensions = await this.knex('extensions')
      .where({
        tenant_id: options.tenant_id
      })
      .orderBy('name');

    return extensions.map((extension: any) => ({
      ...extension,
      manifest: extension.manifest
    }));
  }

  /**
   * Enable an extension
   */
  async enableExtension(
    id: string,
    options: ExtensionInitOptions
  ): Promise<boolean> {
    const extension = await this.getExtension(id, options);
    if (!extension) {
      throw new ExtensionNotFoundError(id);
    }

    // Check dependencies
    const manifest = extension.manifest;
    if (manifest.requiredExtensions && manifest.requiredExtensions.length > 0) {
      for (const dependencyName of manifest.requiredExtensions) {
        const dependency = await this.getExtensionByName(
          dependencyName,
          options
        );

        if (!dependency) {
          throw new ExtensionDependencyError(id, dependencyName);
        }

        if (!dependency.is_enabled) {
          throw new ExtensionDependencyError(id, dependencyName);
        }
      }
    }

    // Enable the extension
    await this.knex('extensions')
      .where({
        id,
        tenant_id: options.tenant_id
      })
      .update({
        is_enabled: true,
        updated_at: new Date()
      });

    return true;
  }

  /**
   * Disable an extension
   */
  async disableExtension(
    id: string,
    options: ExtensionInitOptions
  ): Promise<boolean> {
    const extension = await this.getExtension(id, options);
    if (!extension) {
      throw new ExtensionNotFoundError(id);
    }

    // Check if other enabled extensions depend on this one
    const allExtensions = await this.listExtensions(options);
    const dependentExtensions = allExtensions.filter(ext => {
      if (!ext.is_enabled || ext.id === id) return false;
      
      const requiredExtensions = ext.manifest.requiredExtensions || [];
      return requiredExtensions.includes(extension.name);
    });

    if (dependentExtensions.length > 0) {
      const dependentNames = dependentExtensions.map(ext => ext.name).join(', ');
      throw new ExtensionDependencyError(
        dependentNames,
        extension.name
      );
    }

    // Disable the extension
    await this.knex('extensions')
      .where({
        id,
        tenant_id: options.tenant_id
      })
      .update({
        is_enabled: false,
        updated_at: new Date()
      });

    return true;
  }

  /**
   * Uninstall an extension
   */
  async uninstallExtension(
    id: string,
    options: ExtensionInitOptions
  ): Promise<boolean> {
    const extension = await this.getExtension(id, options);
    if (!extension) {
      throw new ExtensionNotFoundError(id);
    }

    // Check if other enabled extensions depend on this one
    const allExtensions = await this.listExtensions(options);
    const dependentExtensions = allExtensions.filter(ext => {
      if (!ext.is_enabled || ext.id === id) return false;
      
      const requiredExtensions = ext.manifest.requiredExtensions || [];
      return requiredExtensions.includes(extension.name);
    });

    if (dependentExtensions.length > 0) {
      const dependentNames = dependentExtensions.map(ext => ext.name).join(', ');
      throw new ExtensionDependencyError(
        dependentNames,
        extension.name
      );
    }

    // Delete the extension and related data
    // This will cascade to permissions, files, storage, and settings
    await this.knex('extensions')
      .where({
        id,
        tenant_id: options.tenant_id
      })
      .delete();

    // Clean up any storage services
    this.storage.delete(id);

    return true;
  }

  /**
   * Get extension context for a specific extension
   */
  async getExtensionContext(
    id: string,
    options: ExtensionInitOptions
  ): Promise<ExtensionContext> {
    const extension = await this.getExtension(id, options);
    if (!extension) {
      throw new ExtensionNotFoundError(id);
    }

    if (!extension.is_enabled) {
      throw new ExtensionDisabledError(id);
    }

    // Get storage service for this extension
    let storageService = this.storage.get(id);
    if (!storageService) {
      storageService = new ExtensionStorageService(id, options.tenant_id, this.knex);
      this.storage.set(id, storageService);
    }

    // Create extension context
    const context: ExtensionContext = {
      extensionId: id,
      tenantId: options.tenant_id,
      getStorage: () => storageService,
      getSettings: async () => {
        const settings = await this.knex('extension_settings')
          .where({
            extension_id: id,
            tenant_id: options.tenant_id
          })
          .first();

        return settings ? settings.settings : {};
      },
      updateSettings: async (settings: Record<string, any>) => {
        await this.knex('extension_settings')
          .insert({
            extension_id: id,
            tenant_id: options.tenant_id,
            settings: JSON.stringify(settings)
          })
          .onConflict(['extension_id', 'tenant_id'])
          .merge({
            settings: JSON.stringify(settings),
            updated_at: new Date()
          });
      },
      hasPermission: async (permission: string) => {
        const permissionExists = await this.knex('extension_permissions')
          .where({
            extension_id: id,
            resource: permission.split(':')[0],
            action: permission.split(':')[1]
          })
          .first();

        return !!permissionExists;
      }
    };

    return context;
  }

  /**
   * Get components by type
   */
  async getComponentsByType(
    type: ExtensionComponentType,
    options: ExtensionInitOptions
  ): Promise<ExtensionComponentDefinition[]> {
    const extensions = await this.listExtensions(options);
    const enabledExtensions = extensions.filter(ext => ext.is_enabled);

    const components: ExtensionComponentDefinition[] = [];

    for (const extension of enabledExtensions) {
      const manifest = extension.manifest;
      if (!manifest.components) continue;

      const matchingComponents = manifest.components.filter(
        comp => comp.type === type
      );

      matchingComponents.forEach(component => {
        components.push({
          ...component,
          extensionId: extension.id
        } as unknown as ExtensionComponentDefinition);
      });
    }

    return components;
  }

  /**
   * Get components by slot
   */
  async getComponentsBySlot(
    slot: string,
    options: ExtensionInitOptions
  ): Promise<ExtensionComponentDefinition[]> {
    const extensions = await this.listExtensions(options);
    const enabledExtensions = extensions.filter(ext => ext.is_enabled);

    const components: ExtensionComponentDefinition[] = [];

    for (const extension of enabledExtensions) {
      const manifest = extension.manifest;
      if (!manifest.components) continue;

      const matchingComponents = manifest.components.filter(
        comp => comp.slot === slot
      );

      matchingComponents.forEach(component => {
        components.push({
          ...component,
          extensionId: extension.id
        } as unknown as ExtensionComponentDefinition);
      });
    }

    return components;
  }

  /**
   * Extract permissions array from various formats
   */
  private extractPermissionsArray(permissions: any): string[] {
    if (!permissions) return [];
    
    // If it's already an array of strings, return it
    if (Array.isArray(permissions)) {
      return permissions.filter(p => typeof p === 'string');
    }
    
    // If it's an object with api permissions (like in the softwareone extension)
    if (typeof permissions === 'object' && permissions.api && Array.isArray(permissions.api)) {
      return permissions.api;
    }
    
    return [];
  }

  /**
   * Update extension permissions
   */
  private async updateExtensionPermissions(
    extensionId: string,
    permissions: string[]
  ): Promise<void> {
    // Delete existing permissions
    await this.knex('extension_permissions')
      .where({ extension_id: extensionId })
      .delete();

    // Insert new permissions
    if (permissions.length > 0) {
      const permissionRows = permissions.map(permission => {
        const [resource, action] = permission.split(':');
        return {
          extension_id: extensionId,
          resource,
          action
        };
      });

      await this.knex('extension_permissions').insert(permissionRows);
    }
  }

  // Add methods expected by extension actions
  async getAllExtensions(tenantId?: string): Promise<Extension[]> {
    let query = this.knex('extensions');
    
    if (tenantId) {
      query = query.where({ tenant_id: tenantId });
    }
    
    const extensions = await query.orderBy('name');
    
    console.log('[ExtensionRegistry] getAllExtensions raw data:', extensions.map((e: any) => ({
      id: e.id,
      name: e.name,
      manifestType: typeof e.manifest
    })));

    return extensions.map((extension: any) => ({
      ...extension,
      manifest: typeof extension.manifest === 'string' 
        ? JSON.parse(extension.manifest) 
        : extension.manifest
    }));
  }
}
