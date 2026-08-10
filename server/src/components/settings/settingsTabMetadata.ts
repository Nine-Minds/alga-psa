import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { getSettingsTab } from './settingsTabsRegistry';

// Kept out of settingsTabsRegistry.ts on purpose: that module is imported by
// client components, and getServerTranslation reaches for next/headers.
//
// Every /msp/settings/<id> segment resolves its browser-tab title through the
// registry's own labelKey, so the tab strip and the browser tab can't drift.
export async function settingsTabMetadata(tabId: string): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'msp/settings');
  const tab = getSettingsTab(tabId);

  if (!tab) {
    return { title: t('tabs.settingsFallback', { defaultValue: 'Settings' }) };
  }

  return { title: t(tab.labelKey, { defaultValue: tab.title }) };
}
