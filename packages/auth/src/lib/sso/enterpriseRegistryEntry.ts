import type { SSOProviderRegistry } from './registry';

/**
 * Edition-neutral entrypoint for loading Enterprise SSO registry implementations.
 *
 * Implementation notes:
 * - Uses `@enterprise/*` dynamic imports so Community Edition can compile against stubs.
 * - Enterprise builds rewrite `@enterprise/*` to EE sources during bundling.
 */
export async function loadEnterpriseSsoProviderRegistryImpl(): Promise<
  Partial<SSOProviderRegistry> | null
> {
  try {
    const ssoProviders = await import('@enterprise/lib/auth/ssoProviders');
    const oauthAccountLinks = await import('@enterprise/lib/auth/oauthAccountLinks');
    const ssoAutoLink = await import('@enterprise/lib/auth/ssoAutoLink');

    const mapOAuthProfileToExtendedUser = (ssoProviders as any).mapOAuthProfileToExtendedUser;

    // If we resolved to CE stubs, don't register anything.
    if (
      typeof mapOAuthProfileToExtendedUser !== 'function' ||
      String(mapOAuthProfileToExtendedUser).includes('OAuth providers are only available in Enterprise Edition')
    ) {
      return null;
    }

    return {
      mapOAuthProfileToExtendedUser,
      applyOAuthAccountHints: (ssoProviders as any).applyOAuthAccountHints,
      decodeOAuthJwtPayload: (ssoProviders as any).decodeOAuthJwtPayload,
      upsertOAuthAccountLink: (oauthAccountLinks as any).upsertOAuthAccountLink,
      findOAuthAccountLink: (oauthAccountLinks as any).findOAuthAccountLink,
      listOAuthAccountLinksForUser: (oauthAccountLinks as any).listOAuthAccountLinksForUser,
      isAutoLinkEnabledForTenant: (ssoAutoLink as any).isAutoLinkEnabledForTenant,
    };
  } catch {
    return null;
  }
}
