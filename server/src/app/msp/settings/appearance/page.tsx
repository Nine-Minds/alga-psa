import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isEnterprise } from '@alga-psa/core/features';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import AppearanceSettings from '@/components/settings/general/AppearanceSettings';
import { checkFeatureFlag } from '@/lib/feature-flags/serverFeatureFlags';

const RELEASE_V1_5_FLAG = 'release-v1-5-feature';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('appearance');
}

export default async function AppearanceSettingsRoute() {
  const releaseEnabled = isEnterprise && await checkFeatureFlag(RELEASE_V1_5_FLAG);
  if (!releaseEnabled) {
    notFound();
  }

  return (
    <SettingsTab tabId="appearance">
      <AppearanceSettings />
    </SettingsTab>
  );
}
