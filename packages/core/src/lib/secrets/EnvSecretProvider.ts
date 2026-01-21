import logger from '../logger';
import type { ISecretProvider } from './ISecretProvider';

/**
 * Environment variable secret provider.
 * Reads secrets from process.env with configurable prefix support.
 * This provider is read-only - write operations will throw errors.
 */
export class EnvSecretProvider implements ISecretProvider {
  private readonly prefix: string;

  constructor() {
    this.prefix = process.env.SECRET_ENV_PREFIX || '';
    if (this.prefix) {
      logger.info(`EnvSecretProvider initialized with prefix: ${this.prefix}`);
    } else {
      logger.info('EnvSecretProvider initialized without prefix');
    }
  }

  /**
   * Retrieves an application-level secret from environment variables.
   * Looks for: process.env[name] or process.env[PREFIX_name] (if prefix is set)
   *
   * @param name - The name of the secret to retrieve
   * @returns The secret value or undefined if not found
   */
  async getAppSecret(name: string): Promise<string | undefined> {
    const envKey = this.prefix ? `${this.prefix}_${name}` : name;
    const value = process.env[envKey];
    if (value !== undefined) {
      logger.debug(`EnvSecretProvider found app secret: ${envKey}`);
    }
    return value;
  }

  /**
   * Retrieves a tenant-specific secret from environment variables.
   * Looks for: process.env[TENANT_tenantId_name] or process.env[PREFIX_TENANT_tenantId_name]
   *
   * @param tenantId - The tenant ID
   * @param name - The name of the secret to retrieve
   * @returns The secret value or undefined if not found
   */
  async getTenantSecret(tenantId: string, name: string): Promise<string | undefined> {
    const envKey = this.prefix
      ? `${this.prefix}_TENANT_${tenantId}_${name}`
      : `TENANT_${tenantId}_${name}`;
    const value = process.env[envKey];
    if (value !== undefined) {
      logger.debug(`EnvSecretProvider found tenant secret: ${envKey}`);
    }
    return value;
  }

  /**
   * Environment variables are read-only. This operation is not supported.
   *
   * @throws Error always - environment variables cannot be modified at runtime
   */
  async setTenantSecret(_tenantId: string, _name: string, _value: string | null): Promise<void> {
    throw new Error('EnvSecretProvider is read-only. Cannot set tenant secrets in environment variables.');
  }

  /**
   * Environment variables are read-only. This operation is not supported.
   *
   * @throws Error always - environment variables cannot be modified at runtime
   */
  async deleteTenantSecret(_tenantId: string, _name: string): Promise<void> {
    throw new Error('EnvSecretProvider is read-only. Cannot delete tenant secrets from environment variables.');
  }
}
