import { promises as fs } from 'fs';
import path from 'path';
import { ExtensionManifest } from './types';
import { ExtensionRegistry } from './registry';
import { createTenantKnex } from '@/lib/db';
import logger from '@alga-psa/shared/core/logger.js';

export class ExtensionLoader {
  private extensionsDir: string;

  constructor(extensionsDir: string) {
    this.extensionsDir = extensionsDir;
  }

  async loadExtensions(): Promise<void> {
    try {
      logger.info('Loading extensions from directory', { dir: this.extensionsDir });
      
      // Check if extensions directory exists
      try {
        await fs.access(this.extensionsDir);
      } catch {
        logger.warn('Extensions directory does not exist', { dir: this.extensionsDir });
        return;
      }

      // Read all directories in the extensions folder
      const entries = await fs.readdir(this.extensionsDir, { withFileTypes: true });
      const extensionDirs = entries.filter(entry => entry.isDirectory());

      for (const dir of extensionDirs) {
        try {
          await this.loadExtension(path.join(this.extensionsDir, dir.name));
        } catch (error) {
          logger.error('Failed to load extension', { 
            extension: dir.name, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          });
        }
      }

      logger.info('Extension loading complete');
    } catch (error) {
      logger.error('Failed to load extensions', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  private async loadExtension(extensionPath: string): Promise<void> {
    const manifestPath = path.join(extensionPath, 'alga-extension.json');
    
    try {
      // Read and parse manifest
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest: ExtensionManifest = JSON.parse(manifestContent);

      // Enforce minAppVersion if provided
      if (manifest.minAppVersion) {
        const appVersion = await this.getAppVersion();
        if (!this.isVersionGte(appVersion, manifest.minAppVersion)) {
          logger.warn('Extension skipped: requires higher app version', {
            extension: manifest.name,
            required: manifest.minAppVersion,
            current: appVersion,
          });
          return; // Do not register
        }
      }
      
      // Convert relative paths to absolute paths
      const processedManifest = this.processManifestPaths(manifest, extensionPath);
      
      // Register the extension for all tenants (tenant-scoped only system)
      await this.registerExtensionForTenants(processedManifest, extensionPath);
      
      logger.info('Extension loaded successfully', { 
        id: manifest.id, 
        name: manifest.name,
        version: manifest.version 
      });
    } catch (error) {
      logger.error('Failed to load extension manifest', { 
        path: extensionPath,
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      throw error;
    }
  }

  /**
   * Determine the running app version for EE server.
   * Uses APP_VERSION env only; defaults to "0.0.0".
   */
  private async getAppVersion(): Promise<string> {
    const envVer = (process.env.APP_VERSION || '').trim();
    return envVer || '0.0.0';
  }

  /**
   * Minimal semver compare: returns true if a >= b.
   * Only compares numeric major.minor.patch; ignores pre-release/build.
   */
  private isVersionGte(a: string, b: string): boolean {
    const pa = this.parseSemver(a);
    const pb = this.parseSemver(b);
    for (let i = 0; i < 3; i++) {
      if (pa[i] > pb[i]) return true;
      if (pa[i] < pb[i]) return false;
    }
    return true;
  }

  private parseSemver(v: string): [number, number, number] {
    const cleaned = String(v || '').split(/[+-]/)[0]; // drop pre-release/build
    const parts = cleaned.split('.').slice(0, 3).map((s) => parseInt(s, 10));
    const [maj, min, pat] = [parts[0] || 0, parts[1] || 0, parts[2] || 0];
    return [isFinite(maj) ? maj : 0, isFinite(min) ? min : 0, isFinite(pat) ? pat : 0];
  }

  private processManifestPaths(manifest: ExtensionManifest, extensionPath: string): ExtensionManifest {
    const processed = { ...manifest };

    // Process component paths
    if (processed.components) {
      processed.components = processed.components.map(component => ({
        ...component,
        component: component.component 
          ? this.resolveExtensionPath(component.component, extensionPath)
          : component.component
      }));
    }

    // Process API handler paths
    if (processed.api?.endpoints) {
      processed.api.endpoints = processed.api.endpoints.map(endpoint => ({
        ...endpoint,
        handler: this.resolveExtensionPath(endpoint.handler, extensionPath)
      }));
    }

    return processed;
  }

  private resolveExtensionPath(relativePath: string, extensionPath: string): string {
    // If path starts with ./, resolve relative to extension directory
    if (relativePath.startsWith('./')) {
      const extensionName = path.basename(extensionPath);
      return `/extensions/${extensionName}/${relativePath.substring(2)}`;
    }
    return relativePath;
  }

  private async registerExtensionForTenants(manifest: ExtensionManifest, extensionPath: string): Promise<void> {
    try {
      // Use admin connection to avoid headers context issue during initialization
      const { getAdminConnection } = await import('@/lib/db/admin');
      const knex = await getAdminConnection();
      
      // Tenant-only system: register for all tenants
      const tenants: any[] = await knex('tenants').select('tenant');

      // Register extension for each tenant
      for (const tenant of tenants) {
        try {
          const registry = new ExtensionRegistry(knex);
          await registry.registerExtension(manifest, {
            tenant_id: tenant.tenant
          });
          logger.info('Extension registered for tenant', {
            extension: manifest.name,
            tenant: tenant.tenant
          });
        } catch (error) {
          let errorDetails = error instanceof Error ? error.message : 'Unknown error';
          
          // If it's a validation error, include the specific validation errors
          if (error instanceof Error && 'errors' in error) {
            const validationError = error as any;
            errorDetails = `${errorDetails} - Validation errors: ${JSON.stringify(validationError.errors)}`;
          }
          
          logger.error('Failed to register extension for tenant', {
            extension: manifest.name,
            tenant: tenant.tenant,
            error: errorDetails
          });
        }
      }
    } catch (error) {
      logger.error('Failed to register extension for tenants', {
        extension: manifest.name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}

// Export a singleton instance for convenience
let loaderInstance: ExtensionLoader | null = null;

export function getExtensionLoader(extensionsDir?: string): ExtensionLoader {
  if (!loaderInstance && extensionsDir) {
    loaderInstance = new ExtensionLoader(extensionsDir);
  }
  if (!loaderInstance) {
    throw new Error('Extension loader not initialized');
  }
  return loaderInstance;
}
