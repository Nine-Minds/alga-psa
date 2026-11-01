import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import TagsSettingsBody from './TagsSettingsBody';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('tags');
}

export default function TagsSettingsRoute() {
  return (
    <SettingsTab tabId="tags">
      <TagsSettingsBody />
    </SettingsTab>
  );
}
