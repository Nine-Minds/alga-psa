'use client';

import Link from 'next/link';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import type { ICreditExpirationSettings } from '@alga-psa/types';
import AddCreditButton from './AddCreditButton';
import CreditsTable from './CreditsTable';

interface CreditsPageClientProps {
  settings: ICreditExpirationSettings | { actionError: string } | { permissionError: string };
}

const isCreditExpirationSettingsError = (
  settings: CreditsPageClientProps['settings'],
): settings is { actionError: string } | { permissionError: string } =>
  isActionMessageError(settings) || isActionPermissionError(settings);

function ExpirationCaption({ settings }: { settings: ICreditExpirationSettings }) {
  const { t } = useTranslation('msp/credits');
  const reminders = settings.credit_expiration_notification_days?.join(', ');

  return (
    <p className="text-sm text-[rgb(var(--color-text-500))]">
      {settings.enable_credit_expiration
        ? t('settings.captionEnabled', {
            days: settings.credit_expiration_days,
            defaultValue: 'Credit expiration: {{days}} days',
          })
        : t('settings.captionDisabled', { defaultValue: 'Credit expiration: off' })}
      {settings.enable_credit_expiration && reminders
        ? ` · ${t('settings.captionReminders', { reminders, defaultValue: 'reminders {{reminders}} days before' })}`
        : ''}
      {' · '}
      <Link href="/msp/settings/billing" className="text-[rgb(var(--color-primary-600))] hover:underline">
        {t('settings.editInSettings', { defaultValue: 'Edit in Billing Settings' })}
      </Link>
    </p>
  );
}

export default function CreditsPageClient({ settings }: CreditsPageClientProps) {
  const { t } = useTranslation('msp/credits');

  const settingsError = isCreditExpirationSettingsError(settings);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex justify-between items-center">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">
            {t('page.title', { defaultValue: 'Credit Management' })}
          </h1>
          {settingsError ? (
            <Alert variant="destructive">
              <AlertDescription>
                {t('settings.loadErrorPrefix', { defaultValue: 'Error loading credit expiration settings:' })}{' '}
                {getErrorMessage(settings)}
              </AlertDescription>
            </Alert>
          ) : (
            <ExpirationCaption settings={settings} />
          )}
        </div>
        <AddCreditButton />
      </div>

      <CreditsTable />
    </div>
  );
}
