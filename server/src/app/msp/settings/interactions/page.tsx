import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import InteractionsSettingsBody from './InteractionsSettingsBody';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('interactions');
}

export default function InteractionsSettingsRoute() {
  return (
    <SettingsTab tabId="interactions">
      <InteractionsSettingsBody />
    </SettingsTab>
  );
}
