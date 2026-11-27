'use client';

import {
  CalendarIntegrationsSettings as EnterpriseCalendarIntegrationsSettings,
  type CalendarIntegrationsSettingsProps,
} from '../../calendar/CalendarIntegrationsSettings';

export default function CalendarIntegrationsSettings(props: CalendarIntegrationsSettingsProps) {
  return <EnterpriseCalendarIntegrationsSettings {...props} />;
}
