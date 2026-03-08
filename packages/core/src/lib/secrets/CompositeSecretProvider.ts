import logger from '../logger';
import type { ISecretProvider } from './ISecretProvider';

/**
 * Composite secret provider that implements a read chain and write delegation pattern.
 * - Read operations iterate through readProviders until a non-undefined value is found
 * - Write operations are delegated to a single writeProvider
 */
export class CompositeSecretProvider implements ISecretProvider {
  private readonly readProviders: ISecretProvider[];
  private readonly writeProvider: ISecretProvider;

  constructor(readProviders: ISecretProvider[], writeProvider: ISecretProvider) {
    if (!readProviders || readProviders.length === 0) {
      throw new Error('CompositeSecretProvider requires at least one read provider');
    }
    if (!writeProvider) {
      throw new Error('CompositeSecretProvider requires a write provider');
    }
    this.readProviders = readProviders;
    this.writeProvider = writeProvider;
  }

  /**
   * Retrieves an application-level secret by iterating through read providers.
   * Returns the first non-undefined value found.
   *
   * @param name - The name of the secret to retrieve
   * @returns The secret value from the first provider that has it, or undefined if none found
   */
  async getAppSecret(name: string): Promise<string | undefined> {
    for (let i = 0; i < this.readProviders.length; i++) {
      const provider = this.readProviders[i];
      try {
        const value = await provider.getAppSecret(name);
        if (value !== undefined) {
          return value;
        }
      } catch (error) {
        logger.warn(`CompositeSecretProvider: read provider ${i} failed for app secret lookup`, error);
        // Continue to next provider on error
      }
    }
    return undefined;
  }

  /**
   * Retrieves a tenant-specific secret by iterating through read providers.
   * Returns the first non-undefined value found.
   *
   * @param tenantId - The tenant ID
   * @param name - The name of the secret to retrieve
   * @returns The secret value from the first provider that has it, or undefined if none found
   */
  async getTenantSecret(tenantId: string, name: string): Promise<string | undefined> {
    for (let i = 0; i < this.readProviders.length; i++) {
      const provider = this.readProviders[i];
      try {
        const value = await provider.getTenantSecret(tenantId, name);
        if (value !== undefined) {
          return value;
        }
      } catch (error) {
        logger.warn(`CompositeSecretProvider: read provider ${i} failed for tenant secret lookup`, error);
        // Continue to next provider on error
      }
    }
    return undefined;
  }

  /**
   * Sets a tenant-specific secret using the write provider.
   *
   * @param tenantId - The tenant ID
   * @param name - The name of the secret to set
   * @param value - The secret value or null to delete
   */
  async setTenantSecret(tenantId: string, name: string, value: string | null): Promise<void> {
    try {
      await this.writeProvider.setTenantSecret(tenantId, name, value);
    } catch (error) {
      logger.error('CompositeSecretProvider failed to set tenant secret', error);
      throw error;
    }
  }

  /**
   * Deletes a tenant-specific secret using the write provider.
   *
   * @param tenantId - The tenant ID
   * @param name - The name of the secret to delete
   */
  async deleteTenantSecret(tenantId: string, name: string): Promise<void> {
    try {
      await this.writeProvider.deleteTenantSecret(tenantId, name);
    } catch (error) {
      logger.error('CompositeSecretProvider failed to delete tenant secret', error);
      throw error;
    }
  }
}
