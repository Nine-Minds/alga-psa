'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import Spinner from '@alga-psa/ui/components/Spinner';
import { isCalendarEnterpriseEdition } from '../../../lib/calendarAvailability';

const EnterpriseCalendarIntegrationsSettings = dynamic(
  () => import('@alga-psa/ee-calendar/components').then((mod) => mod.CalendarIntegrationsSettings),
  {
    loading: () => (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center justify-center gap-2">
            <Spinner size="md" />
            <span className="text-sm text-muted-foreground">Loading calendar settings...</span>
          </div>
        </CardContent>
      </Card>
    ),
    ssr: false,
  }
);

export function CalendarEnterpriseIntegrationSettings() {
  if (!isCalendarEnterpriseEdition()) {
    return null;
  }

  return <EnterpriseCalendarIntegrationsSettings />;
}
