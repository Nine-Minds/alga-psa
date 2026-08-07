import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import ImportExportSettings from '@/components/settings/import-export/ImportExportSettings';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('import-export');
}

export default function ImportExportSettingsRoute() {
  return (
    <SettingsTab tabId="import-export">
      <ImportExportSettings />
    </SettingsTab>
  );
}
