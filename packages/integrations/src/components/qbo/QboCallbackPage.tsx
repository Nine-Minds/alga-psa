import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';

interface QboCallbackPageProps {
  searchParams: Promise<{
    success?: string;
    error?: string;
    realmId?: string; // Optional: Backend might pass this on success
  }>;
}

export default async function QboCallbackPage({ searchParams }: QboCallbackPageProps) {
  const resolvedSearchParams = await searchParams;
  const isSuccess = resolvedSearchParams.success === 'true';
  const errorMessage = resolvedSearchParams.error;
  const realmId = resolvedSearchParams.realmId;

  return (
    <div className="flex justify-center items-center min-h-[calc(100vh-200px)]"> {/* Basic centering */}
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>QuickBooks Connection Status</CardTitle>
          <CardDescription>
            {isSuccess ? 'Connection process completed.' : 'Connection process resulted in an error.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isSuccess ? (
            <Alert variant="default" className="bg-green-50 border-green-200">
              <AlertDescription>
                <p className="font-semibold text-green-800">Successfully connected to QuickBooks Online!</p>
                {realmId && <p className="text-sm text-gray-600 mt-1">Realm ID: {realmId}</p>}
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <AlertDescription>
                <p className="font-semibold">Failed to connect to QuickBooks Online.</p>
                {errorMessage && <p className="text-sm mt-1">Error: {decodeURIComponent(errorMessage)}</p>}
              </AlertDescription>
            </Alert>
          )}
          <Link href="/msp/settings/integrations/qbo" passHref> {/* Updated href */}
            <Button id="return-to-qbo-settings-button" className="w-full">Return to QuickBooks Settings</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
