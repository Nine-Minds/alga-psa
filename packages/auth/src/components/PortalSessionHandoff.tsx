"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Spinner, Button } from '@alga-psa/ui/components';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface PortalSessionHandoffProps {
  ott: string | null;
  returnPath?: string;
  fallbackLoginUrl: string;
}

type ExchangeState = 'idle' | 'loading' | 'error';

interface ExchangeResponse {
  redirectTo?: string;
  canonicalHost?: string;
}

type ExchangeOutcome =
  | { ok: true; redirectTo: string; canonicalHost?: string }
  | { ok: false; kind: 'http' | 'network'; canonicalHost?: string };

// Dedupe the OTT exchange by token at module scope. The OTT is single-use, so it
// must be POSTed at most once even if the handoff component mounts more than once
// (e.g. a Suspense-driven remount). A second POST races the first and fails with
// `already_consumed`, surfacing an error even though the login actually succeeded.
const exchangesByOtt = new Map<string, Promise<ExchangeOutcome>>();

async function performExchange(ott: string, returnPath?: string): Promise<ExchangeOutcome> {
  try {
    const response = await fetch('/api/client-portal/domain-session', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ott, returnPath }),
    });

    const payload: ExchangeResponse = await response.json().catch(() => ({}));

    if (!response.ok) {
      return { ok: false, kind: 'http', canonicalHost: payload?.canonicalHost };
    }

    return {
      ok: true,
      redirectTo: payload?.redirectTo || '/client-portal/dashboard',
      canonicalHost: payload?.canonicalHost,
    };
  } catch {
    return { ok: false, kind: 'network' };
  }
}

function exchangeOnce(ott: string, returnPath?: string): Promise<ExchangeOutcome> {
  let existing = exchangesByOtt.get(ott);
  if (!existing) {
    existing = performExchange(ott, returnPath);
    exchangesByOtt.set(ott, existing);
  }
  return existing;
}

export default function PortalSessionHandoff({
  ott,
  returnPath,
  fallbackLoginUrl,
}: PortalSessionHandoffProps) {
  const { t } = useTranslation('common');
  const router = useRouter();
  const [state, setState] = useState<ExchangeState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [canonicalHost, setCanonicalHost] = useState<string | null>(null);

  const canonicalLoginUrl = useMemo(() => {
    if (canonicalHost) {
      return `https://${canonicalHost}/auth/client-portal/signin`;
    }

    return fallbackLoginUrl;
  }, [canonicalHost, fallbackLoginUrl]);

  useEffect(() => {
    if (!ott || ott.length === 0) {
      setState('error');
      setError('Missing or invalid login token. Please try signing in again.');
      toast.error(t('auth.messages.handoffMissingToken'));
      return;
    }

    let active = true;
    setState('loading');
    setError(null);

    // Reuse the in-flight/settled exchange for this OTT rather than firing (and
    // aborting) a request per mount. The exchange irreversibly consumes the OTT
    // and mints the session, so aborting it would throw away a successful login.
    exchangeOnce(ott, returnPath).then((outcome) => {
      if (!active) {
        return;
      }

      if (outcome.canonicalHost) {
        setCanonicalHost(outcome.canonicalHost);
      }

      if (outcome.ok) {
        router.replace(outcome.redirectTo);
        return;
      }

      setState('error');
      if (outcome.kind === 'network') {
        setError('We encountered a network issue while finalizing your login.');
        toast.error(t('auth.messages.handoffNetworkIssue'));
      } else {
        setError('We could not create a session on this domain. Please try signing in again.');
        toast.error(t('auth.messages.handoffFinalizeFailed'));
      }
    });

    return () => {
      active = false;
    };
  }, [ott, returnPath, router]);

  const handleReturnToSignin = () => {
    window.location.href = canonicalLoginUrl;
  };

  if (state === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[rgb(var(--color-background-50))] px-6 py-24">
        <div className="max-w-md rounded-lg bg-card p-8 shadow-lg">
          <h1 className="text-2xl font-semibold text-[rgb(var(--color-text-900))]">We couldn’t finalize your login</h1>
          <p className="mt-4 text-[rgb(var(--color-text-600))]">
            {error || 'The one-time access token is no longer valid. Please return to the sign-in page and try again.'}
          </p>

          <div className="mt-6 space-y-3">
            <Button id="return-to-signin-button" className="w-full" onClick={handleReturnToSignin}>
              Return to Sign In
            </Button>
            <p className="text-sm text-[rgb(var(--color-text-500))] text-center">
              You’ll be redirected to our secure sign-in page to restart the process.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[rgb(var(--color-background-50))] px-6 py-24">
      <div className="flex items-center gap-3 rounded-lg bg-card px-6 py-5 shadow-md">
        <Spinner size="sm" className="text-[rgb(var(--color-primary-500))]" />
        <div>
          <p className="text-sm font-medium text-[rgb(var(--color-text-900))]">Preparing your secure session</p>
          <p className="text-sm text-[rgb(var(--color-text-500))]">Hold tight—this usually takes just a second.</p>
        </div>
      </div>
    </div>
  );
}
