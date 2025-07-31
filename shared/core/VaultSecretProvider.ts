import vault from 'node-vault'; // Removed { Vault } import
import { ISecretProvider } from './ISecretProvider.js';
import logger from './logger.js';

/**
 * A secret provider that retrieves secrets from HashiCorp Vault.
 *
 * Configuration is driven by environment variables:
 * - VAULT_ADDR: The address of the Vault server (e.g., "http://127.0.0.1:8200"). Required.
 * - VAULT_TOKEN: The Vault token for authentication. Required. (Other auth methods could be added later).
 * - VAULT_APP_SECRET_PATH: The path for application secrets. Defaults to "kv/data/app/secrets".
 * - VAULT_TENANT_SECRET_PATH_TEMPLATE: The template path for tenant secrets.
 *   Defaults to "kv/data/tenants/{tenantId}/secrets". The "{tenantId}" placeholder will be replaced.
 */
export class VaultSecretProvider implements ISecretProvider {
  // Rely on inference for the client type, or use ReturnType<typeof vault> if needed later
  private client: ReturnType<typeof vault> | undefined;
  private appSecretPath: string;
  private tenantSecretPathTemplate: string;
  private isInitialized: boolean = false;

  constructor() {
    const vaultAddr = process.env.VAULT_ADDR;
    const vaultToken = process.env.VAULT_TOKEN;
    const appSecretPath = process.env.VAULT_APP_SECRET_PATH;
    const tenantSecretPathTemplate = process.env.VAULT_TENANT_SECRET_PATH_TEMPLATE;

    if (!vaultAddr || !vaultToken) {
      logger.error('VaultSecretProvider: VAULT_ADDR and VAULT_TOKEN environment variables are required.');
      throw new Error('VAULT_ADDR and VAULT_TOKEN are required for VaultSecretProvider');
    }

    if (!appSecretPath) {
      logger.error('VaultSecretProvider: VAULT_APP_SECRET_PATH environment variable is required.');
      throw new Error('VAULT_APP_SECRET_PATH is required for VaultSecretProvider');
    }

    if (!tenantSecretPathTemplate) {
      logger.error('VaultSecretProvider: VAULT_TENANT_SECRET_PATH_TEMPLATE environment variable is required.');
      throw new Error('VAULT_TENANT_SECRET_PATH_TEMPLATE is required for VaultSecretProvider');
    }

    this.appSecretPath = appSecretPath;
    this.tenantSecretPathTemplate = tenantSecretPathTemplate;

    try {
      this.client = vault({
        apiVersion: 'v1', // Default API version
        endpoint: vaultAddr,
        token: vaultToken,
      });
      this.isInitialized = true;
      logger.info(`VaultSecretProvider initialized. Address: ${vaultAddr}, App Path: ${this.appSecretPath}, Tenant Template: ${this.tenantSecretPathTemplate}`);
    } catch (error: any) {
      logger.error(`VaultSecretProvider: Failed to initialize Vault client: ${error.message}`);
      this.client = undefined; // Ensure client is undefined on error
    }
  }

  /**
   * Reads a secret from Vault at the specified path.
   * Assumes KV v2 engine where secrets are nested under `data.data`.
   * @param secretPath - The full path to the secret in Vault.
   * @param secretName - The specific key within the secret path to retrieve.
   * @returns The secret value or undefined if not found or on error.
   */
  private async readVaultSecret(secretPath: string, secretName: string): Promise<string | undefined> {
    if (!this.isInitialized || !this.client) {
      logger.error('VaultSecretProvider: Attempted to read secret while provider is not initialized.');
      return undefined;
    }

    try {
      logger.debug(`VaultSecretProvider: Reading secret at path: ${secretPath}, key: ${secretName}`);
      // Type assertion might be needed if inference isn't enough, but let's try without first
      const response = await this.client.read(secretPath);

      // Check if data and the specific secret name exist
      // Vault KV v2 stores secrets under response.data.data
      if (response && response.data && response.data.data && response.data.data[secretName]) {
        const secretValue = response.data.data[secretName];
        if (typeof secretValue === 'string') {
          return secretValue;
        } else {
          logger.warn(`VaultSecretProvider: Secret value for key '${secretName}' at path '${secretPath}' is not a string.`);
          return undefined;
        }
      } else {
        logger.debug(`VaultSecretProvider: Secret key '${secretName}' not found at path '${secretPath}'.`);
        return undefined;
      }
    } catch (error: any) {
      // Vault client often returns errors with response objects
      const statusCode = error.response?.statusCode;
      const errorMessage = error.message || 'Unknown Vault error';

      if (statusCode === 404) {
        logger.debug(`VaultSecretProvider: Secret path not found (404): ${secretPath}`);
      } else {
        logger.error(`VaultSecretProvider: Error reading secret from path ${secretPath}: ${errorMessage} (Status: ${statusCode || 'N/A'})`);
      }
      return undefined;
    }
  }

  /**
   * Retrieves an application-level secret from Vault.
   *
   * @param name - The name (key) of the secret within the application secret path.
   * @returns A promise resolving to the secret string or undefined.
   */
  async getAppSecret(name: string): Promise<string | undefined> {
    return this.readVaultSecret(this.appSecretPath, name);
  }

  /**
   * Retrieves a tenant-specific secret from Vault.
   *
   * @param tenantId - The ID of the tenant.
   * @param name - The name (key) of the secret within the tenant's secret path.
   * @returns A promise resolving to the secret string or undefined.
   */
  async getTenantSecret(tenantId: string, name: string): Promise<string | undefined> {
    if (!tenantId) {
        logger.warn('VaultSecretProvider: tenantId is required for getTenantSecret.');
        return undefined;
    }
    // Replace placeholder in the template
    const tenantPath = this.tenantSecretPathTemplate.replace('{tenantId}', tenantId);
    return this.readVaultSecret(tenantPath, name);
  }
/**
   * Sets or updates a tenant-specific secret key within the tenant's secret path in Vault.
   * If value is null, deletes the specific key.
   * Assumes KV v2 engine.
   *
   * @param tenantId - The ID of the tenant.
   * @param name - The name (key) of the secret to set.
   * @param value - The secret value as a string, or null to delete the key.
   * @returns A promise resolving when the operation is complete.
   */
  async setTenantSecret(tenantId: string, name: string, value: string | null): Promise<void> {
    if (!this.isInitialized || !this.client) {
      logger.error('VaultSecretProvider: Attempted to set secret while provider is not initialized.');
      throw new Error('Vault provider not initialized.');
    }
     if (!tenantId || !name) {
        logger.warn('VaultSecretProvider: tenantId and name are required for setTenantSecret.');
        throw new Error('Missing tenantId or secret name.');
    }

    const tenantPath = this.tenantSecretPathTemplate.replace('{tenantId}', tenantId);

    if (value === null) {
      // Delegate to delete function if value is null
      logger.debug(`VaultSecretProvider: setTenantSecret called with null value for key '${name}' at path '${tenantPath}', deleting.`);
      await this.deleteTenantSecret(tenantId, name);
      return;
    }

    try {
      // For KV v2, we need to merge the new secret with existing ones at the path
      let existingData = {};
      try {
        const response = await this.client.read(tenantPath);
        if (response && response.data && response.data.data) {
          existingData = response.data.data;
        }
      } catch (readError: any) {
        // Ignore 404 errors, as the path might not exist yet
        if (readError.response?.statusCode !== 404) {
          throw readError; // Re-throw other read errors
        }
         logger.debug(`VaultSecretProvider: Secret path '${tenantPath}' not found during read for set, will create.`);
      }

      const newData = { ...existingData, [name]: value };

      logger.debug(`VaultSecretProvider: Writing secret key '${name}' to path: ${tenantPath}`);
      await this.client.write(tenantPath, { data: newData });
      logger.info(`VaultSecretProvider: Successfully set secret key '${name}' for tenant '${tenantId}'.`);

    } catch (error: any) {
      const statusCode = error.response?.statusCode;
      const errorMessage = error.message || 'Unknown Vault error';
      logger.error(`VaultSecretProvider: Error writing secret key '${name}' to path ${tenantPath}: ${errorMessage} (Status: ${statusCode || 'N/A'})`);
      throw new Error(`Failed to set tenant secret: ${errorMessage}`);
    }
  }

  /**
   * Deletes a specific key from a tenant's secret path in Vault.
   * Assumes KV v2 engine. Reads existing data, removes the key, and writes back.
   *
   * @param tenantId - The ID of the tenant.
   * @param name - The name (key) of the secret to delete.
   * @returns A promise resolving when the operation is complete.
   */
  async deleteTenantSecret(tenantId: string, name: string): Promise<void> {
     if (!this.isInitialized || !this.client) {
      logger.error('VaultSecretProvider: Attempted to delete secret while provider is not initialized.');
      throw new Error('Vault provider not initialized.');
    }
     if (!tenantId || !name) {
        logger.warn('VaultSecretProvider: tenantId and name are required for deleteTenantSecret.');
        throw new Error('Missing tenantId or secret name.');
    }

    const tenantPath = this.tenantSecretPathTemplate.replace('{tenantId}', tenantId);

    try {
      // Read the current secrets at the path
       logger.debug(`VaultSecretProvider: Reading path '${tenantPath}' to delete key '${name}'.`);
      const response = await this.client.read(tenantPath);

      // Check if the path and data exist
      if (response && response.data && response.data.data) {
        const currentData = response.data.data;

        // Check if the key exists
        if (name in currentData) {
          logger.debug(`VaultSecretProvider: Found key '${name}' at path '${tenantPath}', preparing to delete.`);
          delete currentData[name]; // Remove the key

          // Write the modified data back
          // If the data object is now empty, Vault might automatically delete the path version,
          // or we could explicitly delete the path if desired. Writing empty data is safer.
           logger.debug(`VaultSecretProvider: Writing updated data (without key '${name}') back to path: ${tenantPath}`);
          await this.client.write(tenantPath, { data: currentData });
           logger.info(`VaultSecretProvider: Successfully deleted secret key '${name}' for tenant '${tenantId}'.`);
        } else {
          // Key doesn't exist, consider it deleted (idempotent)
           logger.debug(`VaultSecretProvider: Key '${name}' not found at path '${tenantPath}' during delete operation (already deleted?).`);
        }
      } else {
        // Path doesn't exist, consider it deleted (idempotent)
         logger.debug(`VaultSecretProvider: Secret path '${tenantPath}' not found during delete operation (already deleted?).`);
      }
    } catch (error: any) {
      const statusCode = error.response?.statusCode;
      const errorMessage = error.message || 'Unknown Vault error';

      if (statusCode === 404) {
        // Path not found is acceptable for delete
         logger.debug(`VaultSecretProvider: Secret path not found (404) during delete: ${tenantPath}`);
      } else {
        logger.error(`VaultSecretProvider: Error deleting secret key '${name}' from path ${tenantPath}: ${errorMessage} (Status: ${statusCode || 'N/A'})`);
        throw new Error(`Failed to delete tenant secret: ${errorMessage}`);
      }
    }
  }
}
