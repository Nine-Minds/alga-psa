import SettingsPage from '@/components/settings/SettingsPage';

export default function Page({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const tab = typeof searchParams?.tab === 'string' ? searchParams.tab : undefined;
  return <SettingsPage initialTabParam={tab} />;
}
