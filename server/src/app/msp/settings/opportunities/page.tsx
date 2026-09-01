import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import OpportunitiesSettingsBody from './OpportunitiesSettingsBody';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('opportunities');
}

export default function OpportunitiesSettingsRoute() {
  return (
    <SettingsTab tabId="opportunities">
      <OpportunitiesSettingsBody />
    </SettingsTab>
  );
}
