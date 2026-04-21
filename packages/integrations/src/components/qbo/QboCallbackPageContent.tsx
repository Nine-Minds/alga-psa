'use client';

import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface QboCallbackPageContentProps {
  isSuccess: boolean;
  errorMessage?: string;
  realmId?: string;
}

export function QboCallbackPageContent({ isSuccess, errorMessage, realmId }: QboCallbackPageContentProps) {
  const { t } = useTranslation('msp/integrations');

  return (
    <div className="flex justify-center items-center min-h-[calc(100vh-200px)]">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('integrations.qbo.callback.title', { defaultValue: 'QuickBooks Connection Status' })}</CardTitle>
          <CardDescription>
            {isSuccess
              ? t('integrations.qbo.callback.completed', { defaultValue: 'Connection process completed.' })
              : t('integrations.qbo.callback.errored', { defaultValue: 'Connection process resulted in an error.' })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isSuccess ? (
            <Alert variant="success">
              <AlertDescription>
                <p className="font-semibold">{t('integrations.qbo.callback.success', { defaultValue: 'Successfully connected to QuickBooks Online!' })}</p>
                {realmId && <p className="text-sm text-muted-foreground mt-1">{t('integrations.qbo.callback.realmId', { defaultValue: 'Realm ID: {{realmId}}', realmId })}</p>}
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <AlertDescription>
                <p className="font-semibold">{t('integrations.qbo.callback.failed', { defaultValue: 'Failed to connect to QuickBooks Online.' })}</p>
                {errorMessage && <p className="text-sm mt-1">{t('integrations.qbo.callback.errorDetail', { defaultValue: 'Error: {{error}}', error: decodeURIComponent(errorMessage) })}</p>}
              </AlertDescription>
            </Alert>
          )}
          <Link href="/msp/settings/integrations/qbo" passHref>
            <Button id="return-to-qbo-settings-button" className="w-full">
              {t('integrations.qbo.callback.returnButton', { defaultValue: 'Return to QuickBooks Settings' })}
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
