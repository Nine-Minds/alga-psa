import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { getSettingsTabTitle } from '@/components/settings/settingsTabsRegistry';
import TimeEntrySettingsBody from './TimeEntrySettingsBody';

export const metadata: Metadata = { title: getSettingsTabTitle('time-entry') };

export default function TimeEntrySettingsRoute() {
  return (
    <SettingsTab tabId="time-entry">
      <TimeEntrySettingsBody />
    </SettingsTab>
  );
}
