'use client';

import { RefreshCw } from 'lucide-react';
import { Alert, AlertDescription } from './Alert';
import { Button } from './Button';
import { useStaleActionState } from '../lib/staleActionState';
import { useTranslation } from '../lib/i18n/client';

export function StaleActionBanner() {
  const isStale = useStaleActionState();
  const { t } = useTranslation('common');

  if (!isStale) {
    return null;
  }

  return (
    <Alert
      id="stale-action-banner"
      variant="warning"
      className="rounded-none border-x-0 border-t-0 px-4 py-2 shadow-none [&>svg]:top-2.5"
    >
      <AlertDescription className="flex min-h-7 items-center justify-between gap-4">
        <span>
          {t('staleAction.message', {
            defaultValue: 'This page is out of date. Refresh to restore live updates and actions.',
          })}
        </span>
        <Button
          id="refresh-stale-action-page-button"
          variant="outline"
          size="xs"
          className="shrink-0"
          onClick={() => window.location.reload()}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {t('actions.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
