import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import EmailSettingsBody from './EmailSettingsBody';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('email');
}

export default function EmailSettingsRoute() {
  return (
    <SettingsTab tabId="email">
      <EmailSettingsBody />
    </SettingsTab>
  );
}
