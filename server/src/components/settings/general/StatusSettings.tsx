'use client';

import React from 'react';

import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface StatusSettingsProps {
  initialStatusType?: string | null;
}

const StatusSettings = (_props: StatusSettingsProps): React.JSX.Element => {
  const { t } = useTranslation('msp/settings');

  return (
    <div className="space-y-4">
      <Alert variant="info" data-testid="ticket-statuses-retired-alert">
        <AlertDescription>
          Ticket statuses are now managed inside each board. Use the Boards tab to edit ticket lifecycles for a specific board.
        </AlertDescription>
      </Alert>
      <Button
        id="open-board-ticket-statuses-button"
        type="button"
        onClick={() => {
          window.location.assign('/msp/settings?tab=ticketing&section=boards');
        }}
      >
        {t('ticketing.boards.title')}
      </Button>
    </div>
  );
};

export default StatusSettings;
