import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { getSettingsTabTitle } from '@/components/settings/settingsTabsRegistry';
import OpportunitiesSettingsBody from './OpportunitiesSettingsBody';

export const metadata: Metadata = { title: getSettingsTabTitle('opportunities') };

export default function OpportunitiesSettingsRoute() {
  return (
    <SettingsTab tabId="opportunities">
      <OpportunitiesSettingsBody />
    </SettingsTab>
  );
}
