import { redirect } from 'next/navigation';
import SettingsPage from '@/components/settings/SettingsPage';
import { MIGRATED_SETTINGS_TAB_IDS, getSettingsTab } from '@/components/settings/settingsTabsRegistry';
import { settingsTabMetadata } from '@/components/settings/settingsTabMetadata';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { Metadata } from 'next';

// Settings is a single route whose sections are selected via the `?tab=` query
// param, so the browser-tab title is derived from that param to mirror the
// active section. The label comes from the tab registry, the same source the
// in-page tab strip renders from.
export async function generateMetadata({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const resolvedSearchParams = await searchParams;
  const tab = typeof resolvedSearchParams?.tab === 'string' ? resolvedSearchParams.tab.toLowerCase() : undefined;

  if (tab && getSettingsTab(tab)) {
    return settingsTabMetadata(tab);
  }

  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.settings.title', { defaultValue: 'Settings' }) };
}

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const tab = typeof resolvedSearchParams?.tab === 'string' ? resolvedSearchParams.tab : undefined;

  // Heavy tabs now live at their own /msp/settings/<id> route segment. Redirect legacy
  // ?tab=<id> deep links (bookmarks, sidebar, Xero/QBO OAuth callbacks) to the segment, and
  // carry over every other param — category/subtab/section/*_status all deep-link into a tab.
  const normalizedTab = tab?.toLowerCase();
  if (normalizedTab && MIGRATED_SETTINGS_TAB_IDS.has(normalizedTab)) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(resolvedSearchParams ?? {})) {
      if (key === 'tab' || value == null) continue;
      if (Array.isArray(value)) {
        value.forEach((v) => params.append(key, v));
      } else {
        params.set(key, value);
      }
    }
    const query = params.toString();
    redirect(`/msp/settings/${normalizedTab}${query ? `?${query}` : ''}`);
  }

  return <SettingsPage initialTabParam={tab} />;
}
