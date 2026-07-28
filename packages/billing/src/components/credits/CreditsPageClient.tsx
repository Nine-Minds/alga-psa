'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import type { ICreditExpirationSettings } from '@alga-psa/types';
import AddCreditButton from './AddCreditButton';
import BackButton from './BackButton';
import { CreditsTabs } from './CreditsTabs';
import CreditsTable from './CreditsTable';
import ReconciliationTab from './reconciliation/ReconciliationTab';

interface CreditsPageClientProps {
  settings: ICreditExpirationSettings | { actionError: string } | { permissionError: string };
}

const isCreditExpirationSettingsError = (
  settings: CreditsPageClientProps['settings'],
): settings is { actionError: string } | { permissionError: string } =>
  isActionMessageError(settings) || isActionPermissionError(settings);

function CreditExpirationSettingsPanel({ settings }: { settings: ICreditExpirationSettings }) {
  const { t } = useTranslation('msp/credits');

  return (
    <div className="p-4 border rounded-md bg-muted mb-4">
      <h3 className="text-lg font-medium mb-2">
        {t('settings.title', { defaultValue: 'Credit Expiration Settings' })}
      </h3>
      <div className="space-y-2">
        <div className="flex justify-between">
          <span>{t('settings.creditExpiration', { defaultValue: 'Credit Expiration:' })}</span>
          <span className={settings.enable_credit_expiration ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
            {settings.enable_credit_expiration
              ? t('settings.enabled', { defaultValue: 'Enabled' })
              : t('settings.disabled', { defaultValue: 'Disabled' })}
          </span>
        </div>
        {settings.enable_credit_expiration && (
          <>
            <div className="flex justify-between">
              <span>{t('settings.expirationPeriod', { defaultValue: 'Expiration Period:' })}</span>
              <span>
                {t('settings.daysUnit', {
                  count: settings.credit_expiration_days,
                  defaultValue: '{{count}} days',
                })}
              </span>
            </div>
            <div className="flex justify-between">
              <span>{t('settings.notificationDays', { defaultValue: 'Notification Days:' })}</span>
              <span>
                {settings.credit_expiration_notification_days?.join(', ')
                  || t('settings.none', { defaultValue: 'None' })}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function CreditsPageClient({ settings }: CreditsPageClientProps) {
  const { t } = useTranslation('msp/credits');

  const settingsError = isCreditExpirationSettingsError(settings);
  const creditExpirationEnabled = !settingsError && settings.enable_credit_expiration;

  const tabs = [
    {
      id: 'credits',
      label: t('tabs.credits', { defaultValue: 'Credits' }),
      content: <CreditsTable />,
    },
    {
      id: 'reconciliation',
      label: t('tabs.reconciliation', { defaultValue: 'Reconciliation' }),
      content: <ReconciliationTab />,
    },
  ];

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="mb-4">
        <BackButton />
      </div>
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">
          {t('page.title', { defaultValue: 'Credit Management' })}
        </h1>
        <div className="flex space-x-2">
          <AddCreditButton />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('page.creditsOverview', { defaultValue: 'Credits Overview' })}</CardTitle>
          <CardDescription>
            {creditExpirationEnabled
              ? t('page.overviewDescriptionWithExpiration', {
                  defaultValue: 'Manage your client credits, including expiration dates, and transfers',
                })
              : t('page.overviewDescription', {
                  defaultValue: 'Manage your client credits and transfers',
                })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {settingsError ? (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>
                {t('settings.loadErrorPrefix', { defaultValue: 'Error loading credit expiration settings:' })}{' '}
                {getErrorMessage(settings)}
              </AlertDescription>
            </Alert>
          ) : (
            <CreditExpirationSettingsPanel settings={settings} />
          )}
          <CreditsTabs tabs={tabs} />
        </CardContent>
      </Card>
    </div>
  );
}
