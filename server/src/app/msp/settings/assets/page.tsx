import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import AssetTypesManager from '@alga-psa/assets/components/settings/AssetTypesManager';
import RemoteAccessLinksManager from '@alga-psa/assets/components/settings/RemoteAccessLinksManager';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('assets');
}

export default function AssetsSettingsRoute() {
  return (
    <SettingsTab tabId="assets">
      <AssetTypesManager />
      <RemoteAccessLinksManager />
    </SettingsTab>
  );
}
