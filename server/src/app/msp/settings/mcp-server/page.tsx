import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { getSettingsTabTitle } from '@/components/settings/settingsTabsRegistry';
import McpServerSettings from '@/components/settings/mcp/McpServerSettings';

export const metadata: Metadata = { title: getSettingsTabTitle('mcp-server') };

export default function McpServerSettingsRoute() {
  return (
    <SettingsTab tabId="mcp-server">
      <McpServerSettings />
    </SettingsTab>
  );
}
