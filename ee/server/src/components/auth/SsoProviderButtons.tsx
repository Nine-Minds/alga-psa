'use client';

import React, { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { signIn } from 'next-auth/react';
import { Loader2 } from 'lucide-react';
import { SiKeycloak } from 'react-icons/si';
import { GoogleIcon } from '@alga-psa/ui/components/GoogleIcon';
// Imports react-i18next directly rather than the @alga-psa/ui wrapper: the MSP
// sign-in page renders this outside any I18nProvider, so `useSuspense: false`
// keeps it from throwing a promise with no Suspense boundary above it, and each
// defaultValue keeps the button readable when i18next was never initialised.
import { useTranslation } from 'react-i18next';
import { Button } from '@alga-psa/ui/components/Button';

// LEVERAGE: pattern sso-provider-buttons — byte-identical copy lives at
// packages/auth/src/components/SsoProviderButtons.tsx; the CE/EE split has no
// behavioural difference, so both copies must be edited in lockstep.

const MicrosoftMulticolorLogo = () => (
  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="2" width="8" height="8" fill="#F25022" />
    <rect x="14" y="2" width="8" height="8" fill="#7FBA00" />
    <rect x="2" y="14" width="8" height="8" fill="#00A4EF" />
    <rect x="14" y="14" width="8" height="8" fill="#FFB900" />
  </svg>
);

type MspSsoProvider = {
  id: 'google' | 'azure-ad' | 'keycloak';
  nameKey: string;
  nameFallback: string;
};

const MSP_SSO_PROVIDERS: MspSsoProvider[] = [
  { id: 'google', nameKey: 'auth.sso.signInWithGoogle', nameFallback: 'Sign in with Google' },
  { id: 'azure-ad', nameKey: 'auth.sso.signInWithMicrosoft', nameFallback: 'Sign in with Microsoft' },
  { id: 'keycloak', nameKey: 'auth.sso.signInWithKeycloak', nameFallback: 'Sign in with Keycloak' },
];
const MSP_SSO_PROVIDER_IDS = new Set<string>(MSP_SSO_PROVIDERS.map((provider) => provider.id));

function isMspSsoProviderId(value: unknown): value is MspSsoProvider['id'] {
  return typeof value === 'string' && MSP_SSO_PROVIDER_IDS.has(value);
}

// Same rule as `isEnterprise` in @alga-psa/core/features, read at render time so
// one bundle can be exercised under both editions.
function isEnterpriseEdition(): boolean {
  return (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';
}

// Community Edition ships Keycloak as its only SSO provider (mirroring the
// single-vendor CE integrations such as Tactical RMM); Google and Microsoft
// sign-in stay Enterprise. The discovery endpoints enforce the same split.
function visibleProviders(authSurface: 'msp' | 'client_portal'): MspSsoProvider[] {
  if (isEnterpriseEdition()) return MSP_SSO_PROVIDERS;
  // The CE profile mapper only resolves internal MSP users.
  if (authSurface === 'client_portal') return [];
  return MSP_SSO_PROVIDERS.filter((provider) => provider.id === 'keycloak');
}
const LAST_PROVIDER_STORAGE_KEY = 'msp_sso_last_provider';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SsoProviderButtonsProps {
  callbackUrl: string;
  tenantHint?: string;
  portalDomainHint?: string;
  email?: string;
  publicWorkstation?: boolean;
  onError?: (message: string) => void;
  authSurface?: 'msp' | 'client_portal';
  discoveryEndpoint?: string;
  resolveEndpoint?: string;
  storageKey?: string;
}

export default function SsoProviderButtons({
  callbackUrl,
  tenantHint,
  portalDomainHint,
  email,
  publicWorkstation = false,
  onError,
  authSurface = 'msp',
  discoveryEndpoint,
  resolveEndpoint,
  storageKey,
}: SsoProviderButtonsProps): React.ReactElement {
  const { t } = useTranslation('common', { useSuspense: false });
  const editionProviders = useMemo(() => visibleProviders(authSurface), [authSurface]);
  // A provider button exists when NextAuth registers it app-wide (deployment-level
  // credentials) or when discovery offers it for the typed email (tenant-level
  // credentials, which NextAuth only loads once sign-in resolution runs). Until
  // the registry answers, every edition-visible provider renders (disabled) so
  // SSR and the first paint stay stable.
  const [registeredProviders, setRegisteredProviders] = useState<Set<string> | null>(null);
  const [allowedProviders, setAllowedProviders] = useState<MspSsoProvider['id'][]>([]);
  const providers = useMemo(
    () =>
      registeredProviders
        ? editionProviders.filter(
            (provider) => registeredProviders.has(provider.id) || allowedProviders.includes(provider.id)
          )
        : editionProviders,
    [editionProviders, registeredProviders, allowedProviders]
  );
  // Discovery runs against the edition set, not the visible set: a tenant-only
  // provider is invisible until discovery names it.
  const discoveryKey = editionProviders.map((provider) => provider.id).join(',');
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [preferredProvider, setPreferredProvider] = useState<MspSsoProvider['id'] | null>(null);
  const normalizedEmail = (email || '').trim().toLowerCase();
  const hasValidEmail = EMAIL_PATTERN.test(normalizedEmail);
  const genericStartFailureMessage = t('auth.sso.startFailed', {
    defaultValue: "We couldn't start SSO sign-in. Please verify provider setup and try again.",
  });
  const effectiveDiscoveryEndpoint =
    discoveryEndpoint ??
    (authSurface === 'client_portal'
      ? '/api/auth/client-portal/sso/discover'
      : '/api/auth/msp/sso/discover');
  const effectiveResolveEndpoint =
    resolveEndpoint ??
    (authSurface === 'client_portal'
      ? '/api/auth/client-portal/sso/resolve'
      : '/api/auth/msp/sso/resolve');
  const effectiveStorageKey =
    storageKey ??
    (authSurface === 'client_portal'
      ? 'client_portal_sso_last_provider'
      : LAST_PROVIDER_STORAGE_KEY);
  const inferredPortalDomain =
    typeof window !== 'undefined' ? window.location.hostname : undefined;
  const portalDomainContext =
    portalDomainHint || (authSurface === 'client_portal' ? inferredPortalDomain : undefined);

  useEffect(() => {
    if (editionProviders.length === 0) return;
    let cancelled = false;
    const loadRegisteredProviders = async () => {
      try {
        const response = await fetch('/api/auth/providers', { credentials: 'include' });
        if (!response.ok) return;
        const registry = (await response.json()) as Record<string, unknown> | null;
        if (cancelled || !registry || typeof registry !== 'object') return;
        setRegisteredProviders(new Set(Object.keys(registry)));
      } catch {
        // Leave the edition set in place; discovery still gates each button.
      }
    };
    void loadRegisteredProviders();
    return () => {
      cancelled = true;
    };
  }, [editionProviders]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(effectiveStorageKey);
    if (isMspSsoProviderId(stored)) {
      setPreferredProvider(stored);
    }
  }, [effectiveStorageKey]);

  useEffect(() => {
    let cancelled = false;

    if (!hasValidEmail || discoveryKey.length === 0) {
      setAllowedProviders([]);
      setIsDiscovering(false);
      return () => {
        cancelled = true;
      };
    }

    const runDiscovery = async () => {
      setIsDiscovering(true);
      try {
        const response = await fetch(effectiveDiscoveryEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            email: normalizedEmail,
            tenantSlug: tenantHint,
            portalDomain: portalDomainContext,
            callbackUrl,
          }),
        });

        let result: { providers?: unknown } | null = null;
        try {
          result = await response.json();
        } catch {
          result = null;
        }

        if (cancelled) return;
        if (!response.ok || !Array.isArray(result?.providers)) {
          setAllowedProviders([]);
          return;
        }

        const providers = result.providers.filter(isMspSsoProviderId);
        setAllowedProviders(Array.from(new Set(providers)));
      } catch {
        if (!cancelled) {
          setAllowedProviders([]);
        }
      } finally {
        if (!cancelled) {
          setIsDiscovering(false);
        }
      }
    };

    void runDiscovery();

    return () => {
      cancelled = true;
    };
  }, [callbackUrl, effectiveDiscoveryEndpoint, hasValidEmail, normalizedEmail, portalDomainContext, discoveryKey, tenantHint]);

  const orderedProviders = useMemo(() => {
    if (!preferredProvider || !allowedProviders.includes(preferredProvider)) {
      return providers;
    }
    return [
      ...providers.filter((provider) => provider.id === preferredProvider),
      ...providers.filter((provider) => provider.id !== preferredProvider),
    ];
  }, [providers, preferredProvider, allowedProviders]);

  const handleSignIn = async (providerId: MspSsoProvider['id']) => {
    if (!hasValidEmail || isDiscovering || !allowedProviders.includes(providerId)) return;
    if (!providers.some((provider) => provider.id === providerId)) return;
    setPendingProvider(providerId);
    try {
      onError?.('');
      const resolveResponse = await fetch(effectiveResolveEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          provider: providerId,
          email: normalizedEmail,
          publicWorkstation,
          callbackUrl,
          tenantSlug: tenantHint,
          portalDomain: portalDomainContext,
        }),
      });

      let resolveResult: { ok?: boolean; message?: string } | null = null;
      try {
        resolveResult = await resolveResponse.json();
      } catch {
        resolveResult = null;
      }

      if (!resolveResponse.ok || !resolveResult?.ok) {
        onError?.(genericStartFailureMessage);
        return;
      }

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(effectiveStorageKey, providerId);
      }
      setPreferredProvider(providerId);

      if (
        process.env.NEXT_PUBLIC_PLAYWRIGHT_FAKE_GOOGLE_OAUTH === 'true' &&
        providerId === 'google'
      ) {
        const completionUrl = new URL('/api/auth/e2e/google/complete', window.location.origin);
        completionUrl.searchParams.set('callbackUrl', callbackUrl);
        window.location.assign(completionUrl.toString());
        return;
      }

      const statePayload: Record<string, unknown> = {
        mode: 'login',
        user_type: authSurface === 'client_portal' ? 'client' : 'internal',
        tenant: tenantHint ?? null,
        callback_url: callbackUrl,
      };

      const authorizationParams: Record<string, string> = {
        state: JSON.stringify(statePayload),
      };

      if (tenantHint) {
        authorizationParams.tenant_hint = tenantHint;
      }
      if (authSurface === 'client_portal') {
        authorizationParams.user_type = 'client';
      }

      await signIn(providerId, { callbackUrl }, authorizationParams);
    } catch {
      onError?.(genericStartFailureMessage);
    } finally {
      setPendingProvider(null);
    }
  };

  const renderProviderIcon = (providerId: MspSsoProvider['id']) => {
    if (providerId === 'google') {
      return <GoogleIcon className="h-6 w-6" style={{ color: '#34A853' }} aria-hidden />;
    }
    if (providerId === 'keycloak') {
      return <SiKeycloak className="h-6 w-6" style={{ color: '#4D4D4D' }} aria-hidden />;
    }
    return <MicrosoftMulticolorLogo />;
  };

  if (orderedProviders.length === 0) {
    return <></>;
  }

  return (
    <div className="flex flex-col gap-3">
      {orderedProviders.map((provider) => {
        const isPending = pendingProvider === provider.id;
        const isAllowed = allowedProviders.includes(provider.id);
        const isDisabled = !hasValidEmail || isDiscovering || isPending || !isAllowed;

        return (
          <Button
            key={provider.id}
            id={`sso-provider-${provider.id}-button`}
            type="button"
            variant="outline"
            size="lg"
            onClick={() => handleSignIn(provider.id)}
            disabled={isDisabled}
            autoFocus={Boolean(preferredProvider && preferredProvider === provider.id && isAllowed)}
            data-preferred={preferredProvider === provider.id && isAllowed ? 'true' : 'false'}
            className={clsx(
              'flex w-full items-center justify-center gap-2 whitespace-nowrap px-6 py-2 h-auto',
              provider.id === 'google' && 'border-[#34A853] hover:bg-[#34A853]/5',
              provider.id === 'azure-ad' && 'border-[#0078D4] hover:bg-[#0078D4]/5',
              provider.id === 'keycloak' && 'border-[#4D4D4D] hover:bg-[#4D4D4D]/5'
            )}
          >
            {isPending ? <Loader2 className="h-6 w-6 animate-spin" /> : renderProviderIcon(provider.id)}
            {isPending
              ? t('auth.sso.redirecting', { defaultValue: 'Redirecting...' })
              : t(provider.nameKey, { defaultValue: provider.nameFallback })}
          </Button>
        );
      })}
    </div>
  );
}
