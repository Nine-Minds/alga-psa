'use client';

import CalendarSharingSettings from '@alga-psa/scheduling/components/schedule/sharing/CalendarSharingSettings';
import {
  CalendarIntegrationsSettings,
  type CalendarIntegrationsSettingsProps,
} from '../../calendar/CalendarIntegrationsSettings';

export default function CalendarProfileSettings({ getMicrosoftAdminConsentUrl }: CalendarIntegrationsSettingsProps = {}) {
  return (
    <div className="space-y-6">
      <CalendarSharingSettings />
      <CalendarIntegrationsSettings getMicrosoftAdminConsentUrl={getMicrosoftAdminConsentUrl} />
    </div>
  );
}
