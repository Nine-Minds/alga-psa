import { redirect } from 'next/navigation';
import SettingsPage from '@/components/settings/SettingsPage';
import { MIGRATED_SETTINGS_TAB_IDS } from '@/components/settings/settingsTabsRegistry';
import type { Metadata } from 'next';

// Browser tab titles for each settings section. Settings is a single route whose
// sections are selected via the `?tab=` query param, so the title is derived from
// that param to mirror the active section. Keys match the tab `id`s in
// server/src/components/settings/SettingsPage.tsx (matched case-insensitively).
const SETTINGS_TAB_TITLES: Record<string, string> = {
  general: 'General',
  'experimental-features': 'Experimental Features',
  'client-portal': 'Client Portal',
  users: 'Users',
  teams: 'Teams',
  language: 'Language',
  ticketing: 'Ticketing',
  projects: 'Projects',
  interactions: 'Interactions',
  notifications: 'Notifications',
  'time-entry': 'Time Entry',
  billing: 'Billing',
  secrets: 'Secrets',
  'import-export': 'Import/Export',
  email: 'Email',
  integrations: 'Integrations',
  extensions: 'Extensions',
};

export async function generateMetadata({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const resolvedSearchParams = await searchParams;
  const tab = typeof resolvedSearchParams?.tab === 'string' ? resolvedSearchParams.tab.toLowerCase() : undefined;
  return { title: (tab && SETTINGS_TAB_TITLES[tab]) || 'Settings' };
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
