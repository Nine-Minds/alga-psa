import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { getSettingsTabTitle } from '@/components/settings/settingsTabsRegistry';
import InteractionsSettingsBody from './InteractionsSettingsBody';

export const metadata: Metadata = { title: getSettingsTabTitle('interactions') };

export default function InteractionsSettingsRoute() {
  return (
    <SettingsTab tabId="interactions">
      <InteractionsSettingsBody />
    </SettingsTab>
  );
}
