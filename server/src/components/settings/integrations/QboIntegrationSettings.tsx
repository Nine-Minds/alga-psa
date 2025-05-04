'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../ui/Card'; // Use relative path
import { Button } from '../../ui/Button'; // Use relative path
import { Alert, AlertDescription } from '../../ui/Alert'; // Use relative path (Removed AlertTitle)
import { Loader2, CheckCircle, XCircle, AlertCircle, Link, Unlink } from 'lucide-react'; // Icons
import { getQboConnectionStatus, disconnectQbo, QboConnectionStatus } from '../../../lib/actions/integrations/qboActions'; // Use relative path
import QboDisconnectConfirmModal from './QboDisconnectConfirmModal'; // Import confirmation modal (will be created next)

// Define component props if needed (e.g., initial status, callbacks)
interface QboIntegrationSettingsProps {}

const QboIntegrationSettings: React.FC<QboIntegrationSettingsProps> = () => {
  const [statusInfo, setStatusInfo] = useState<QboConnectionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isDisconnecting, startDisconnectTransition] = useTransition();
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);

// TODO (Task 86): Read URL query parameters ('qbo_error', 'qbo_status') on initial load
  // to display specific success/error messages resulting from the OAuth callback redirect.
  // Example:
  // useEffect(() => {
  //   const params = new URLSearchParams(window.location.search);
  //   const qboError = params.get('qbo_error');
  //   const qboStatus = params.get('qbo_status');
  //   if (qboError) {
  //      setError(`QuickBooks Connection Error: ${qboError}`);
  //      // Optionally remove the param from URL history using window.history.replaceState
  //   } else if (qboStatus === 'connected') {
  //      setSuccessMessage('Successfully connected to QuickBooks Online.');
  //      // Optionally remove the param from URL history
  //   }
  //   // Clear params from URL after reading
  //   if (qboError || qboStatus) {
  //      window.history.replaceState({}, document.title, window.location.pathname);
  //   }
  //   // Then fetch status
  //   fetchStatus();
  // }, []); // Run only once on mount
  // Fetch initial status on component mount
  useEffect(() => {
    const fetchStatus = async () => {
      setIsLoading(true);
      setError(null);
      setSuccessMessage(null); // Clear previous messages
      try {
        const result = await getQboConnectionStatus();
        setStatusInfo(result);
        if (result.status === 'Error') {
          setError(result.errorMessage || 'Failed to fetch connection status.');
        }
      } catch (err: any) {
        console.error('Error fetching QBO status:', err);
        setError(err.message || 'An unexpected error occurred.');
        setStatusInfo({ status: 'Error', errorMessage: err.message, connected: false }); // Set status to Error, include connected: false
      } finally {
        setIsLoading(false);
      }
    };
    fetchStatus();
  }, []);

  // Handle Connect Button Click
  const handleConnect = () => {
    setIsLoading(true); // Show loading state briefly
    setError(null);
    setSuccessMessage(null);
    // Redirect to the backend API route which handles the Intuit redirect
    window.location.href = '/api/integrations/qbo/connect';
  };

  // Handle Disconnect Confirmation
  const handleDisconnectConfirm = () => {
    setShowDisconnectModal(false); // Close modal
    startDisconnectTransition(async () => {
      setError(null);
      setSuccessMessage(null);
      try {
        const result = await disconnectQbo();
        if (result.success) {
          setSuccessMessage('QuickBooks Online connection successfully disconnected.');
          // Re-fetch status to update UI
          const newStatus = await getQboConnectionStatus();
          setStatusInfo(newStatus);
        } else {
          setError(result.error || 'Failed to disconnect.');
          // Optionally re-fetch status even on error
          const currentStatus = await getQboConnectionStatus();
          setStatusInfo(currentStatus);
        }
      } catch (err: any) {
        console.error('Error disconnecting QBO:', err);
        setError(err.message || 'An unexpected error occurred during disconnection.');
        // Re-fetch status after error
        const currentStatus = await getQboConnectionStatus();
        setStatusInfo(currentStatus);
      }
    });
  };

  // Render Status Indicator (Task 80)
  const renderStatusIndicator = () => {
    if (isLoading || !statusInfo) {
      return <div className="flex items-center space-x-2"><Loader2 className="h-4 w-4 animate-spin" /><span>Loading status...</span></div>;
    }

    switch (statusInfo.status) {
      case 'Connected':
        return (
          <div className="flex items-center space-x-2 text-green-600">
            <CheckCircle className="h-5 w-5" />
            <div>
              <p className="font-medium">Status: Connected</p>
              <p className="text-sm text-muted-foreground">
                Connected to: {statusInfo.companyName || 'N/A'} (Realm ID: {statusInfo.realmId || 'N/A'})
              </p>
            </div>
          </div>
        );
      case 'Not Connected':
        return (
          <div className="flex items-center space-x-2 text-muted-foreground">
            <XCircle className="h-5 w-5" />
            <p className="font-medium">Status: Not Connected</p>
          </div>
        );
      case 'Error':
        return (
          <div className="flex items-center space-x-2 text-red-600">
            <AlertCircle className="h-5 w-5" />
            <div>
              <p className="font-medium">Status: Connection Error</p>
              {statusInfo.errorMessage && <p className="text-sm text-muted-foreground">Error: {statusInfo.errorMessage}</p>}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  // Render Action Buttons (Task 81)
  const renderActionButtons = () => {
    if (isLoading || !statusInfo) {
      // Added ID to disabled button
      return <Button disabled id="qbo-loading-button"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Please wait...</Button>;
    }

    switch (statusInfo.status) {
      case 'Connected':
        return (
          <Button
            variant="destructive"
            onClick={() => setShowDisconnectModal(true)}
            disabled={isDisconnecting}
            id="qbo-disconnect-button" // Added ID
          >
            {isDisconnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unlink className="mr-2 h-4 w-4" />}
            Disconnect
          </Button>
        );
      case 'Not Connected':
      case 'Error':
        return (
          <Button onClick={handleConnect} id="qbo-connect-button"> {/* Added ID */}
            <Link className="mr-2 h-4 w-4" />
            Connect to QuickBooks Online
          </Button>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <Card id="qbo-integration-settings-card"> {/* Added ID */}
        <CardHeader>
          <CardTitle>QuickBooks Online Integration</CardTitle>
          <CardDescription>
            Connect your QuickBooks Online account to enable automated syncing of invoices and customers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Status Indicator */}
          <div className="p-4 border rounded-md bg-muted/40">
            {renderStatusIndicator()}
          </div>

          {/* Display General Errors or Success Messages */}
          {error && !statusInfo?.errorMessage && ( // Show general error if not already shown in status
            <Alert variant="destructive" id="qbo-general-error-alert">
              <AlertCircle className="h-4 w-4" />
              {/* Removed AlertTitle, using strong tag inside AlertDescription */}
              <AlertDescription><strong>Error:</strong> {error}</AlertDescription>
            </Alert>
          )}
          {successMessage && (
             <Alert variant="default" className="bg-green-50 border border-green-200 text-green-700" id="qbo-success-alert"> {/* Added ID */}
              <CheckCircle className="h-4 w-4 text-green-600" />
               {/* Removed AlertTitle, using strong tag inside AlertDescription */}
              <AlertDescription><strong>Success:</strong> {successMessage}</AlertDescription>
            </Alert>
          )}

           {/* Informational Text */}
           {(statusInfo?.status === 'Not Connected' || statusInfo?.status === 'Error') && (
             <p className="text-sm text-muted-foreground" id="qbo-connect-info-text">
               Clicking 'Connect' will redirect you to Intuit to authorize the connection. You will be returned here once completed.
             </p>
           )}

        </CardContent>
        <CardFooter className="flex justify-end">
          {/* Action Buttons */}
          {renderActionButtons()}
        </CardFooter>
      </Card>

      {/* Disconnect Confirmation Modal (Task 85) */}
      <QboDisconnectConfirmModal
        isOpen={showDisconnectModal}
        onClose={() => setShowDisconnectModal(false)}
        onConfirm={handleDisconnectConfirm}
        isDisconnecting={isDisconnecting}
      />
    </>
  );
};

export default QboIntegrationSettings;