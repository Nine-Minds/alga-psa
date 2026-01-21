/**
 * @file Defines the standard interface for secret providers.
 * Secret providers are responsible for retrieving application-level
 * and tenant-specific secrets from various sources (e.g., filesystem, Vault).
 */

/**
 * Interface for a secret provider.
 */
export interface ISecretProvider {
  /**
   * Retrieves an application-level secret.
   * These secrets are global to the application instance.
   *
   * @param name - The name of the secret to retrieve.
   * @returns A promise that resolves with the secret value as a string,
   *          or undefined if the secret is not found or cannot be accessed.
   */
  getAppSecret(name: string): Promise<string | undefined>;

  /**
   * Retrieves a tenant-specific secret.
   * These secrets are scoped to a particular tenant.
   *
   * @param tenantId - The ID of the tenant for whom to retrieve the secret.
   * @param name - The name of the secret to retrieve.
   * @returns A promise that resolves with the secret value as a string,
   *          or undefined if the secret is not found or cannot be accessed.
   */
  getTenantSecret(tenantId: string, name: string): Promise<string | undefined>;

  /**
   * Sets or updates a tenant-specific secret.
   * If the value is null, it may effectively delete the secret,
   * depending on the provider implementation.
   *
   * @param tenantId - The ID of the tenant for whom to set the secret.
   * @param name - The name of the secret to set.
   * @param value - The secret value as a string, or null to potentially delete.
   * @returns A promise that resolves when the operation is complete.
   */
  setTenantSecret(tenantId: string, name: string, value: string | null): Promise<void>;

  /**
   * Deletes a tenant-specific secret.
   *
   * @param tenantId - The ID of the tenant for whom to delete the secret.
   * @param name - The name of the secret to delete.
   * @returns A promise that resolves when the operation is complete.
   */
  deleteTenantSecret(tenantId: string, name: string): Promise<void>;
}
