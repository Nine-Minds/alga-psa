'use client';

import CalendarSharingSettings from '@alga-psa/scheduling/components/schedule/sharing/CalendarSharingSettings';
import { CalendarIntegrationsSettings } from '../../calendar/CalendarIntegrationsSettings';

export default function CalendarProfileSettings() {
  return (
    <div className="space-y-6">
      <CalendarSharingSettings />
      <CalendarIntegrationsSettings />
    </div>
  );
}
