import { ISecretProvider } from './ISecretProvider.js';

/**
 * API response type for vault operations
 */
interface VaultApiResponse {
  value?: string;
  success?: boolean;
  error?: string;
}

/**
 * ProxyVaultSecretProvider - Edge Runtime compatible vault secret provider
 * 
 * This provider works in Edge Runtime by making HTTP calls to a local API
 * that runs in Node.js runtime and handles the actual vault communication.
 * 
 * This allows vault functionality to work in Edge Runtime middleware
 * without importing node-vault directly (which has dynamic code evaluation).
 */
export class ProxyVaultSecretProvider implements ISecretProvider {
  private readonly apiBaseUrl: string;

  constructor() {
    // Use localhost for API calls - this will be enforced on the server side
    this.apiBaseUrl = 'http://localhost:3000/api/internal/vault';
  }

  /**
   * Makes a secure API call to the vault endpoint
   */
  private async makeVaultApiCall(operation: string, secretName: string, tenantId?: string, value?: string | null): Promise<VaultApiResponse> {
    try {
      const response = await fetch(this.apiBaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operation,
          secretName,
          tenantId,
          value,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as VaultApiResponse;
        throw new Error(`API call failed: ${errorData.error || response.statusText}`);
      }

      return await response.json() as VaultApiResponse;
    } catch (error) {
      console.error(`ProxyVaultSecretProvider API call failed:`, error);
      throw error;
    }
  }

  /**
   * Gets an application secret via API call
   * @param name - Name of the secret to retrieve
   * @returns The secret value or undefined if not found
   */
  async getAppSecret(name: string): Promise<string | undefined> {
    try {
      const result = await this.makeVaultApiCall('getAppSecret', name);
      return result.value;
    } catch (error) {
      console.error(`ProxyVaultSecretProvider: Failed to get app secret '${name}':`, error);
      return undefined;
    }
  }

  /**
   * Gets a tenant secret via API call
   * @param tenantId - ID of the tenant
   * @param name - Name of the secret to retrieve
   * @returns The secret value or undefined if not found
   */
  async getTenantSecret(tenantId: string, name: string): Promise<string | undefined> {
    try {
      const result = await this.makeVaultApiCall('getTenantSecret', name, tenantId);
      return result.value;
    } catch (error) {
      console.error(`ProxyVaultSecretProvider: Failed to get tenant secret '${name}' for tenant '${tenantId}':`, error);
      return undefined;
    }
  }

  /**
   * Sets a tenant secret via API call
   * @param tenantId - ID of the tenant
   * @param name - Name of the secret to set
   * @param value - Value to set (or null to delete)
   */
  async setTenantSecret(tenantId: string, name: string, value: string | null): Promise<void> {
    try {
      await this.makeVaultApiCall('setTenantSecret', name, tenantId, value);
    } catch (error) {
      console.error(`ProxyVaultSecretProvider: Failed to set tenant secret '${name}' for tenant '${tenantId}':`, error);
      throw error;
    }
  }

  /**
   * Deletes a tenant secret via API call
   * @param tenantId - ID of the tenant
   * @param name - Name of the secret to delete
   */
  async deleteTenantSecret(tenantId: string, name: string): Promise<void> {
    try {
      await this.makeVaultApiCall('deleteTenantSecret', name, tenantId);
    } catch (error) {
      console.error(`ProxyVaultSecretProvider: Failed to delete tenant secret '${name}' for tenant '${tenantId}':`, error);
      throw error;
    }
  }
}