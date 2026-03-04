'use client';

import React, { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { signIn } from 'next-auth/react';
import { Loader2 } from 'lucide-react';
import { SiGoogle } from 'react-icons/si';
import { Button } from '@alga-psa/ui/components/Button';

const MicrosoftMulticolorLogo = () => (
  <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="2" width="8" height="8" fill="#F25022" />
    <rect x="14" y="2" width="8" height="8" fill="#7FBA00" />
    <rect x="2" y="14" width="8" height="8" fill="#00A4EF" />
    <rect x="14" y="14" width="8" height="8" fill="#FFB900" />
  </svg>
);

type MspSsoProvider = {
  id: 'google' | 'azure-ad';
  name: string;
};

const MSP_SSO_PROVIDERS: MspSsoProvider[] = [
  { id: 'google', name: 'Sign in with Google' },
  { id: 'azure-ad', name: 'Sign in with Microsoft' },
];
const LAST_PROVIDER_STORAGE_KEY = 'msp_sso_last_provider';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SsoProviderButtonsProps {
  callbackUrl: string;
  tenantHint?: string;
  email?: string;
  onError?: (message: string) => void;
}

export default function SsoProviderButtons({
  callbackUrl,
  tenantHint,
  email,
  onError,
}: SsoProviderButtonsProps): React.ReactElement {
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [allowedProviders, setAllowedProviders] = useState<MspSsoProvider['id'][]>([]);
  const [preferredProvider, setPreferredProvider] = useState<MspSsoProvider['id'] | null>(null);
  const normalizedEmail = (email || '').trim().toLowerCase();
  const hasValidEmail = EMAIL_PATTERN.test(normalizedEmail);
  const genericStartFailureMessage =
    "We couldn't start SSO sign-in. Please verify provider setup and try again.";

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(LAST_PROVIDER_STORAGE_KEY);
    if (stored === 'google' || stored === 'azure-ad') {
      setPreferredProvider(stored);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!hasValidEmail) {
      setAllowedProviders([]);
      setIsDiscovering(false);
      return () => {
        cancelled = true;
      };
    }

    const runDiscovery = async () => {
      setIsDiscovering(true);
      try {
        const response = await fetch('/api/auth/msp/sso/discover', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email: normalizedEmail }),
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

        const providers = result.providers
          .filter((provider): provider is MspSsoProvider['id'] => provider === 'google' || provider === 'azure-ad');
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
  }, [hasValidEmail, normalizedEmail]);

  const orderedProviders = useMemo(() => {
    if (!preferredProvider || !allowedProviders.includes(preferredProvider)) {
      return MSP_SSO_PROVIDERS;
    }
    return [
      ...MSP_SSO_PROVIDERS.filter((provider) => provider.id === preferredProvider),
      ...MSP_SSO_PROVIDERS.filter((provider) => provider.id !== preferredProvider),
    ];
  }, [preferredProvider, allowedProviders]);

  const handleSignIn = async (providerId: MspSsoProvider['id']) => {
    if (!hasValidEmail || isDiscovering || !allowedProviders.includes(providerId)) return;
    setPendingProvider(providerId);
    try {
      onError?.('');
      const resolveResponse = await fetch('/api/auth/msp/sso/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          provider: providerId,
          email: normalizedEmail,
          callbackUrl,
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
        window.localStorage.setItem(LAST_PROVIDER_STORAGE_KEY, providerId);
      }
      setPreferredProvider(providerId);

      const statePayload: Record<string, unknown> = {
        mode: 'login',
        tenant: tenantHint ?? null,
      };

      const authorizationParams: Record<string, string> = {
        state: JSON.stringify(statePayload),
      };

      if (tenantHint) {
        authorizationParams.tenant_hint = tenantHint;
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
      return <SiGoogle className="h-8 w-8" style={{ color: '#34A853' }} aria-hidden />;
    }
    return <MicrosoftMulticolorLogo />;
  };

  return (
    <div className="flex gap-3">
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
              'flex items-center gap-2 px-6 py-2 h-auto',
              provider.id === 'google' && 'border-[#34A853] hover:bg-[#34A853]/5',
              provider.id === 'azure-ad' && 'border-[#0078D4] hover:bg-[#0078D4]/5'
            )}
          >
            {isPending ? <Loader2 className="h-8 w-8 animate-spin" /> : renderProviderIcon(provider.id)}
            {isPending ? 'Redirecting...' : provider.name}
          </Button>
        );
      })}
    </div>
  );
}
