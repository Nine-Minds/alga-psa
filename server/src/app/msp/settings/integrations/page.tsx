import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { getSettingsTabTitle } from '@/components/settings/settingsTabsRegistry';
import IntegrationsSettingsBody from './IntegrationsSettingsBody';

export const metadata: Metadata = { title: getSettingsTabTitle('integrations') };

export default function IntegrationsSettingsRoute() {
  return (
    <SettingsTab tabId="integrations">
      <IntegrationsSettingsBody />
    </SettingsTab>
  );
}
