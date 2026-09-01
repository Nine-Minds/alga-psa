import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isEnterprise } from '@alga-psa/core/features';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import AppearanceSettings from '@/components/settings/general/AppearanceSettings';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('appearance');
}

export default async function AppearanceSettingsRoute() {
  // Appearance (tenant theming) is Enterprise-only.
  if (!isEnterprise) {
    notFound();
  }

  return (
    <SettingsTab tabId="appearance">
      <AppearanceSettings />
    </SettingsTab>
  );
}
