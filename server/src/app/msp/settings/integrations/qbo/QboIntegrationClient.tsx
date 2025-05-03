'use client';

import React, { useState, useTransition } from 'react';
import { Button } from 'server/src/components/ui/Button'; // Use corrected path
import { disconnectQbo, getQboConnectionStatus } from 'server/src/lib/actions/integrations/qboActions'; // Use corrected path
import { Alert, AlertDescription } from 'server/src/components/ui/Alert'; // Use corrected path
import { Loader2 } from 'lucide-react';

// Match the server action return type
interface QboConnectionStatus {
  connected: boolean;
  realmId?: string;
  companyName?: string;
  error?: string;
}

interface QboIntegrationClientProps {
  initialStatus: QboConnectionStatus;
}

export default function QboIntegrationClient({ initialStatus }: QboIntegrationClientProps) {
  const [status, setStatus] = useState<QboConnectionStatus>(initialStatus);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(initialStatus.error || null);

  const handleConnect = () => {
    // Redirect user to the backend endpoint to initiate OAuth flow
    window.location.href = '/api/integrations/qbo/connect';
  };

  const handleDisconnect = () => {
    setError(null); // Clear previous errors
    startTransition(async () => {
      const result = await disconnectQbo();
      if (result.success) {
        // Optimistically update status, or re-fetch
        setStatus({ connected: false });
        // Optionally, show a success message
      } else {
        setError(result.error || 'Failed to disconnect QuickBooks.');
      }
    });
  };

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            <strong className="font-semibold">Error:</strong> {error}
          </AlertDescription>
        </Alert>
      )}

      {status.connected ? (
        <div className="flex items-center justify-between p-4 border rounded-md bg-green-50 border-green-200">
          <div>
            <p className="font-medium text-green-800">Connected to QuickBooks Online</p>
            {status.realmId && <p className="text-sm text-gray-600">Realm ID: {status.realmId}</p>}
            {/* Optional: Display company name if available */}
            {/* {status.companyName && <p className="text-sm text-gray-600">Company: {status.companyName}</p>} */}
          </div>
          <Button
            id="disconnect-qbo-button"
            variant="destructive"
            onClick={handleDisconnect}
            disabled={isPending}
          >
            {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Disconnect
          </Button>
        </div>
      ) : (
        <div>
          <p className="mb-4 text-sm text-gray-600">
            Click the button below to start the connection process with your QuickBooks Online account.
          </p>
          <Button
            id="connect-qbo-button"
            onClick={handleConnect}
            disabled={isPending} // Disable if a disconnect is pending, though unlikely state
          >
            Connect to QuickBooks
          </Button>
        </div>
      )}
    </div>
  );
}