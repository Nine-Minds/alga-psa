"use client";

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import Spinner from '@alga-psa/ui/components/Spinner';

import { Button } from '@alga-psa/ui/components/Button';

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

export default function PortalSessionHandoff({
  ott,
  returnPath,
  fallbackLoginUrl,
}: PortalSessionHandoffProps) {
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
      toast.error('The login handoff token is missing or invalid. Please sign in again.');
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    async function exchangeSession(): Promise<void> {
      setState('loading');
      setError(null);

      try {
        const response = await fetch('/api/client-portal/domain-session', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ott, returnPath }),
          signal: controller.signal,
        });

        const payload: ExchangeResponse = await response.json().catch(() => ({}));

        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setState('error');
          setError('We could not create a session on this domain. Please try signing in again.');
          if (payload?.canonicalHost) {
            setCanonicalHost(payload.canonicalHost);
          }
          toast.error('We could not finalize your login. Please try signing in again.');
          return;
        }

        if (payload?.canonicalHost) {
          setCanonicalHost(payload.canonicalHost);
        }

        const destination = payload?.redirectTo || '/client-portal/dashboard';
        router.replace(destination);
      } catch (fetchError) {
        if (cancelled) {
          return;
        }
        setState('error');
        setError('We encountered a network issue while finalizing your login.');
        toast.error('Network issue detected while finalizing your login. Please try again.');
      }
    }

    void exchangeSession();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [ott, returnPath, router]);

  const handleReturnToSignin = () => {
    window.location.href = canonicalLoginUrl;
  };

  if (state === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-24">
        <div className="max-w-md rounded-lg bg-white p-8 shadow-lg">
          <h1 className="text-2xl font-semibold text-gray-900">We couldn’t finalize your login</h1>
          <p className="mt-4 text-gray-600">
            {error || 'The one-time access token is no longer valid. Please return to the sign-in page and try again.'}
          </p>

          <div className="mt-6 space-y-3">
            <Button id="return-to-signin-button" className="w-full" onClick={handleReturnToSignin}>
              Return to Sign In
            </Button>
            <p className="text-sm text-gray-500 text-center">
              You’ll be redirected to our secure sign-in page to restart the process.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 py-24">
      <div className="flex items-center gap-3 rounded-lg bg-white px-6 py-5 shadow-md">
        <Spinner size="sm" className="text-indigo-600" />
        <div>
          <p className="text-sm font-medium text-gray-900">Preparing your secure session</p>
          <p className="text-sm text-gray-500">Hold tight—this usually takes just a second.</p>
        </div>
      </div>
    </div>
  );
}
