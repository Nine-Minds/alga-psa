import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import BillingSettingsBody from './BillingSettingsBody';

export async function generateMetadata(): Promise<Metadata> {
  return settingsTabMetadata('billing');
}

export default function BillingSettingsRoute() {
  return (
    <SettingsTab tabId="billing">
      <BillingSettingsBody />
    </SettingsTab>
  );
}
