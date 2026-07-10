import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { getSettingsTabTitle } from '@/components/settings/settingsTabsRegistry';
import MspLanguageSettings from '@/components/settings/general/MspLanguageSettings';

export const metadata: Metadata = { title: getSettingsTabTitle('language') };

export default function LanguageSettingsRoute() {
  return (
    <SettingsTab tabId="language">
      <MspLanguageSettings />
    </SettingsTab>
  );
}
