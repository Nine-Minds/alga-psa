'use client';

import React from 'react';
import { Card } from '@alga-psa/ui/components/Card';

type CompleteStatus =
  | { kind: 'initializing' }
  | { kind: 'notified' }
  | { kind: 'error'; message: string };

export function TeamsTabPopupComplete() {
  const [status, setStatus] = React.useState<CompleteStatus>({ kind: 'initializing' });

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const sdk = await import('@microsoft/teams-js');
        await sdk.app.initialize();
        if (cancelled) return;
        sdk.authentication.notifySuccess('signed-in');
        setStatus({ kind: 'notified' });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Could not notify Teams of sign-in.';
        setStatus({ kind: 'error', message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card className="m-6 p-6 text-sm text-gray-700">
      <div className="space-y-2">
        <h1 className="text-lg font-semibold text-gray-900">Signed in</h1>
        {status.kind === 'initializing' ? (
          <p>Finalizing your Teams session…</p>
        ) : status.kind === 'notified' ? (
          <p>You can close this window if it does not close automatically.</p>
        ) : (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
            {status.message}
          </p>
        )}
      </div>
    </Card>
  );
}
