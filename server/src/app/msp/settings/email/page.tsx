import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { getSettingsTabTitle } from '@/components/settings/settingsTabsRegistry';
import EmailSettingsBody from './EmailSettingsBody';

export const metadata: Metadata = { title: getSettingsTabTitle('email') };

export default function EmailSettingsRoute() {
  return (
    <SettingsTab tabId="email">
      <EmailSettingsBody />
    </SettingsTab>
  );
}
