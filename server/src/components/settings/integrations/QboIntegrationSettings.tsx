'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../ui/Card'; // Use relative path
import { Button } from '../../ui/Button'; // Use relative path
import { Alert, AlertDescription } from '../../ui/Alert'; // Use relative path (Removed AlertTitle)
import { CheckCircle, XCircle, AlertCircle, Link, Unlink } from 'lucide-react'; // Icons
import LoadingIndicator from '../../ui/LoadingIndicator'; // Use relative path
import { getQboConnectionStatus, disconnectQbo, QboConnectionStatus } from '../../../lib/actions/integrations/qboActions'; // Use relative path
import QboDisconnectConfirmModal from './QboDisconnectConfirmModal'; // Import confirmation modal (will be created next)
import { QboMappingManager } from '../../integrations/qbo/QboMappingManager'; // Import the mapping manager

// Define component props
// Removed tenantId prop
interface QboIntegrationSettingsProps {}

const QboIntegrationSettings: React.FC<QboIntegrationSettingsProps> = () => {
  const [statusInfo, setStatusInfo] = useState<QboConnectionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isDisconnecting, startDisconnectTransition] = useTransition();
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);

  // Effect to handle URL parameters from OAuth redirect and fetch initial status
  useEffect(() => {
    let fetchedStatusAfterRedirect = false; // Flag to prevent double fetching

    const fetchStatus = async () => {
      // Only fetch if status hasn't been loaded yet OR if we haven't fetched after a redirect message
      if (statusInfo === null || !fetchedStatusAfterRedirect) {
        setIsLoading(true);
        // Don't clear error/success if they were just set by URL params
        // setError(null);
        // setSuccessMessage(null);
        try {
          const result = await getQboConnectionStatus();
          setStatusInfo(result);
          // If the fetch returns an error, set the error state, overriding any success message from URL
          if (result.status === 'Error') {
            setError(result.errorMessage || 'Failed to fetch connection status.');
            setSuccessMessage(null); // Clear success message if fetch fails
          }
        } catch (err: any) {
          console.error('Error fetching QBO status:', err);
          setError(err.message || 'An unexpected error occurred.');
          setSuccessMessage(null); // Clear success message on error
          setStatusInfo({ status: 'Error', errorMessage: err.message, connected: false });
        } finally {
          setIsLoading(false);
          fetchedStatusAfterRedirect = true; // Mark as fetched
        }
      }
    };

    // Check URL parameters first
    const params = new URLSearchParams(window.location.search);
    const qboError = params.get('qbo_error');
    const qboStatus = params.get('qbo_status'); // Changed from 'connected' to match backend
    const qboMessage = params.get('message'); // Check for optional message

    let shouldFetchStatus = true; // Assume we need to fetch status unless URL says connected

    if (qboError) {
      setError(`QuickBooks Connection Error: ${qboError}${qboMessage ? ` - ${qboMessage}` : ''}`);
      setSuccessMessage(null); // Clear any potential success message
      shouldFetchStatus = true; // Fetch status even if there was an error
    } else if (qboStatus === 'success') { // Check for 'success' status from backend
      setSuccessMessage('Successfully connected to QuickBooks Online.');
      setError(null); // Clear any potential error message
      shouldFetchStatus = true; // Still fetch status to get client name etc.
    } else if (qboStatus === 'failure') { // Handle explicit failure status
       setError(`QuickBooks Connection Failed${qboMessage ? `: ${qboMessage}` : '.'}`);
       setSuccessMessage(null);
       shouldFetchStatus = true;
    }

    // Clear params from URL after reading
    if (qboError || qboStatus) {
      // Use replaceState to avoid adding to history
      window.history.replaceState({}, document.title, window.location.pathname + window.location.hash); // Keep hash if present
    }

    // Fetch status if needed
    if (shouldFetchStatus) {
      fetchStatus();
    } else {
      // If we didn't fetch status (e.g., maybe in future we don't fetch on success), ensure loading is false
      setIsLoading(false);
    }

  }, []); // Run only once on mount

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
      return <LoadingIndicator spinnerProps={{ size: 'sm' }} text="Loading status..." />;
    }

    switch (statusInfo.status) {
      case 'Connected':
        return (
          <div className="flex items-center space-x-2 text-green-600">
            <CheckCircle className="h-5 w-5" />
            <div>
              <p className="font-medium">Status: Connected</p>
              <p className="text-sm text-muted-foreground">
                Connected to: {statusInfo.clientName || 'N/A'} (Realm ID: {statusInfo.realmId || 'N/A'})
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
      return <Button disabled id="qbo-loading-button"><LoadingIndicator spinnerProps={{ size: 'sm' }} text="Please wait..." /></Button>;
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
            {isDisconnecting ? <LoadingIndicator spinnerProps={{ size: 'sm' }} text="Disconnect" /> : <><Unlink className="mr-2 h-4 w-4" /> Disconnect</>}
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

      {/* --- Conditional Rendering Section (Moved inside the main fragment) --- */}

      {/* Conditionally render the Mapping Manager Card */}
      {/* Explicitly check statusInfo is not null before accessing properties */}
      {/* Removed tenantId check */}
      {statusInfo && statusInfo.status === 'Connected' && statusInfo.realmId && (
        <Card id="qbo-mapping-card" className="mt-6"> {/* Added ID and margin */}
          <CardHeader>
            <CardTitle>QuickBooks Online Mappings</CardTitle>
            <CardDescription>
              Map your Alga entities (Services, Tax Regions, Payment Terms) to their QuickBooks Online counterparts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <QboMappingManager
              // Use non-null assertion (!) as the condition guarantees these are strings here
              realmId={statusInfo.realmId!}
              // Removed tenantId prop - server action should handle context
            />
          </CardContent>
        </Card>
      )}

      {/* Optional: Show a message if connected but missing realmId/tenant (configuration issue) */}
      {/* Explicitly check statusInfo is not null */}
      {/* Removed tenantId check */}
      {statusInfo && statusInfo.status === 'Connected' && !statusInfo.realmId && (
         <Card className="mt-6 bg-orange-50 border-orange-200"> {/* Added margin and styling */}
           <CardContent className="pt-6"> {/* Added padding top */}
             <p className="text-sm text-orange-700"> {/* Adjusted text size/color */}
               <AlertCircle className="inline-block h-4 w-4 mr-2 align-text-bottom" /> {/* Added icon */}
               QuickBooks Online is connected, but the Realm ID is missing, which is required for mapping. Please contact support if this persists.
             </p>
           </CardContent>
         </Card>
      )}
      {/* --- End Conditional Rendering Section --- */}

    </> // End of the main return fragment
  );
};

export default QboIntegrationSettings;