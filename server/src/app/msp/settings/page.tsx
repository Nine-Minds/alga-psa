import SettingsPage from '@/components/settings/SettingsPage';
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
  return <SettingsPage initialTabParam={tab} />;
}
