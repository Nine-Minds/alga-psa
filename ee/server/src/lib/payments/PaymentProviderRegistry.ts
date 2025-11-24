/**
 * PaymentProviderRegistry - Manages payment provider instances
 *
 * This registry provides a centralized way to access payment providers
 * and ensures proper initialization and lifecycle management.
 */

import { PaymentProvider } from 'server/src/interfaces/payment.interfaces';

export class PaymentProviderRegistry {
  private static providers: Map<string, PaymentProvider> = new Map();
  private static initialized = false;

  /**
   * Registers a payment provider.
   *
   * @param provider - The payment provider instance to register
   */
  static register(provider: PaymentProvider): void {
    const type = provider.providerType;
    if (this.providers.has(type)) {
      throw new Error(`Payment provider '${type}' is already registered`);
    }
    this.providers.set(type, provider);
  }

  /**
   * Gets a registered payment provider by type.
   *
   * @param providerType - The type of provider to get (e.g., 'stripe')
   * @returns The payment provider instance
   * @throws Error if provider is not registered
   */
  static get(providerType: string): PaymentProvider {
    const provider = this.providers.get(providerType);
    if (!provider) {
      throw new Error(`Payment provider '${providerType}' is not registered`);
    }
    return provider;
  }

  /**
   * Gets a payment provider if it exists, otherwise returns undefined.
   *
   * @param providerType - The type of provider to get
   * @returns The payment provider instance or undefined
   */
  static tryGet(providerType: string): PaymentProvider | undefined {
    return this.providers.get(providerType);
  }

  /**
   * Checks if a payment provider is registered.
   *
   * @param providerType - The type of provider to check
   * @returns true if the provider is registered
   */
  static has(providerType: string): boolean {
    return this.providers.has(providerType);
  }

  /**
   * Gets all registered provider types.
   *
   * @returns Array of registered provider type strings
   */
  static getRegisteredTypes(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Gets all registered providers.
   *
   * @returns Array of registered payment provider instances
   */
  static getAll(): PaymentProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Unregisters a payment provider.
   *
   * @param providerType - The type of provider to unregister
   * @returns true if the provider was unregistered
   */
  static unregister(providerType: string): boolean {
    return this.providers.delete(providerType);
  }

  /**
   * Clears all registered providers.
   * Primarily used for testing.
   */
  static clear(): void {
    this.providers.clear();
    this.initialized = false;
  }

  /**
   * Checks if the registry has been initialized.
   */
  static isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Marks the registry as initialized.
   */
  static markInitialized(): void {
    this.initialized = true;
  }
}

/**
 * Supported payment provider types.
 */
export const PAYMENT_PROVIDER_TYPES = {
  STRIPE: 'stripe',
  PAYPAL: 'paypal', // Future
  SQUARE: 'square', // Future
} as const;

export type PaymentProviderType = typeof PAYMENT_PROVIDER_TYPES[keyof typeof PAYMENT_PROVIDER_TYPES];
