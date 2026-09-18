import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import AssetTypesManager from '@alga-psa/assets/components/settings/AssetTypesManager';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('assets');
}

export default function AssetsSettingsRoute() {
  return (
    <SettingsTab tabId="assets">
      <AssetTypesManager />
    </SettingsTab>
  );
}
