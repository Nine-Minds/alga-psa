// Neutralise Node 26's throwing fs.Stats Temporal *Instant getters BEFORE
// node-vault loads — it transitively runs bluebird's promisifyAll(require('fs'))
// (via postman-request -> stream-length), which crashes at module load on
// Node 26.2.x. This side-effect import MUST stay above the node-vault import;
// ESM evaluates imports in source order, so it runs first on every load path.
import './fixNode26FsStats';
import vault from 'node-vault';
import logger from '../logger';
import type { ISecretProvider } from './ISecretProvider';

type VaultClient = ReturnType<typeof vault>;

type KvV2Document = {
  data?: Record<string, unknown>;
  metadata?: { version?: number };
};

const MAX_KV_CAS_ATTEMPTS = 12;

function vaultStatus(error: unknown): number | undefined {
  return (error as { response?: { statusCode?: number } })?.response?.statusCode;
}

function isKvCasConflict(error: unknown): boolean {
  const vaultError = error as {
    response?: { statusCode?: number; body?: { errors?: unknown } };
    message?: string;
  };
  if (vaultError.response?.statusCode !== 400) return false;
  const errors = vaultError.response.body?.errors;
  const detail = Array.isArray(errors) ? errors.join(' ') : '';
  return /check.and.set|cas|current version/i.test(`${detail} ${vaultError.message ?? ''}`);
}

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
  private client: VaultClient | undefined;
  private readonly appSecretPath: string;
  private readonly tenantSecretPathTemplate: string;
  private isInitialized = false;

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
        apiVersion: 'v1',
        endpoint: vaultAddr,
        token: vaultToken,
      });
      this.isInitialized = true;
      logger.info(`VaultSecretProvider initialized. Address: ${vaultAddr}, App Path: ${this.appSecretPath}, Tenant Template: ${this.tenantSecretPathTemplate}`);
    } catch (error: unknown) {
      const err = error as Error;
      logger.error(`VaultSecretProvider: Failed to initialize Vault client: ${err.message}`);
      this.client = undefined;
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
        return undefined;
      }
    } catch (error: unknown) {
      const vaultError = error as { response?: { statusCode?: number }; message?: string };
      const statusCode = vaultError.response?.statusCode;
      const errorMessage = vaultError.message || 'Unknown Vault error';

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
      await this.mutateTenantSecretDocument(tenantPath, (existingData) => ({
        ...existingData,
        [name]: value,
      }));
      logger.info(`VaultSecretProvider: Successfully set secret key '${name}' for tenant '${tenantId}'.`);
    } catch (error: unknown) {
      const vaultError = error as { response?: { statusCode?: number }; message?: string };
      const statusCode = vaultError.response?.statusCode;
      const errorMessage = vaultError.message || 'Unknown Vault error';
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
      await this.mutateTenantSecretDocument(tenantPath, (currentData) => {
        if (!(name in currentData)) return null;
        const nextData = { ...currentData };
        delete nextData[name];
        return nextData;
      });
      logger.info(`VaultSecretProvider: Successfully deleted secret key '${name}' for tenant '${tenantId}'.`);
    } catch (error: unknown) {
      const vaultError = error as { response?: { statusCode?: number }; message?: string };
      const statusCode = vaultError.response?.statusCode;
      const errorMessage = vaultError.message || 'Unknown Vault error';

      if (statusCode === 404) {
        // Path not found is acceptable for delete
        logger.debug(`VaultSecretProvider: Secret path not found (404) during delete: ${tenantPath}`);
      } else {
        logger.error(`VaultSecretProvider: Error deleting secret key '${name}' from path ${tenantPath}: ${errorMessage} (Status: ${statusCode || 'N/A'})`);
        throw new Error(`Failed to delete tenant secret: ${errorMessage}`);
      }
    }
  }

  /**
   * Mutates a KV v2 document with compare-and-set. Vault's version check makes
   * the read/merge/write atomic across processes; conflicts retry from the latest
   * version so unrelated tenant keys are preserved.
   */
  private async mutateTenantSecretDocument(
    tenantPath: string,
    mutate: (data: Record<string, unknown>) => Record<string, unknown> | null,
  ): Promise<void> {
    if (!this.client) throw new Error('Vault provider not initialized.');

    for (let attempt = 0; attempt < MAX_KV_CAS_ATTEMPTS; attempt += 1) {
      let currentData: Record<string, unknown> = {};
      let version = 0;
      try {
        const response = await this.client.read(tenantPath);
        const document = response?.data as KvV2Document | undefined;
        currentData = document?.data ?? {};
        version = Number(document?.metadata?.version);
        if (!Number.isInteger(version) || version < 1) {
          throw new Error('Vault KV v2 response did not include a valid secret version.');
        }
      } catch (error: unknown) {
        if (vaultStatus(error) !== 404) throw error;
      }

      const nextData = mutate(currentData);
      if (nextData === null) return;

      try {
        await this.client.write(tenantPath, {
          options: { cas: version },
          data: nextData,
        });
        return;
      } catch (error: unknown) {
        if (isKvCasConflict(error) && attempt < MAX_KV_CAS_ATTEMPTS - 1) {
          const backoffMs = Math.min(5 * (2 ** attempt), 100) + Math.floor(Math.random() * 11);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
        throw error;
      }
    }

    throw new Error(`Vault KV v2 compare-and-set did not converge after ${MAX_KV_CAS_ATTEMPTS} attempts.`);
  }
}
