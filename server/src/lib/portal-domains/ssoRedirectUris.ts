import {
  evaluateSsoRedirectUriGate,
  getRequiredSsoRedirectUris,
  portalDomainServes,
  readSsoRedirectUriState,
  type PortalDomainSurface,
  type SsoRedirectUriState,
} from '@alga-psa/shared/core/portalDomainSurface';

type Env = Record<string, string | undefined>;

/**
 * Platform-level SSO providers NextAuth is configured with (mirrors the env checks in
 * packages/auth nextAuthOptions). Tenant-configured providers are added by
 * detectTenantSsoProviders / resolveSsoProvidersForTenant.
 */
export function detectConfiguredSsoProviders(env: Env = process.env): string[] {
  const providers: string[] = [];
  if (env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET) providers.push('google');
  if (env.MICROSOFT_OAUTH_CLIENT_ID && env.MICROSOFT_OAUTH_CLIENT_SECRET) providers.push('azure-ad');
  if (env.KEYCLOAK_CLIENT_ID && env.KEYCLOAK_URL) providers.push('keycloak');
  return providers;
}

export interface TenantSsoProviderLookups {
  getTenantSecret: (tenant: string, key: string) => Promise<string | null | undefined>;
  /** Read-only: true when the tenant's Microsoft `msp_sso` consumer profile is ready. */
  isMicrosoftMspSsoReady: (tenant: string) => Promise<boolean>;
}

const isSet = (value: string | null | undefined): boolean => typeof value === 'string' && value.trim().length > 0;

async function defaultTenantSsoLookups(): Promise<TenantSsoProviderLookups> {
  const { getSecretProviderInstance } = await import('@alga-psa/core/secrets');
  const secretProvider = await getSecretProviderInstance();
  return {
    getTenantSecret: (tenant, key) => secretProvider.getTenantSecret(tenant, key),
    isMicrosoftMspSsoReady: async (tenant) => {
      // Read-only variant: a settings save must never migrate/mutate consumer bindings.
      const { resolveMicrosoftConsumerProfileConfigReadOnly } = await import(
        '@alga-psa/integrations/lib/microsoftConsumerProfileResolution'
      );
      const resolution = await resolveMicrosoftConsumerProfileConfigReadOnly(tenant, 'msp_sso');
      return resolution.status === 'ready';
    },
  };
}

/**
 * SSO providers the TENANT has configured with its own credentials (the same sources
 * nextAuthOptions uses for tenant-scoped OAuth: tenant Google secrets, the Microsoft
 * `msp_sso` consumer profile, tenant Keycloak secrets). Their callback URI on a custom
 * domain is the same `/api/auth/callback/<provider>` URI, so they gate activation too.
 * A failed lookup is reported as "not configured" for that provider only.
 */
export async function detectTenantSsoProviders(
  tenant: string,
  lookups?: TenantSsoProviderLookups
): Promise<string[]> {
  const deps = lookups ?? (await defaultTenantSsoLookups());
  const safe = async (check: () => Promise<boolean>) => check().catch(() => false);
  const [google, microsoft, keycloak] = await Promise.all([
    safe(async () => {
      const [id, secret] = await Promise.all([
        deps.getTenantSecret(tenant, 'google_client_id'),
        deps.getTenantSecret(tenant, 'google_client_secret'),
      ]);
      return isSet(id) && isSet(secret);
    }),
    safe(() => deps.isMicrosoftMspSsoReady(tenant)),
    safe(async () => {
      const values = await Promise.all(
        ['keycloak_url', 'keycloak_realm', 'keycloak_client_id', 'keycloak_client_secret'].map((key) =>
          deps.getTenantSecret(tenant, key)
        )
      );
      return values.every(isSet);
    }),
  ]);
  return [google && 'google', microsoft && 'azure-ad', keycloak && 'keycloak'].filter(
    (provider): provider is string => typeof provider === 'string'
  );
}

/** Platform (env) providers plus the tenant's own: every provider that can sign in on the domain. */
export async function resolveSsoProvidersForTenant(
  tenant: string,
  options: { env?: Env; lookups?: TenantSsoProviderLookups } = {}
): Promise<string[]> {
  let tenantProviders: string[] = [];
  try {
    tenantProviders = await detectTenantSsoProviders(tenant, options.lookups);
  } catch (error) {
    console.warn('[portal-domains] tenant SSO provider lookup failed; using platform providers only', {
      tenant,
      error: error instanceof Error ? error.message : error,
    });
  }
  return [...new Set([...detectConfiguredSsoProviders(options.env ?? process.env), ...tenantProviders])].sort();
}

/**
 * STUB for automating redirect-URI registration. Provider consoles (Google Cloud,
 * Entra) have no API we drive from here, so nothing is registered automatically. The
 * only automatic confirmation is an operator-declared one: when
 * PORTAL_DOMAIN_SSO_REDIRECT_URIS_PREREGISTERED=true the operator asserts that the
 * redirect URIs for custom domains are registered out of band (wildcard / managed by
 * their own tooling), and every required URI counts as confirmed.
 */
export function confirmViaAutomation(required: string[], env: Env = process.env): string[] {
  return env.PORTAL_DOMAIN_SSO_REDIRECT_URIS_PREREGISTERED === 'true' ? [...required] : [];
}

/**
 * Compute the redirect-URI state stored in verification_details.sso_redirect_uris for a
 * (domain, surface). Returns null for surfaces that don't serve the MSP app (nothing to
 * register: client portal SSO authenticates on the canonical host). Confirmations from a
 * previous state are kept only for URIs that are still required (so a domain change
 * invalidates them).
 */
export function buildSsoRedirectUriState(args: {
  domain: string;
  surface: PortalDomainSurface;
  previous?: SsoRedirectUriState | null;
  env?: Env;
  /** Providers that can sign in (resolveSsoProvidersForTenant). Defaults to the platform (env) providers. */
  providers?: readonly string[];
}): SsoRedirectUriState | null {
  const env = args.env ?? process.env;
  if (!portalDomainServes(args.surface, 'msp')) {
    return null;
  }

  const providers = args.providers ?? detectConfiguredSsoProviders(env);
  const required = getRequiredSsoRedirectUris(args.domain, providers);
  if (required.length === 0) {
    return { required, confirmed: [], source: 'not_required' };
  }

  const kept = (args.previous?.confirmed ?? []).filter((uri) => required.includes(uri));
  const automated = confirmViaAutomation(required, env);
  const confirmed = [...new Set([...kept, ...automated])];
  return {
    required,
    confirmed,
    source: automated.length > 0 ? 'automation' : args.previous?.source === 'operator' && kept.length > 0 ? 'operator' : undefined,
    ...(confirmed.length > 0 && args.previous?.confirmed_at ? { confirmed_at: args.previous.confirmed_at } : {}),
  };
}

/** Operator/admin attests that every required URI is registered. */
export function confirmAllRequired(state: SsoRedirectUriState, now: Date = new Date()): SsoRedirectUriState {
  return { ...state, confirmed: [...state.required], source: 'operator', confirmed_at: now.toISOString() };
}

export function withSsoRedirectUriState(
  details: Record<string, unknown> | null | undefined,
  state: SsoRedirectUriState | null
): Record<string, unknown> {
  const { sso_redirect_uris: _discarded, ...rest } = details ?? {};
  return state ? { ...rest, sso_redirect_uris: state } : rest;
}

export function describeMissingRedirectUris(missing: string[]): string {
  return missing.length > 0
    ? `Not activated yet: SSO sign-in on this domain needs ${missing.length === 1 ? 'this redirect URI' : 'these redirect URIs'} ` +
      `added to the allowed redirect/callback URIs of your identity provider(s): ${missing.join(', ')}. ` +
      'Add them in the provider console, then confirm here.'
    : 'Waiting for confirmation that SSO redirect URIs are registered for this domain.';
}

export { evaluateSsoRedirectUriGate, readSsoRedirectUriState };
