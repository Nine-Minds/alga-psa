import * as fs from 'fs/promises';
import * as path from 'path';
import { ISecretProvider } from './ISecretProvider';
// import logger from 'server/src/utils/logger'; // Corrected logger import path again

/**
 * A secret provider that reads secrets from the local filesystem.
 *
 * Application secrets are read from a base path.
 * Tenant secrets are read from subdirectories under the base path,
 * structured as `<basePath>/tenants/<tenantId>/<secretName>`.
 *
 * The base path is determined by the `SECRET_FS_BASE_PATH` environment
 * variable, defaulting to '../secrets' relative to the server root.
 */
export class FileSystemSecretProvider implements ISecretProvider {
  private basePath: string;

  constructor() {
    const serverRoot = process.cwd(); // Gets the current working directory (app root)
    const defaultPath = path.resolve(serverRoot, '../secrets');
    this.basePath = process.env.SECRET_FS_BASE_PATH || defaultPath;
    console.info(`FileSystemSecretProvider initialized with base path: ${this.basePath}`);
  }

  /**
   * Reads a file content, returning undefined if it doesn't exist or is unreadable.
   * @param filePath - The absolute path to the secret file.
   * @returns The file content as a string, or undefined.
   */
  private async readFileContent(filePath: string): Promise<string | undefined> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content.trim(); // Trim whitespace, common with Docker secrets
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File not found is expected, return undefined
        console.debug(`Secret file not found: ${filePath}`);
      } else {
        // Log other errors (e.g., permissions)
        console.error(`Error reading secret file ${filePath}: ${error.message}`);
      }
      return undefined;
    }
  }

  /**
   * Retrieves an application-level secret from the filesystem.
   * Looks for the secret file directly under the base path.
   *
   * @param name - The name of the secret (filename).
   * @returns A promise resolving to the secret string or undefined.
   */
  async getAppSecret(name: string): Promise<string | undefined> {
    // Basic validation/sanitization for name to prevent path traversal
    const safeName = path.basename(name);
     if (safeName !== name) {
        console.warn(`Potential path traversal attempt detected for app secret name: ${name}. Denying access.`);
        return undefined;
    }
    const filePath = path.join(this.basePath, safeName);
    console.debug(`Attempting to read app secret: ${filePath}`);
    
    return this.readFileContent(filePath);
  }

  /**
   * Retrieves a tenant-specific secret from the filesystem.
   * Looks for the secret file under `<basePath>/tenants/<tenantId>/<secretName>`.
   *
   * @param tenantId - The ID of the tenant.
   * @param name - The name of the secret (filename).
   * @returns A promise resolving to the secret string or undefined.
   */
  async getTenantSecret(tenantId: string, name: string): Promise<string | undefined> {
    // Basic validation/sanitization for tenantId and name to prevent path traversal
    const safeTenantId = path.basename(tenantId);
    const safeName = path.basename(name);
    if (safeTenantId !== tenantId || safeName !== name) {
      console.warn(`Potential path traversal attempt detected for tenantId: ${tenantId}, name: ${name}. Denying access.`);
        return undefined;
    }

    const filePath = path.join(this.basePath, 'tenants', safeTenantId, safeName);
    console.debug(`Attempting to read tenant secret: ${filePath}`);
    return this.readFileContent(filePath);
  }
/**
   * Sets or updates a tenant-specific secret on the filesystem.
   * Creates the tenant directory if it doesn't exist.
   * If value is null, deletes the secret file.
   *
   * @param tenantId - The ID of the tenant.
   * @param name - The name of the secret (filename).
   * @param value - The secret value as a string, or null to delete.
   * @returns A promise resolving when the operation is complete.
   */
  async setTenantSecret(tenantId: string, name: string, value: string | null): Promise<void> {
    // Basic validation/sanitization
    const safeTenantId = path.basename(tenantId);
    const safeName = path.basename(name);
    if (safeTenantId !== tenantId || safeName !== name) {
      console.warn(`Potential path traversal attempt detected for setTenantSecret (tenantId: ${tenantId}, name: ${name}). Aborting.`);
      throw new Error('Invalid tenantId or secret name.'); // Throw error on invalid input
    }

    const tenantDirPath = path.join(this.basePath, 'tenants', safeTenantId);
    const filePath = path.join(tenantDirPath, safeName);

    if (value === null) {
      // If value is null, delegate to delete
      console.debug(`setTenantSecret called with null value for ${filePath}, deleting.`);
      await this.deleteTenantSecret(tenantId, name);
      return;
    }

    try {
      // Ensure the tenant directory exists
      await fs.mkdir(tenantDirPath, { recursive: true });
      // Write the secret value to the file
      await fs.writeFile(filePath, value, 'utf-8');
      console.debug(`Successfully wrote tenant secret: ${filePath}`);
    } catch (error: any) {
      console.error(`Error writing tenant secret file ${filePath}: ${error.message}`);
      // Re-throw the error to signal failure
      throw new Error(`Failed to set tenant secret: ${error.message}`);
    }
  }

  /**
   * Deletes a tenant-specific secret file from the filesystem.
   *
   * @param tenantId - The ID of the tenant.
   * @param name - The name of the secret (filename).
   * @returns A promise resolving when the operation is complete.
   */
  async deleteTenantSecret(tenantId: string, name: string): Promise<void> {
    // Basic validation/sanitization
    const safeTenantId = path.basename(tenantId);
    const safeName = path.basename(name);
     if (safeTenantId !== tenantId || safeName !== name) {
      console.warn(`Potential path traversal attempt detected for deleteTenantSecret (tenantId: ${tenantId}, name: ${name}). Aborting.`);
      throw new Error('Invalid tenantId or secret name.'); // Throw error on invalid input
    }

    const filePath = path.join(this.basePath, 'tenants', safeTenantId, safeName);

    try {
      await fs.unlink(filePath);
      console.debug(`Successfully deleted tenant secret file: ${filePath}`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File not found is acceptable for delete (idempotent)
        console.debug(`Tenant secret file not found during delete (already deleted?): ${filePath}`);
      } else {
        // Log other errors and re-throw
        console.error(`Error deleting tenant secret file ${filePath}: ${error.message}`);
        throw new Error(`Failed to delete tenant secret: ${error.message}`);
      }
    }
  }
}