'use client';

import React from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';

// We load @microsoft/teams-js dynamically to avoid pulling it into any non-Teams
// bundle path. The SDK is only meaningful when the page is hosted inside the
// Teams client; outside that context we immediately fall back to the normal
// MSP sign-in redirect.
type TeamsSdk = typeof import('@microsoft/teams-js');

type GateStatus =
  | { kind: 'initializing' }
  | { kind: 'in_teams' }
  | { kind: 'not_in_teams' }
  | { kind: 'authenticating' }
  | { kind: 'error'; message: string };

interface TeamsTabSignInGateProps {
  // Where to send the user when they are NOT inside the Teams client — the
  // normal full-page MSP sign-in with the original tab URL as the callback.
  fallbackSignInUrl: string;
  // URL opened in the Teams auth popup. Must be same-origin and must render
  // the MSP sign-in flow with `callbackUrl` pointing at the popup-complete
  // page so the popup can call notifySuccess() after login.
  popupSignInUrl: string;
}

export function TeamsTabSignInGate({ fallbackSignInUrl, popupSignInUrl }: TeamsTabSignInGateProps) {
  const [status, setStatus] = React.useState<GateStatus>({ kind: 'initializing' });
  const sdkRef = React.useRef<TeamsSdk | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const sdk = await import('@microsoft/teams-js');
        await sdk.app.initialize();
        if (cancelled) return;
        sdkRef.current = sdk;
        setStatus({ kind: 'in_teams' });
      } catch {
        if (cancelled) return;
        // Initialize throws when not hosted by Teams. Fall back to the normal
        // top-level MSP sign-in page so browser users still get the full flow.
        window.location.replace(fallbackSignInUrl);
        setStatus({ kind: 'not_in_teams' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fallbackSignInUrl]);

  const handleSignIn = React.useCallback(async () => {
    const sdk = sdkRef.current;
    if (!sdk) {
      window.location.replace(fallbackSignInUrl);
      return;
    }

    setStatus({ kind: 'authenticating' });

    try {
      await sdk.authentication.authenticate({
        url: new URL(popupSignInUrl, window.location.origin).toString(),
        width: 600,
        height: 700,
      });
      // On success the popup calls notifySuccess; reloading the tab re-runs
      // the server-side auth check which should now find the fresh session.
      window.location.reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-in was cancelled or failed.';
      setStatus({ kind: 'error', message });
    }
  }, [fallbackSignInUrl, popupSignInUrl]);

  if (status.kind === 'initializing' || status.kind === 'not_in_teams') {
    return (
      <Card className="m-6 p-6 text-sm text-gray-700">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-gray-900">Loading…</h1>
          <p>Preparing the Alga PSA tab.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="m-6 p-6 text-sm text-gray-700">
      <div className="space-y-4">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-gray-900">Sign in to Alga PSA</h1>
          <p>
            Teams needs to open a secure sign-in window to finish linking your account. Your existing
            browser session cannot be used from inside Teams.
          </p>
          {status.kind === 'error' ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
              {status.message}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            id="teams-tab-signin"
            onClick={() => void handleSignIn()}
            disabled={status.kind === 'authenticating'}
          >
            {status.kind === 'authenticating' ? 'Opening sign-in…' : 'Sign in to Alga PSA'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
