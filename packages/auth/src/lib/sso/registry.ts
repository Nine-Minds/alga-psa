/**
 * SSO Registry - Registration pattern for OAuth/SSO functionality
 *
 * This allows EE to register its implementations without creating
 * a circular dependency (auth importing from ee-stubs).
 *
 * CE gets default stub implementations that throw or return empty values.
 * EE registers real implementations at startup.
 */

import type {
  OAuthProfileMappingInput,
  OAuthProfileMappingResult,
  OAuthAccountLinkInput,
  OAuthAccountLinkRecord,
  OAuthLinkProvider,
} from './types';

export interface SSOProviderRegistry {
  /**
   * Map an OAuth profile to an extended user object
   */
  mapOAuthProfileToExtendedUser: (
    input: OAuthProfileMappingInput
  ) => Promise<OAuthProfileMappingResult>;

  /**
   * Apply OAuth account hints to enrich user data
   */
  applyOAuthAccountHints: (
    user: OAuthProfileMappingResult,
    account: Record<string, unknown> | null | undefined
  ) => Promise<OAuthProfileMappingResult>;

  /**
   * Decode an OAuth JWT payload (id_token)
   */
  decodeOAuthJwtPayload: (
    token: string | undefined
  ) => Record<string, unknown> | undefined;

  /**
   * Upsert an OAuth account link
   */
  upsertOAuthAccountLink: (input: OAuthAccountLinkInput) => Promise<void>;

  /**
   * Find an existing OAuth account link by provider and account ID
   */
  findOAuthAccountLink: (
    provider: OAuthLinkProvider,
    providerAccountId: string
  ) => Promise<OAuthAccountLinkRecord | undefined>;

  /**
   * List all OAuth account links for a user
   */
  listOAuthAccountLinksForUser: (
    tenant: string,
    userId: string
  ) => Promise<OAuthAccountLinkRecord[]>;

  /**
   * Check if auto-linking is enabled for a tenant
   */
  isAutoLinkEnabledForTenant: (
    tenantId: string | undefined,
    userType: 'internal' | 'client'
  ) => Promise<boolean>;
}

/**
 * Default CE implementations - stubs that throw or return empty values
 */
const defaultRegistry: SSOProviderRegistry = {
  mapOAuthProfileToExtendedUser: async () => {
    throw new Error('OAuth providers are only available in Enterprise Edition');
  },

  applyOAuthAccountHints: async () => {
    throw new Error('OAuth providers are only available in Enterprise Edition');
  },

  decodeOAuthJwtPayload: () => {
    return undefined;
  },

  upsertOAuthAccountLink: async () => {
    throw new Error('OAuth account linking is only available in Enterprise Edition');
  },

  findOAuthAccountLink: async () => {
    return undefined;
  },

  listOAuthAccountLinksForUser: async () => {
    return [];
  },

  isAutoLinkEnabledForTenant: async () => {
    return false;
  },
};

let registry: SSOProviderRegistry = { ...defaultRegistry };

/**
 * Register SSO provider implementations (called by EE at startup)
 */
export function registerSSOProvider(impl: Partial<SSOProviderRegistry>): void {
  registry = { ...registry, ...impl };
}

/**
 * Get the current SSO registry (used by auth code)
 */
export function getSSORegistry(): SSOProviderRegistry {
  return registry;
}

/**
 * Reset to default registry (for testing)
 */
export function resetSSORegistry(): void {
  registry = { ...defaultRegistry };
}
