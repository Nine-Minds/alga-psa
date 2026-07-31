import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { getSettingsTabTitle } from '@/components/settings/settingsTabsRegistry';
import ImportExportSettings from '@/components/settings/import-export/ImportExportSettings';

export const metadata: Metadata = { title: getSettingsTabTitle('import-export') };

export default function ImportExportSettingsRoute() {
  return (
    <SettingsTab tabId="import-export">
      <ImportExportSettings />
    </SettingsTab>
  );
}
