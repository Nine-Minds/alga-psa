import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import McpServerSettings from '@/components/settings/mcp/McpServerSettings';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('mcp-server');
}

export default function McpServerSettingsRoute() {
  return (
    <SettingsTab tabId="mcp-server">
      <McpServerSettings />
    </SettingsTab>
  );
}
