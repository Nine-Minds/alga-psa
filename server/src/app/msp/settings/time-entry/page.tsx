import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import TimeEntrySettingsBody from './TimeEntrySettingsBody';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('time-entry');
}

export default function TimeEntrySettingsRoute() {
  return (
    <SettingsTab tabId="time-entry">
      <TimeEntrySettingsBody />
    </SettingsTab>
  );
}
