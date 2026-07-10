import type { Metadata } from 'next';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { getSettingsTabTitle } from '@/components/settings/settingsTabsRegistry';
import BillingSettingsBody from './BillingSettingsBody';

export const metadata: Metadata = { title: getSettingsTabTitle('billing') };

export default function BillingSettingsRoute() {
  return (
    <SettingsTab tabId="billing">
      <BillingSettingsBody />
    </SettingsTab>
  );
}
