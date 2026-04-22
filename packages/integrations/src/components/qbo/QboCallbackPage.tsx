import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { QboCallbackPageContent } from './QboCallbackPageContent';

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
    <QboCallbackPageContent
      isSuccess={isSuccess}
      errorMessage={errorMessage}
      realmId={realmId}
    />
  );
}
