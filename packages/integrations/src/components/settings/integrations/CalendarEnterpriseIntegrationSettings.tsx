'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import Spinner from '@alga-psa/ui/components/Spinner';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isCalendarEnterpriseEdition } from '../../../lib/calendarAvailability';

function CalendarLoadingPlaceholder() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardContent className="py-8">
        <div className="flex flex-col items-center justify-center gap-2">
          <Spinner size="md" />
          <span className="text-sm text-muted-foreground">
            {t('integrations.calendar.enterprise.loading', { defaultValue: 'Loading calendar settings...' })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

const EnterpriseCalendarIntegrationsSettings = dynamic(
  () => import('@alga-psa/ee-calendar/components').then((mod) => mod.CalendarIntegrationsSettings),
  {
    loading: () => <CalendarLoadingPlaceholder />,
    ssr: false,
  }
);

export function CalendarEnterpriseIntegrationSettings() {
  if (!isCalendarEnterpriseEdition()) {
    return null;
  }

  return <EnterpriseCalendarIntegrationsSettings />;
}
